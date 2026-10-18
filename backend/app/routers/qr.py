from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..access import resolve_managed_patient
from ..audit import audit
from ..auth import CurrentUser, current_user
from ..config import get_settings
from ..db import tx
from ..ids import hash_token, new_qr_nonce, qr_token_from_nonce

router = APIRouter(prefix="/api/qr", tags=["qr"])


def _issue(cur, patient_id: UUID) -> dict:
    nonce = new_qr_nonce()
    token = qr_token_from_nonce(nonce)
    cur.execute(
        "insert into qr_tokens (patient_id, nonce, token_hash) values (%s, %s, %s) returning id, created_at",
        (patient_id, nonce, hash_token(token)),
    )
    row = cur.fetchone()
    return {"token": token, "created_at": row["created_at"]}


def _payload(token: str, created_at, last_used_at=None) -> dict:
    return {
        "token": token,
        "url": f"{get_settings().frontend_url.rstrip('/')}/e/{token}",
        "created_at": created_at,
        "last_used_at": last_used_at,
        "active": True,
    }


@router.get("/current")
def current(patient_id: UUID | None = None, user: CurrentUser = Depends(current_user)):
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, patient_id)
        cur.execute(
            "select * from qr_tokens where patient_id = %s and revoked_at is null order by created_at desc limit 1", (pid,)
        )
        row = cur.fetchone()
        if not row:
            return {"active": False}
        return _payload(qr_token_from_nonce(row["nonce"]), row["created_at"], row["last_used_at"])


class PatientRef(BaseModel):
    patient_id: UUID | None = None


@router.post("/rotate")
def rotate(body: PatientRef, user: CurrentUser = Depends(current_user)):
    """Issues a new token and revokes every older one; printed cards with the old QR stop working."""
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, body.patient_id)
        cur.execute("update qr_tokens set revoked_at = now() where patient_id = %s and revoked_at is null", (pid,))
        issued = _issue(cur, pid)
        audit(cur, actor_profile_id=user.profile_id, actor_role=user.role, action="revoke", patient_id=pid,
              target_type="qr_tokens", meta={"reason": "rotated"})
    return _payload(issued["token"], issued["created_at"])


@router.post("/revoke")
def revoke(body: PatientRef, user: CurrentUser = Depends(current_user)):
    """Disables the QR entirely until a new one is issued."""
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, body.patient_id)
        cur.execute("update qr_tokens set revoked_at = now() where patient_id = %s and revoked_at is null", (pid,))
        audit(cur, actor_profile_id=user.profile_id, actor_role=user.role, action="revoke", patient_id=pid,
              target_type="qr_tokens", meta={"reason": "revoked"})
    return {"active": False}
