from uuid import UUID

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, current_user
from ..db import tx

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me")
def whoami(user: CurrentUser = Depends(current_user)):
    with tx() as cur:
        cur.execute("select full_name, phone, is_demo from profiles where id = %s", (user.profile_id,))
        p = cur.fetchone()
        vital_id = None
        if user.patient_id:
            cur.execute("select vital_id from patients where id = %s", (user.patient_id,))
            vital_id = cur.fetchone()["vital_id"]
        cur.execute("select count(*) as n from notifications where profile_id = %s and read_at is null", (user.profile_id,))
        unread = cur.fetchone()["n"]
    return {
        "profile_id": user.profile_id, "role": user.role, "full_name": p["full_name"], "phone": p["phone"],
        "is_demo": p["is_demo"], "patient_id": user.patient_id, "vital_id": vital_id,
        "doctor_id": user.doctor_id, "doctor_status": user.doctor_status, "unread_notifications": unread,
    }


@router.get("/notifications")
def notifications(user: CurrentUser = Depends(current_user)):
    with tx() as cur:
        cur.execute(
            "select * from notifications where profile_id = %s order by created_at desc limit 50", (user.profile_id,)
        )
        return cur.fetchall()


@router.post("/notifications/read")
def mark_read(ids: list[UUID] | None = None, user: CurrentUser = Depends(current_user)):
    with tx() as cur:
        if ids:
            cur.execute("update notifications set read_at = now() where profile_id = %s and id = any(%s) and read_at is null",
                        (user.profile_id, ids))
        else:
            cur.execute("update notifications set read_at = now() where profile_id = %s and read_at is null", (user.profile_id,))
    return {"ok": True}
