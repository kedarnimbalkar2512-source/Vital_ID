from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..access import resolve_managed_patient
from ..audit import notify
from ..auth import CurrentUser, current_user
from ..db import tx

router = APIRouter(prefix="/api/notes", tags=["notes"])


class PatientRef(BaseModel):
    patient_id: UUID | None = None


@router.post("/request-access")
def request_note_access(body: PatientRef, user: CurrentUser = Depends(current_user)):
    """Patients have a right to their records: they can ask the authoring doctors to release
    clinician-only notes."""
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, body.patient_id)
        cur.execute(
            """
            update clinician_notes set patient_access_requested = true, access_requested_at = now()
            where patient_id = %s and sensitive and released_at is null returning doctor_id
            """,
            (pid,),
        )
        doctor_ids = list({r["doctor_id"] for r in cur.fetchall()})
        if doctor_ids:
            cur.execute("select vital_id from patients where id = %s", (pid,))
            vid = cur.fetchone()["vital_id"]
            cur.execute("select profile_id from doctors where id = any(%s)", (doctor_ids,))
            notify(cur, profile_ids=[r["profile_id"] for r in cur.fetchall()], kind="note_access_request",
                   patient_id=pid, title=f"Patient {vid} asked to see your clinician-only notes",
                   link=f"/doctor/patient/{vid}")
    return {"requested": len(doctor_ids)}
