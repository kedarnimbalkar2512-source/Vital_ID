"""Two-layer consent: VitalID + (patient PIN or in-app approval), time-limited grants,
break-glass for unconscious patients, and revocation."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..access import patient_by_vital_id, require_manage, resolve_managed_patient
from ..audit import audit, notify, patient_circle
from ..auth import CurrentUser, current_user, require_verified_doctor
from ..config import get_settings
from ..db import tx
from ..pin import verify_pin

router = APIRouter(prefix="/api/access", tags=["access"])


def _create_grant(cur, *, patient_id: UUID, doctor_id: UUID, via: str, hours: int, reason: str | None) -> dict:
    expires = datetime.now(timezone.utc) + timedelta(hours=hours)
    cur.execute(
        """
        insert into access_grants (patient_id, doctor_id, scope, granted_via, reason, expires_at)
        values (%s, %s, 'full', %s, %s, %s) returning *
        """,
        (patient_id, doctor_id, via, reason, expires),
    )
    return cur.fetchone()


def _doctor_label(cur, doctor_id: UUID) -> str:
    cur.execute(
        "select pr.full_name, d.hospital from doctors d join profiles pr on pr.id = d.profile_id where d.id = %s",
        (doctor_id,),
    )
    r = cur.fetchone()
    return f"Dr. {r['full_name']}" + (f" ({r['hospital']})" if r["hospital"] else "")


class AccessRequestIn(BaseModel):
    vital_id: str
    pin: str | None = Field(default=None, pattern=r"^\d{4,6}$")
    reason: str | None = Field(default=None, max_length=500)


@router.post("/request")
def request_access(body: AccessRequestIn, user: CurrentUser = Depends(require_verified_doctor)):
    """With a PIN: verifies it and grants access immediately. Without: asks the patient's app."""
    s = get_settings()
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, body.vital_id)
        pid = patient["id"]

        if body.pin:
            cur.execute(
                """
                select count(*) as n from audit_logs
                where patient_id = %s and action = 'access_denied' and meta->>'reason' = 'wrong_pin'
                  and at > now() - make_interval(mins => %s)
                """,
                (pid, s.pin_lockout_minutes),
            )
            if cur.fetchone()["n"] >= s.pin_max_failures:
                raise HTTPException(429, f"Too many wrong PINs. PIN entry is locked for {s.pin_lockout_minutes} minutes; ask the patient to approve in the app.")
            cur.execute("select pin_hash from patient_secrets where patient_id = %s", (pid,))
            row = cur.fetchone()
            if not row or not row["pin_hash"]:
                raise HTTPException(409, "This patient hasn't set a consent PIN. Request approval in their app instead.")
            if verify_pin(row["pin_hash"], body.pin):
                grant = _create_grant(cur, patient_id=pid, doctor_id=user.doctor_id, via="pin",
                                      hours=s.access_grant_hours, reason=body.reason)
                audit(cur, actor_profile_id=user.profile_id, actor_role="doctor", action="grant", patient_id=pid,
                      target_type="access_grants", target_id=grant["id"],
                      meta={"via": "pin", "expires_at": grant["expires_at"].isoformat()})
                notify(cur, profile_ids=patient_circle(cur, pid), kind="access_granted", patient_id=pid,
                       title=f"{_doctor_label(cur, user.doctor_id)} opened your record with your PIN",
                       body=f"Access expires {grant['expires_at']:%d %b %H:%M} UTC. You can revoke it any time.",
                       link="/patient/access")
                return {"status": "granted", "grant_id": grant["id"], "expires_at": grant["expires_at"],
                        "vital_id": patient["vital_id"]}
            # the failed attempt is committed (it counts towards the lockout) before we refuse
            audit(cur, actor_profile_id=user.profile_id, actor_role="doctor", action="access_denied",
                  patient_id=pid, outcome="denied", meta={"reason": "wrong_pin"})
    if body.pin:
        raise HTTPException(403, "Incorrect PIN")

    with tx(user.profile_id) as cur:
        cur.execute(
            """
            insert into access_requests (patient_id, doctor_id, reason) values (%s, %s, %s) returning id, created_at
            """,
            (pid, user.doctor_id, body.reason),
        )
        req = cur.fetchone()
        audit(cur, actor_profile_id=user.profile_id, actor_role="doctor", action="access_request", patient_id=pid,
              target_type="access_requests", target_id=req["id"], meta={"reason": body.reason})
        notify(cur, profile_ids=patient_circle(cur, pid), kind="access_request", patient_id=pid,
               title=f"{_doctor_label(cur, user.doctor_id)} is asking to see your record",
               body=body.reason or "Open VitalID to approve or deny.", link="/patient/access")
    return {"status": "pending", "request_id": req["id"], "vital_id": patient["vital_id"]}


@router.get("/requests/{request_id}")
def request_status(request_id: UUID, user: CurrentUser = Depends(require_verified_doctor)):
    s = get_settings()
    with tx() as cur:
        cur.execute(
            """
            update access_requests set status = 'expired'
            where id = %s and status = 'pending' and created_at < now() - make_interval(mins => %s)
            """,
            (request_id, s.access_request_ttl_minutes),
        )
        cur.execute(
            """
            select r.id, r.status, r.grant_id, pt.vital_id from access_requests r join patients pt on pt.id = r.patient_id
            where r.id = %s and r.doctor_id = %s
            """,
            (request_id, user.doctor_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Request not found")
    return row


class DecideIn(BaseModel):
    approve: bool


@router.post("/requests/{request_id}/decide")
def decide(request_id: UUID, body: DecideIn, user: CurrentUser = Depends(current_user)):
    s = get_settings()
    with tx(user.profile_id) as cur:
        cur.execute("select * from access_requests where id = %s for update", (request_id,))
        req = cur.fetchone()
        if not req:
            raise HTTPException(404, "Request not found")
        require_manage(cur, user, req["patient_id"])
        if req["status"] != "pending":
            raise HTTPException(409, f"Request is already {req['status']}")
        grant_id = None
        if body.approve:
            grant = _create_grant(cur, patient_id=req["patient_id"], doctor_id=req["doctor_id"], via="app_approval",
                                  hours=s.access_grant_hours, reason=req["reason"])
            grant_id = grant["id"]
            audit(cur, actor_profile_id=user.profile_id, actor_role=user.role, action="grant",
                  patient_id=req["patient_id"], target_type="access_grants", target_id=grant_id,
                  meta={"via": "app_approval"})
        else:
            audit(cur, actor_profile_id=user.profile_id, actor_role=user.role, action="access_denied",
                  patient_id=req["patient_id"], target_type="access_requests", target_id=request_id,
                  outcome="denied", meta={"reason": "patient_declined"})
        cur.execute(
            "update access_requests set status = %s, decided_at = now(), decided_by = %s, grant_id = %s where id = %s",
            ("approved" if body.approve else "denied", user.profile_id, grant_id, request_id),
        )
    return {"status": "approved" if body.approve else "denied", "grant_id": grant_id}


class BreakGlassIn(BaseModel):
    vital_id: str
    reason: str = Field(min_length=15, max_length=1000)


@router.post("/break-glass")
def break_glass(body: BreakGlassIn, user: CurrentUser = Depends(require_verified_doctor)):
    """Emergency override for an unconscious patient. Short-lived, logged, and the patient's circle is told."""
    s = get_settings()
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, body.vital_id)
        pid = patient["id"]
        grant = _create_grant(cur, patient_id=pid, doctor_id=user.doctor_id, via="break_glass",
                              hours=s.break_glass_hours, reason=body.reason)
        audit(cur, actor_profile_id=user.profile_id, actor_role="doctor", action="break_glass", patient_id=pid,
              target_type="access_grants", target_id=grant["id"],
              meta={"reason": body.reason, "expires_at": grant["expires_at"].isoformat()})
        notify(cur, profile_ids=patient_circle(cur, pid), kind="break_glass", patient_id=pid,
               title=f"Emergency access: {_doctor_label(cur, user.doctor_id)} opened the record",
               body=f"Reason given: {body.reason}. Access ends in {s.break_glass_hours} h. Please review it.",
               link="/patient/access")
    return {"status": "granted", "grant_id": grant["id"], "expires_at": grant["expires_at"], "vital_id": patient["vital_id"]}


@router.post("/{grant_id}/revoke")
def revoke(grant_id: UUID, user: CurrentUser = Depends(current_user)):
    with tx(user.profile_id) as cur:
        cur.execute("select * from access_grants where id = %s for update", (grant_id,))
        g = cur.fetchone()
        if not g:
            raise HTTPException(404, "Grant not found")
        require_manage(cur, user, g["patient_id"])
        if g["revoked_at"]:
            return {"ok": True, "already": True}
        cur.execute("update access_grants set revoked_at = now(), revoked_by = %s where id = %s", (user.profile_id, grant_id))
        audit(cur, actor_profile_id=user.profile_id, actor_role=user.role, action="revoke", patient_id=g["patient_id"],
              target_type="access_grants", target_id=grant_id)
    return {"ok": True}


@router.post("/{grant_id}/review")
def mark_reviewed(grant_id: UUID, user: CurrentUser = Depends(current_user)):
    """Patient/caregiver acknowledges a break-glass access after the fact."""
    with tx(user.profile_id) as cur:
        cur.execute("select patient_id from access_grants where id = %s", (grant_id,))
        g = cur.fetchone()
        if not g:
            raise HTTPException(404, "Grant not found")
        require_manage(cur, user, g["patient_id"])
        cur.execute("update access_grants set reviewed_at = now() where id = %s", (grant_id,))
    return {"ok": True}


@router.get("/me")
def my_access(patient_id: UUID | None = None, user: CurrentUser = Depends(current_user)):
    """Grants and pending requests on the patient's record, with doctor names."""
    with tx() as cur:
        pid = resolve_managed_patient(cur, user, patient_id)
        cur.execute(
            """
            select g.*, pr.full_name as doctor_name, d.hospital, d.specialty,
                   (g.revoked_at is null and g.expires_at > now()) as active
            from access_grants g join doctors d on d.id = g.doctor_id join profiles pr on pr.id = d.profile_id
            where g.patient_id = %s order by g.created_at desc limit 50
            """,
            (pid,),
        )
        grants = cur.fetchall()
        cur.execute(
            """
            select r.*, pr.full_name as doctor_name, d.hospital, d.specialty
            from access_requests r join doctors d on d.id = r.doctor_id join profiles pr on pr.id = d.profile_id
            where r.patient_id = %s and r.status = 'pending'
              and r.created_at > now() - make_interval(mins => %s)
            order by r.created_at desc
            """,
            (pid, get_settings().access_request_ttl_minutes),
        )
        requests = cur.fetchall()
    return {"grants": grants, "requests": requests}
