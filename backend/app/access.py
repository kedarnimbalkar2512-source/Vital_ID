"""Who may see or change which patient. Mirrors the RLS helpers in the database."""

from uuid import UUID

from fastapi import HTTPException, status
from psycopg import Cursor

from .auth import CurrentUser


def patient_by_vital_id(cur: Cursor, vital_id: str) -> dict:
    cur.execute(
        """
        select pt.*, pr.full_name, pr.phone, pr.is_demo as profile_is_demo
        from patients pt join profiles pr on pr.id = pt.profile_id
        where pt.vital_id = %s
        """,
        (vital_id.strip().upper(),),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No patient with that VitalID")
    return row


def patient_by_id(cur: Cursor, patient_id: UUID) -> dict:
    cur.execute(
        """
        select pt.*, pr.full_name, pr.phone, pr.is_demo as profile_is_demo
        from patients pt join profiles pr on pr.id = pt.profile_id
        where pt.id = %s
        """,
        (patient_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return row


def active_grant(cur: Cursor, doctor_id: UUID, patient_id: UUID) -> dict | None:
    cur.execute(
        """
        select * from access_grants
        where doctor_id = %s and patient_id = %s and scope = 'full'
          and revoked_at is null and expires_at > now()
        order by expires_at desc limit 1
        """,
        (doctor_id, patient_id),
    )
    return cur.fetchone()


def is_active_caregiver(cur: Cursor, profile_id: UUID, patient_id: UUID) -> bool:
    cur.execute(
        "select 1 from caregiver_links where caregiver_profile_id = %s and patient_id = %s and status = 'active'",
        (profile_id, patient_id),
    )
    return cur.fetchone() is not None


def can_manage(cur: Cursor, user: CurrentUser, patient_id: UUID) -> bool:
    """Patient themself or an active caregiver."""
    if user.patient_id == patient_id:
        return True
    return user.role == "caregiver" and is_active_caregiver(cur, user.profile_id, patient_id)


def require_manage(cur: Cursor, user: CurrentUser, patient_id: UUID) -> None:
    if not can_manage(cur, user, patient_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't manage this patient's record")


def require_read(cur: Cursor, user: CurrentUser, patient_id: UUID) -> dict | None:
    """Patient, active caregiver, or verified doctor with an active grant. Returns the grant for doctors."""
    if can_manage(cur, user, patient_id):
        return None
    if user.is_verified_doctor:
        grant = active_grant(cur, user.doctor_id, patient_id)
        if grant:
            return grant
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No active consent for this patient. Request access first.")
    raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to this patient")


def resolve_managed_patient(cur: Cursor, user: CurrentUser, patient_id: UUID | None) -> UUID:
    """For patient/caregiver endpoints: default to the caller's own record."""
    pid = patient_id or user.patient_id
    if pid is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "patient_id is required")
    require_manage(cur, user, pid)
    return pid
