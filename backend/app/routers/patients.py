from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field

from ..access import require_manage, require_read, resolve_managed_patient
from ..audit import audit
from ..auth import CurrentUser, current_user, require_role
from ..db import tx
from ..ids import hash_token, new_qr_nonce, new_vital_id, qr_token_from_nonce
from ..pin import hash_pin, verify_pin
from ..records import load_record

router = APIRouter(prefix="/api/patients", tags=["patients"])


class RegisterIdIn(BaseModel):
    dob: date | None = None
    gender: str | None = None
    blood_group: str | None = None
    city: str | None = None
    has_cognitive_condition: bool = False


@router.post("/register-id")
def register_id(body: RegisterIdIn, user: CurrentUser = Depends(require_role("patient"))):
    """Creates the patient row with a random, non-sequential VitalID, plus the first QR token."""
    if user.patient_id:
        with tx() as cur:
            cur.execute("select vital_id from patients where id = %s", (user.patient_id,))
            return {"patient_id": user.patient_id, "vital_id": cur.fetchone()["vital_id"], "created": False}
    for _ in range(8):
        vital_id = new_vital_id()
        try:
            with tx(user.profile_id) as cur:
                cur.execute(
                    """
                    insert into patients (profile_id, vital_id, dob, gender, blood_group, city, has_cognitive_condition)
                    values (%s, %s, %s, %s, %s, %s, %s) returning id
                    """,
                    (user.profile_id, vital_id, body.dob, body.gender, body.blood_group, body.city, body.has_cognitive_condition),
                )
                patient_id = cur.fetchone()["id"]
                cur.execute("insert into patient_secrets (patient_id) values (%s)", (patient_id,))
                nonce = new_qr_nonce()
                cur.execute(
                    "insert into qr_tokens (patient_id, nonce, token_hash) values (%s, %s, %s)",
                    (patient_id, nonce, hash_token(qr_token_from_nonce(nonce))),
                )
                audit(cur, actor_profile_id=user.profile_id, actor_role="patient", action="create",
                      patient_id=patient_id, target_type="patients", target_id=patient_id)
            return {"patient_id": patient_id, "vital_id": vital_id, "created": True}
        except UniqueViolation as e:
            if "profile_id" in str(e):
                raise HTTPException(409, "Patient record already exists")
            continue  # VitalID collision: draw again
    raise HTTPException(500, "Could not allocate a VitalID")


@router.get("/me")
def me(patient_id: UUID | None = None, user: CurrentUser = Depends(current_user)):
    """Own full record (or, for a caregiver, a linked patient's record)."""
    with tx() as cur:
        pid = resolve_managed_patient(cur, user, patient_id)
        return load_record(cur, pid, viewer="owner")


class PinIn(BaseModel):
    pin: str = Field(pattern=r"^\d{4,6}$")
    current_pin: str | None = None
    patient_id: UUID | None = None


@router.post("/pin")
def set_pin(body: PinIn, user: CurrentUser = Depends(current_user)):
    """Sets the consent PIN a doctor needs (with the VitalID) to open the full record."""
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, body.patient_id)
        cur.execute("select pin_hash from patient_secrets where patient_id = %s for update", (pid,))
        row = cur.fetchone()
        if row and row["pin_hash"] and user.patient_id == pid:
            # the patient must know the old PIN; an active caregiver can reset it on their behalf
            if not body.current_pin or not verify_pin(row["pin_hash"], body.current_pin):
                raise HTTPException(403, "Current PIN is incorrect")
        cur.execute(
            """
            insert into patient_secrets (patient_id, pin_hash, pin_set_at) values (%s, %s, now())
            on conflict (patient_id) do update set pin_hash = excluded.pin_hash, pin_set_at = now()
            """,
            (pid, hash_pin(body.pin)),
        )
        audit(cur, actor_profile_id=user.profile_id, actor_role=user.role, action="edit", patient_id=pid,
              target_type="patient_secrets", meta={"field": "consent_pin"})
    return {"ok": True}


VERIFIABLE = {"conditions", "medications", "allergies", "history_entries"}


@router.post("/records/{table}/{record_id}/verify")
def verify_record(table: str, record_id: UUID, user: CurrentUser = Depends(current_user)):
    """Patient/caregiver (or a doctor with access) confirms an unverified entry."""
    if table not in VERIFIABLE:
        raise HTTPException(404, "Unknown record type")
    with tx(user.profile_id) as cur:
        cur.execute(f"select patient_id from {table} where id = %s", (record_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Record not found")
        if user.role == "doctor":
            require_read(cur, user, row["patient_id"])
        else:
            require_manage(cur, user, row["patient_id"])
        cur.execute(f"update {table} set verified = true where id = %s", (record_id,))
    return {"ok": True}
