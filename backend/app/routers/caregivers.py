from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..access import patient_by_vital_id, require_manage
from ..audit import audit, notify
from ..auth import CurrentUser, current_user, require_role
from ..db import tx

router = APIRouter(prefix="/api/caregivers", tags=["caregivers"])


class LinkIn(BaseModel):
    vital_id: str
    relationship: str = Field(min_length=2, max_length=60)


@router.post("/link")
def request_link(body: LinkIn, user: CurrentUser = Depends(require_role("caregiver"))):
    """A family member asks to be linked. Nothing is shared until the patient approves."""
    with tx(user.profile_id) as cur:
        patient = patient_by_vital_id(cur, body.vital_id)
        cur.execute(
            """
            insert into caregiver_links (patient_id, caregiver_profile_id, relationship, status)
            values (%s, %s, %s, 'pending')
            on conflict (patient_id, caregiver_profile_id)
              do update set status = case when caregiver_links.status = 'active' then 'active' else 'pending' end,
                            relationship = excluded.relationship
            returning id, status
            """,
            (patient["id"], user.profile_id, body.relationship),
        )
        link = cur.fetchone()
        if link["status"] == "pending":
            notify(cur, profile_ids=[patient["profile_id"]], kind="caregiver_request", patient_id=patient["id"],
                   title=f"{user.full_name} wants to be linked as your {body.relationship}",
                   body="Approve only if you trust them to manage your records and receive alerts.",
                   link="/patient/access")
    return link


class DecideIn(BaseModel):
    approve: bool


@router.post("/links/{link_id}/decide")
def decide(link_id: UUID, body: DecideIn, user: CurrentUser = Depends(current_user)):
    with tx(user.profile_id) as cur:
        cur.execute("select * from caregiver_links where id = %s", (link_id,))
        link = cur.fetchone()
        if not link:
            raise HTTPException(404, "Link not found")
        if user.patient_id != link["patient_id"]:
            raise HTTPException(403, "Only the patient can approve or remove a caregiver")
        status = "active" if body.approve else "revoked"
        cur.execute("update caregiver_links set status = %s, decided_at = now() where id = %s", (status, link_id))
        audit(cur, actor_profile_id=user.profile_id, actor_role="patient", action="link" if body.approve else "revoke",
              patient_id=link["patient_id"], target_type="caregiver_links", target_id=link_id)
        notify(cur, profile_ids=[link["caregiver_profile_id"]], kind="info", patient_id=link["patient_id"],
               title="Caregiver link approved" if body.approve else "Caregiver link removed", link="/caregiver")
    return {"status": status}


@router.get("/for-patient")
def caregivers_of_me(user: CurrentUser = Depends(require_role("patient"))):
    if not user.patient_id:
        return []
    with tx() as cur:
        cur.execute(
            """
            select cl.id, cl.relationship, cl.status, cl.created_at, pr.full_name, pr.phone
            from caregiver_links cl join profiles pr on pr.id = cl.caregiver_profile_id
            where cl.patient_id = %s and cl.status <> 'revoked' order by cl.created_at
            """,
            (user.patient_id,),
        )
        return cur.fetchall()


@router.get("/me")
def my_patients(user: CurrentUser = Depends(require_role("caregiver"))):
    """Linked patients with what a caregiver needs at a glance."""
    with tx() as cur:
        cur.execute(
            """
            select cl.id as link_id, cl.status, cl.relationship, pt.id as patient_id, pt.vital_id, pt.is_demo,
                   pr.full_name,
                   (select count(*) from cognitive_alerts a where a.patient_id = pt.id and a.status = 'open') as open_alerts,
                   (select count(*) from medications m where m.patient_id = pt.id and m.status = 'active') as active_meds,
                   (select max(taken_at) from cognitive_tests t where t.patient_id = pt.id) as last_test
            from caregiver_links cl join patients pt on pt.id = cl.patient_id join profiles pr on pr.id = pt.profile_id
            where cl.caregiver_profile_id = %s and cl.status <> 'revoked'
            order by cl.created_at
            """,
            (user.profile_id,),
        )
        rows = cur.fetchall()
    for r in rows:
        if r["status"] != "active":  # nothing about the patient beyond the ID until approved
            r.update(full_name=None, open_alerts=None, active_meds=None, last_test=None)
    return rows
