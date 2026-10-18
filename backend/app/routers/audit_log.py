from uuid import UUID

from fastapi import APIRouter, Depends

from ..access import resolve_managed_patient
from ..auth import CurrentUser, current_user
from ..db import tx

router = APIRouter(prefix="/api/audit", tags=["audit"])

ACTION_TEXT = {
    "view": "viewed the record",
    "create": "added",
    "edit": "changed",
    "delete": "removed",
    "grant": "was granted access",
    "revoke": "revoked",
    "break_glass": "used emergency (break-glass) access",
    "emergency_scan": "scanned the emergency QR",
    "access_request": "requested access",
    "access_denied": "was denied access",
    "ai_brief": "generated an AI brief",
    "verify": "verified",
    "link": "linked",
}


@router.get("/me")
def my_audit(patient_id: UUID | None = None, limit: int = 100, user: CurrentUser = Depends(current_user)):
    """'Who viewed my record': every access and change, newest first."""
    with tx() as cur:
        pid = resolve_managed_patient(cur, user, patient_id)
        cur.execute(
            """
            select l.id, l.action, l.target_type, l.outcome, l.meta, l.at, l.actor_role,
                   pr.full_name as actor_name, d.hospital as actor_hospital
            from audit_logs l
            left join profiles pr on pr.id = l.actor_profile_id
            left join doctors d on d.profile_id = l.actor_profile_id
            where l.patient_id = %s
            order by l.at desc limit %s
            """,
            (pid, min(max(limit, 1), 500)),
        )
        rows = cur.fetchall()
    for r in rows:
        r["summary"] = ACTION_TEXT.get(r["action"], r["action"])
    return rows
