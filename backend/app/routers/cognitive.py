from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..access import require_manage, require_read, resolve_managed_patient
from ..auth import CurrentUser, current_user
from ..cognitive import scoring, stimuli
from ..cognitive.service import TEST_LABELS, check_for_alert, summarise_alert
from ..config import get_settings
from ..db import tx

router = APIRouter(prefix="/api/cognitive", tags=["cognitive"])

TestType = Literal["word_recall", "digit_span", "orientation", "trail"]


@router.get("/stimuli/{test_type}")
def get_stimuli(test_type: TestType, patient_id: UUID | None = None, user: CurrentUser = Depends(current_user)):
    if test_type == "word_recall":
        return stimuli.word_recall()
    if test_type == "digit_span":
        return stimuli.digit_span()
    if test_type == "trail":
        return stimuli.trail()
    with tx() as cur:
        pid = resolve_managed_patient(cur, user, patient_id)
        cur.execute("select city from patients where id = %s", (pid,))
        return stimuli.orientation(bool(cur.fetchone()["city"]))


class TestIn(BaseModel):
    test_type: TestType
    raw: dict
    duration_sec: float | None = Field(default=None, ge=0, le=3600)
    patient_id: UUID | None = None


@router.post("/tests")
def submit_test(body: TestIn, background: BackgroundTasks, user: CurrentUser = Depends(current_user)):
    """Scores the test on the server, stores it, then re-runs the decline rules for that test type."""
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, body.patient_id)
        cur.execute("select city from patients where id = %s", (pid,))
        city = cur.fetchone()["city"]
        score, max_score, detail = scoring.score(body.test_type, body.raw, body.duration_sec, city)
        cur.execute(
            """
            insert into cognitive_tests (patient_id, test_type, score, max_score, duration_sec, raw, administered_by)
            values (%s, %s, %s, %s, %s, %s, %s) returning *
            """,
            (pid, body.test_type, score, max_score, body.duration_sec, Jsonb({**body.raw, "scoring": detail}), user.profile_id),
        )
        test = cur.fetchone()
        alert = check_for_alert(cur, pid, body.test_type)
    if alert:
        background.add_task(summarise_alert, alert["id"])
    return {
        "test": test,
        "score": score,
        "max_score": max_score,
        "detail": detail,
        "alert_created": alert is not None,
        "note": "Screening signal only, not a diagnosis.",
    }


@router.get("/trend/{patient_id}")
def trend(patient_id: UUID, user: CurrentUser = Depends(current_user)):
    s = get_settings()
    with tx() as cur:
        require_read(cur, user, patient_id)
        cur.execute(
            """
            select id, test_type, score, max_score, round(100.0 * score / max_score, 1) as pct, taken_at, duration_sec
            from cognitive_tests where patient_id = %s order by taken_at
            """,
            (patient_id,),
        )
        rows = cur.fetchall()
        cur.execute("select * from cognitive_alerts where patient_id = %s order by created_at desc", (patient_id,))
        alerts = cur.fetchall()
    by_type: dict[str, list] = {}
    for r in rows:
        by_type.setdefault(r["test_type"], []).append(
            {"id": r["id"], "taken_at": r["taken_at"], "score": float(r["score"]), "max_score": float(r["max_score"]),
             "pct": float(r["pct"])}
        )
    summary = {}
    for t, pts in by_type.items():
        nb = s.cognitive_baseline_tests
        baseline = sum(p["pct"] for p in pts[:nb]) / min(nb, len(pts))
        recent = sum(p["pct"] for p in pts[-s.cognitive_recent_tests:]) / min(s.cognitive_recent_tests, len(pts))
        summary[t] = {
            "label": TEST_LABELS.get(t, t), "tests": len(pts), "baseline_pct": round(baseline, 1),
            "recent_pct": round(recent, 1), "baseline_ready": len(pts) >= nb, "last_taken": pts[-1]["taken_at"],
        }
    # weekly composite (mean of all test percentages that week) for the headline chart
    weekly: dict[str, list[float]] = {}
    for r in rows:
        iso = r["taken_at"].isocalendar()
        weekly.setdefault(f"{iso.year}-W{iso.week:02d}", []).append(float(r["pct"]))
    composite = [{"week": w, "pct": round(sum(v) / len(v), 1), "n": len(v)} for w, v in sorted(weekly.items())]
    return {
        "series": by_type,
        "summary": summary,
        "composite": composite,
        "alerts": alerts,
        "rules": {
            "baseline_tests": s.cognitive_baseline_tests,
            "recent_tests": s.cognitive_recent_tests,
            "drop_threshold_pct": s.cognitive_drop_threshold_pct,
            "trend_min_tests": s.cognitive_trend_min_tests,
            "trend_min_drop_pct": s.cognitive_trend_min_drop_pct,
        },
        "disclaimer": "Cognitive scores are screening signals compared with this person's own baseline, not a diagnosis.",
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: UUID, user: CurrentUser = Depends(current_user)):
    with tx(user.profile_id) as cur:
        cur.execute("select patient_id from cognitive_alerts where id = %s", (alert_id,))
        a = cur.fetchone()
        if not a:
            raise HTTPException(404, "Alert not found")
        if user.role == "doctor":
            require_read(cur, user, a["patient_id"])
        else:
            require_manage(cur, user, a["patient_id"])
        cur.execute(
            "update cognitive_alerts set status = 'acknowledged', acknowledged_by = %s, acknowledged_at = now() where id = %s",
            (user.profile_id, alert_id),
        )
    return {"ok": True}


@router.post("/alerts/{alert_id}/summarise")
def resummarise(alert_id: UUID, user: CurrentUser = Depends(current_user)):
    with tx() as cur:
        cur.execute("select patient_id from cognitive_alerts where id = %s", (alert_id,))
        a = cur.fetchone()
        if not a:
            raise HTTPException(404, "Alert not found")
        require_read(cur, user, a["patient_id"])
    summary = summarise_alert(alert_id)
    if summary is None:
        raise HTTPException(503, "AI is unavailable right now")
    return {"ai_summary": summary}


@router.get("/alerts")
def my_alerts(user: CurrentUser = Depends(current_user)):
    """Open alerts for every patient the caller can see (own, linked as caregiver, or granted as doctor)."""
    with tx() as cur:
        cur.execute(
            """
            select a.*, pt.vital_id, pr.full_name
            from cognitive_alerts a join patients pt on pt.id = a.patient_id join profiles pr on pr.id = pt.profile_id
            where a.status = 'open' and (
              pt.profile_id = %(me)s
              or exists (select 1 from caregiver_links cl where cl.patient_id = a.patient_id
                         and cl.caregiver_profile_id = %(me)s and cl.status = 'active')
              or exists (select 1 from access_grants g join doctors d on d.id = g.doctor_id
                         where g.patient_id = a.patient_id and d.profile_id = %(me)s and d.verification_status = 'verified'
                         and g.revoked_at is null and g.expires_at > now())
            )
            order by a.created_at desc
            """,
            {"me": user.profile_id},
        )
        return cur.fetchall()
