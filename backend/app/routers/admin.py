from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..audit import audit, notify
from ..auth import CurrentUser, require_role
from ..db import tx

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/doctors")
def list_doctors(status: str | None = None, user: CurrentUser = Depends(require_role("admin"))):
    with tx() as cur:
        cur.execute(
            """
            select d.*, pr.full_name, pr.phone, pr.is_demo, u.email
            from doctors d join profiles pr on pr.id = d.profile_id left join auth.users u on u.id = pr.user_id
            where (%s::text is null or d.verification_status = %s)
            order by (d.verification_status = 'pending') desc, d.created_at desc
            """,
            (status, status),
        )
        return cur.fetchall()


class VerifyIn(BaseModel):
    approve: bool = True


@router.post("/doctors/{doctor_id}/verify")
def verify_doctor(doctor_id: UUID, body: VerifyIn, user: CurrentUser = Depends(require_role("admin"))):
    """Prototype licence check: an admin reviews the licence number and approves. Production plan:
    verify against the NMC / State Medical Council registry."""
    status = "verified" if body.approve else "rejected"
    with tx(user.profile_id) as cur:
        cur.execute(
            """
            update doctors set verification_status = %s, verified_at = case when %s then now() else null end, verified_by = %s
            where id = %s returning profile_id, licence_no
            """,
            (status, body.approve, user.profile_id, doctor_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Doctor not found")
        audit(cur, actor_profile_id=user.profile_id, actor_role="admin", action="verify", patient_id=None,
              target_type="doctors", target_id=doctor_id, meta={"status": status})
        notify(cur, profile_ids=[row["profile_id"]], kind="info",
               title="Your doctor account was verified" if body.approve else "Your doctor verification was rejected",
               body=None if body.approve else "Contact the VitalID admin if you think this is a mistake.", link="/doctor")
    return {"status": status}


@router.get("/stats")
def stats(user: CurrentUser = Depends(require_role("admin"))):
    """Counts only. Admins have no routine access to clinical data."""
    with tx() as cur:
        cur.execute(
            """
            select (select count(*) from patients) as patients,
                   (select count(*) from doctors where verification_status = 'verified') as verified_doctors,
                   (select count(*) from doctors where verification_status = 'pending') as pending_doctors,
                   (select count(*) from caregiver_links where status = 'active') as caregivers,
                   (select count(*) from access_grants where granted_via = 'break_glass' and created_at > now() - interval '30 days') as break_glass_30d
            """
        )
        return cur.fetchone()
