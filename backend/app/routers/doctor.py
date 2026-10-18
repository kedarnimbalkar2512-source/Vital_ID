"""Doctor-side record access. Every read is grant-checked and logged."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..access import patient_by_vital_id, require_read
from ..audit import audit, notify
from ..auth import CurrentUser, require_verified_doctor
from ..db import tx
from ..records import load_record

router = APIRouter(prefix="/api", tags=["doctor"])


@router.get("/doctor/patients")
def my_patients(user: CurrentUser = Depends(require_verified_doctor)):
    """Patients this doctor currently has access to."""
    with tx() as cur:
        cur.execute(
            """
            select distinct on (pt.id) pt.id as patient_id, pt.vital_id, pr.full_name, pt.is_demo,
                   g.id as grant_id, g.granted_via, g.expires_at,
                   (select count(*) from cognitive_alerts a where a.patient_id = pt.id and a.status = 'open') as open_alerts
            from access_grants g join patients pt on pt.id = g.patient_id join profiles pr on pr.id = pt.profile_id
            where g.doctor_id = %s and g.revoked_at is null and g.expires_at > now()
            order by pt.id, g.expires_at desc
            """,
            (user.doctor_id,),
        )
        return cur.fetchall()


@router.get("/patients/{vital_id}/record")
def read_record(vital_id: str, user: CurrentUser = Depends(require_verified_doctor)):
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, vital_id)
        grant = require_read(cur, user, patient["id"])
        audit(cur, actor_profile_id=user.profile_id, actor_role="doctor", action="view", patient_id=patient["id"],
              target_type="patients", target_id=patient["id"],
              meta={"grant_id": str(grant["id"]) if grant else None, "via": grant["granted_via"] if grant else None})
        record = load_record(cur, patient["id"], viewer="doctor")
        record["grant"] = grant
        return record


class MedicationIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    dose: str | None = None
    frequency: str | None = None
    start_date: date | None = None
    is_critical: bool = False
    warnings_acknowledged: list[str] = Field(default_factory=list, description="descriptions of warnings the doctor saw")


class ConditionIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    status: str = "active"
    onset_date: date | None = None
    notes: str | None = None
    is_critical: bool = False


class AllergyIn(BaseModel):
    substance: str = Field(min_length=2, max_length=120)
    reaction: str | None = None
    severity: str = "moderate"


class NoteIn(BaseModel):
    note: str = Field(min_length=2, max_length=5000)
    sensitive: bool = False


def _doctor_name(cur, user: CurrentUser) -> str:
    cur.execute("select hospital from doctors where id = %s", (user.doctor_id,))
    h = cur.fetchone()["hospital"]
    return f"Dr. {user.full_name}" + (f", {h}" if h else "")


@router.post("/patients/{vital_id}/medications")
def add_medication(vital_id: str, body: MedicationIn, user: CurrentUser = Depends(require_verified_doctor)):
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, vital_id)
        require_read(cur, user, patient["id"])
        cur.execute(
            """
            insert into medications (patient_id, name, dose, frequency, start_date, is_critical, prescriber,
                                     source, verified, recorded_by)
            values (%s, %s, %s, %s, %s, %s, %s, 'doctor-entered', true, %s) returning *
            """,
            (patient["id"], body.name, body.dose, body.frequency, body.start_date or date.today(), body.is_critical,
             _doctor_name(cur, user), user.profile_id),
        )
        med = cur.fetchone()
        if body.warnings_acknowledged:
            audit(cur, actor_profile_id=user.profile_id, actor_role="doctor", action="edit", patient_id=patient["id"],
                  target_type="medications", target_id=med["id"],
                  meta={"warnings_acknowledged": body.warnings_acknowledged[:10]})
        return med


@router.post("/patients/{vital_id}/conditions")
def add_condition(vital_id: str, body: ConditionIn, user: CurrentUser = Depends(require_verified_doctor)):
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, vital_id)
        require_read(cur, user, patient["id"])
        cur.execute(
            """
            insert into conditions (patient_id, name, status, onset_date, notes, is_critical, source, verified, recorded_by)
            values (%s, %s, %s, %s, %s, %s, 'doctor-entered', true, %s) returning *
            """,
            (patient["id"], body.name, body.status, body.onset_date, body.notes, body.is_critical, user.profile_id),
        )
        return cur.fetchone()


@router.post("/patients/{vital_id}/allergies")
def add_allergy(vital_id: str, body: AllergyIn, user: CurrentUser = Depends(require_verified_doctor)):
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, vital_id)
        require_read(cur, user, patient["id"])
        cur.execute(
            """
            insert into allergies (patient_id, substance, reaction, severity, source, verified, recorded_by)
            values (%s, %s, %s, %s, 'doctor-entered', true, %s) returning *
            """,
            (patient["id"], body.substance, body.reaction, body.severity, user.profile_id),
        )
        return cur.fetchone()


@router.post("/patients/{vital_id}/notes")
def add_note(vital_id: str, body: NoteIn, user: CurrentUser = Depends(require_verified_doctor)):
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, vital_id)
        require_read(cur, user, patient["id"])
        cur.execute(
            "insert into clinician_notes (patient_id, doctor_id, note, sensitive) values (%s, %s, %s, %s) returning *",
            (patient["id"], user.doctor_id, body.note, body.sensitive),
        )
        return cur.fetchone()


@router.post("/notes/{note_id}/release")
def release_note(note_id: UUID, user: CurrentUser = Depends(require_verified_doctor)):
    """The authoring doctor releases a clinician-only note to the patient."""
    with tx(user.profile_id) as cur:
        cur.execute("select * from clinician_notes where id = %s", (note_id,))
        note = cur.fetchone()
        if not note or note["doctor_id"] != user.doctor_id:
            raise HTTPException(404, "Note not found")
        cur.execute("update clinician_notes set released_at = now() where id = %s", (note_id,))
        cur.execute("select profile_id from patients where id = %s", (note["patient_id"],))
        notify(cur, profile_ids=[cur.fetchone()["profile_id"]], kind="info", patient_id=note["patient_id"],
               title="A clinician note was shared with you", link="/patient/profile")
    return {"ok": True}
