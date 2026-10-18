"""Public emergency view. Anyone with the QR sees a whitelisted minimal dataset, and every scan is logged."""

import hashlib
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request

from ..audit import audit, notify, patient_circle
from ..config import get_settings
from ..db import tx
from ..ids import hash_token
from ..records import age_from_dob
from ..storage import signed_url

router = APIRouter(prefix="/api/emergency", tags=["emergency"])

_hits: dict[str, deque] = defaultdict(deque)


def _rate_limited(ip: str) -> bool:
    now, window = time.time(), 60
    q = _hits[ip]
    while q and q[0] < now - window:
        q.popleft()
    q.append(now)
    return len(q) > get_settings().emergency_rate_limit_per_minute


@router.get("/{token}")
def emergency_view(token: str, request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    if _rate_limited(ip):
        raise HTTPException(429, "Too many requests")
    s = get_settings()
    with tx() as cur:
        cur.execute(
            "select id, patient_id from qr_tokens where token_hash = %s and revoked_at is null", (hash_token(token),)
        )
        qr = cur.fetchone()
        if not qr:
            raise HTTPException(404, "This QR code is not active. It may have been replaced by a newer card.")
        pid = qr["patient_id"]
        cur.execute(
            """
            select pt.vital_id, pt.blood_group, pt.photo_url, pt.has_cognitive_condition, pt.emergency_note,
                   pt.dob, pt.is_demo, pt.updated_at, pr.full_name
            from patients pt join profiles pr on pr.id = pt.profile_id where pt.id = %s
            """,
            (pid,),
        )
        p = cur.fetchone()
        cur.execute(
            """
            select substance, reaction, severity, verified from allergies
            where patient_id = %s and severity in ('severe', 'life-threatening', 'moderate')
            order by case severity when 'life-threatening' then 0 when 'severe' then 1 else 2 end
            """,
            (pid,),
        )
        allergies = cur.fetchall()
        cur.execute(
            "select name, dose, frequency from medications where patient_id = %s and status = 'active' and is_critical",
            (pid,),
        )
        meds = cur.fetchall()
        cur.execute(
            "select name from conditions where patient_id = %s and status = 'active' and is_critical", (pid,)
        )
        conditions = [r["name"] for r in cur.fetchall()]
        cur.execute(
            "select name, relationship, phone from emergency_contacts where patient_id = %s order by priority limit 3",
            (pid,),
        )
        contacts = cur.fetchall()
        cur.execute(
            """
            select greatest(
              (select max(updated_at) from allergies where patient_id = %(p)s),
              (select max(updated_at) from medications where patient_id = %(p)s),
              (select max(updated_at) from conditions where patient_id = %(p)s),
              (select max(updated_at) from emergency_contacts where patient_id = %(p)s),
              (select updated_at from patients where id = %(p)s)
            ) as last_updated
            """,
            {"p": pid},
        )
        last_updated = cur.fetchone()["last_updated"]

        cur.execute("update qr_tokens set last_used_at = now() where id = %s", (qr["id"],))
        audit(cur, actor_profile_id=None, actor_role="emergency_viewer", action="emergency_scan", patient_id=pid,
              target_type="qr_tokens", target_id=qr["id"],
              meta={"ip_hash": hashlib.sha256(ip.encode()).hexdigest()[:16],
                    "user_agent": (request.headers.get("user-agent") or "")[:120]})
        # tell the patient's circle, at most once per cooldown window
        cur.execute(
            """
            select 1 from notifications where patient_id = %s and kind = 'emergency_scan'
              and created_at > now() - make_interval(mins => %s) limit 1
            """,
            (pid, s.emergency_notify_cooldown_minutes),
        )
        if not cur.fetchone():
            notify(cur, profile_ids=patient_circle(cur, pid), kind="emergency_scan", patient_id=pid,
                   title="Emergency QR was scanned",
                   body="Someone opened the emergency card. If this wasn't expected, check on them.",
                   link="/patient/access")

    return {
        "full_name": p["full_name"],
        "vital_id": p["vital_id"],
        "photo_url": signed_url("photos", p["photo_url"], 300) if p["photo_url"] else None,
        "blood_group": p["blood_group"],
        "age": age_from_dob(p["dob"]),
        "has_cognitive_condition": p["has_cognitive_condition"],
        "emergency_note": p["emergency_note"],
        "allergies": allergies,
        "critical_medications": meds,
        "key_conditions": conditions,
        "emergency_contacts": contacts,
        "last_updated": last_updated,
        "is_demo": p["is_demo"],
    }
