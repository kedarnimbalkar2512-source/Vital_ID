from typing import Any
from uuid import UUID

from psycopg import Cursor
from psycopg.types.json import Jsonb


def audit(
    cur: Cursor,
    *,
    actor_profile_id: UUID | None,
    actor_role: str | None,
    action: str,
    patient_id: UUID | None,
    target_type: str | None = None,
    target_id: UUID | None = None,
    outcome: str = "success",
    meta: dict[str, Any] | None = None,
) -> None:
    """Insert an audit row. `meta` must never contain secrets (PINs, tokens)."""
    cur.execute(
        """
        insert into audit_logs (actor_profile_id, actor_role, action, target_type, target_id, patient_id, outcome, meta)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (actor_profile_id, actor_role, action, target_type, target_id, patient_id, outcome, Jsonb(meta or {})),
    )


def notify(
    cur: Cursor,
    *,
    profile_ids: list[UUID],
    kind: str,
    title: str,
    body: str | None = None,
    patient_id: UUID | None = None,
    link: str | None = None,
) -> None:
    for pid in dict.fromkeys(profile_ids):
        cur.execute(
            "insert into notifications (profile_id, patient_id, kind, title, body, link) values (%s, %s, %s, %s, %s, %s)",
            (pid, patient_id, kind, title, body, link),
        )


def patient_circle(cur: Cursor, patient_id: UUID, *, include_patient: bool = True, include_doctors: bool = False) -> list[UUID]:
    """Profile ids that should hear about events on this patient: the patient, active caregivers,
    and optionally doctors who currently hold access."""
    ids: list[UUID] = []
    if include_patient:
        cur.execute("select profile_id from patients where id = %s", (patient_id,))
        row = cur.fetchone()
        if row:
            ids.append(row["profile_id"])
    cur.execute(
        "select caregiver_profile_id from caregiver_links where patient_id = %s and status = 'active'", (patient_id,)
    )
    ids += [r["caregiver_profile_id"] for r in cur.fetchall()]
    if include_doctors:
        cur.execute(
            """
            select distinct d.profile_id from access_grants g join doctors d on d.id = g.doctor_id
            where g.patient_id = %s and g.revoked_at is null and g.expires_at > now()
            """,
            (patient_id,),
        )
        ids += [r["profile_id"] for r in cur.fetchall()]
    return ids
