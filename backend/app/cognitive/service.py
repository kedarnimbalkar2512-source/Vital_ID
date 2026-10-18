from uuid import UUID

from psycopg import Cursor
from psycopg.types.json import Jsonb

from ..ai import prompts
from ..ai.llm import AIUnavailable, complete_json
from ..ai.schemas import AlertSummary
from ..audit import notify, patient_circle
from ..db import tx
from . import alerts

TEST_LABELS = {
    "word_recall": "Word recall",
    "digit_span": "Digit span",
    "orientation": "Orientation",
    "trail": "Trail making",
    "clock": "Clock drawing",
}


def series(cur: Cursor, patient_id: UUID, test_type: str) -> list[float]:
    cur.execute(
        "select 100.0 * score / max_score as pct from cognitive_tests where patient_id = %s and test_type = %s order by taken_at",
        (patient_id, test_type),
    )
    return [float(r["pct"]) for r in cur.fetchall()]


def check_for_alert(cur: Cursor, patient_id: UUID, test_type: str, *, notify_people: bool = True) -> dict | None:
    """Re-evaluates the rules for one test type. Opens a new alert, or refreshes the open one.
    Returns the alert row when it was created (so the caller can ask the AI for a summary)."""
    finding = alerts.evaluate(series(cur, patient_id, test_type))
    if not finding:
        return None
    cur.execute(
        "select * from cognitive_alerts where patient_id = %s and test_type = %s and status = 'open'",
        (patient_id, test_type),
    )
    existing = cur.fetchone()
    if existing:
        cur.execute(
            """
            update cognitive_alerts set rule = %s, baseline_score = %s, recent_score = %s, drop_pct = %s
            where id = %s returning *
            """,
            (finding.rule, finding.baseline_pct, finding.recent_pct, finding.drop_pct, existing["id"]),
        )
        cur.fetchone()
        return None
    cur.execute(
        """
        insert into cognitive_alerts (patient_id, test_type, rule, baseline_score, recent_score, drop_pct)
        values (%s, %s, %s, %s, %s, %s) returning *
        """,
        (patient_id, test_type, finding.rule, finding.baseline_pct, finding.recent_pct, finding.drop_pct),
    )
    alert = cur.fetchone()
    if notify_people:
        label = TEST_LABELS.get(test_type, test_type)
        notify(
            cur,
            profile_ids=patient_circle(cur, patient_id, include_patient=False, include_doctors=True),
            kind="cognitive_alert",
            title=f"Cognitive screening signal: {label}",
            body=(
                f"{label} scores are {finding.drop_pct:.0f}% below this patient's own baseline "
                f"({finding.baseline_pct:.0f}% → {finding.recent_pct:.0f}%). This is a screening signal, "
                "not a diagnosis. Please consult a doctor."
            ),
            patient_id=patient_id,
            link="/alerts",
        )
    return alert


def summarise_alert(alert_id: UUID) -> str | None:
    """Asks the LLM for a plain-language note. Only numbers and the test type are sent."""
    with tx() as cur:
        cur.execute("select * from cognitive_alerts where id = %s", (alert_id,))
        alert = cur.fetchone()
        if not alert:
            return None
        recent = series(cur, alert["patient_id"], alert["test_type"])[-8:]
    facts = {
        "test": TEST_LABELS.get(alert["test_type"], alert["test_type"]),
        "rule": alert["rule"],
        "baseline_pct": float(alert["baseline_score"]),
        "recent_pct": float(alert["recent_score"]),
        "drop_pct": float(alert["drop_pct"]),
        "recent_scores_pct_oldest_first": [round(x) for x in recent],
    }
    try:
        result, model = complete_json(prompts.ALERT_SUMMARY, str(facts), AlertSummary, temperature=0.2)
    except AIUnavailable:
        return None
    with tx() as cur:
        cur.execute("update cognitive_alerts set ai_summary = %s where id = %s", (result.summary, alert_id))
        cur.execute(
            "insert into ai_summaries (patient_id, type, content, model) values (%s, 'cognitive_alert', %s, %s)",
            (alert["patient_id"], Jsonb({"alert_id": str(alert_id), "summary": result.summary}), model),
        )
    return result.summary
