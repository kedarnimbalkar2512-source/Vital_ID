"""Loading a patient's record, and turning it into a de-identified payload for the LLM."""

from datetime import date
from uuid import UUID

from psycopg import Cursor

RECORD_TABLES = {
    "conditions": "order by (status = 'active') desc, is_critical desc, created_at desc",
    "medications": "order by (status = 'active') desc, is_critical desc, created_at desc",
    "allergies": "order by case severity when 'life-threatening' then 0 when 'severe' then 1 when 'moderate' then 2 else 3 end",
    "history_entries": "order by event_date desc nulls last, created_at desc",
    "emergency_contacts": "order by priority, created_at",
}


def age_from_dob(dob: date | None) -> int | None:
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def load_record(cur: Cursor, patient_id: UUID, *, viewer: str) -> dict:
    """viewer: 'owner' (patient/caregiver) or 'doctor'. Sensitive clinician notes are only
    returned in full to doctors; owners see that they exist and can request access."""
    cur.execute(
        """
        select pt.*, pr.full_name, pr.phone, pr.is_demo as profile_is_demo
        from patients pt join profiles pr on pr.id = pt.profile_id where pt.id = %s
        """,
        (patient_id,),
    )
    patient = cur.fetchone()
    record: dict = {"patient": patient}
    for table, order in RECORD_TABLES.items():
        cur.execute(f"select * from {table} where patient_id = %s {order}", (patient_id,))
        record[table] = cur.fetchall()
    cur.execute(
        """
        select id, doc_type, filename, mime_type, size, extraction_status, extracted_json, created_at
        from documents where patient_id = %s order by created_at desc
        """,
        (patient_id,),
    )
    record["documents"] = cur.fetchall()
    cur.execute(
        """
        select n.*, pr.full_name as doctor_name, d.hospital
        from clinician_notes n join doctors d on d.id = n.doctor_id join profiles pr on pr.id = d.profile_id
        where n.patient_id = %s order by n.created_at desc
        """,
        (patient_id,),
    )
    notes = cur.fetchall()
    if viewer == "doctor":
        record["clinician_notes"] = notes
        record["hidden_notes"] = 0
    else:
        visible = [n for n in notes if not n["sensitive"] or n["released_at"]]
        record["clinician_notes"] = visible
        record["hidden_notes"] = len(notes) - len(visible)
        record["hidden_notes_requested"] = any(
            n["patient_access_requested"] for n in notes if n["sensitive"] and not n["released_at"]
        )
    cur.execute(
        "select * from cognitive_alerts where patient_id = %s order by created_at desc limit 10", (patient_id,)
    )
    record["cognitive_alerts"] = cur.fetchall()
    cur.execute("select pin_hash is not null as pin_set from patient_secrets where patient_id = %s", (patient_id,))
    row = cur.fetchone()
    record["pin_set"] = bool(row and row["pin_set"])
    return record


def clinical_payload(cur: Cursor, patient_id: UUID, *, history_limit: int = 40) -> tuple[dict, dict[str, dict]]:
    """De-identified clinical facts for the LLM (no name, phone, contacts, VitalID, city or exact DOB),
    plus an index of record ids -> labels so the UI can show what each AI statement cites."""
    cur.execute("select dob, gender, blood_group, has_cognitive_condition from patients where id = %s", (patient_id,))
    p = cur.fetchone()
    sources: dict[str, dict] = {}

    def ref(table: str, row: dict, label: str) -> str:
        rid = str(row["id"])
        sources[rid] = {"table": table, "label": label, "source": row.get("source"), "verified": row.get("verified")}
        return rid

    cur.execute("select * from conditions where patient_id = %s", (patient_id,))
    conditions = [
        {"id": ref("conditions", c, c["name"]), "name": c["name"], "status": c["status"],
         "onset": c["onset_date"].isoformat() if c["onset_date"] else None, "critical": c["is_critical"],
         "source": c["source"], "verified": c["verified"]}
        for c in cur.fetchall()
    ]
    cur.execute("select * from medications where patient_id = %s", (patient_id,))
    meds = [
        {"id": ref("medications", m, f"{m['name']} {m['dose'] or ''}".strip()), "name": m["name"], "dose": m["dose"],
         "frequency": m["frequency"], "status": m["status"], "critical": m["is_critical"],
         "start": m["start_date"].isoformat() if m["start_date"] else None,
         "end": m["end_date"].isoformat() if m["end_date"] else None, "source": m["source"], "verified": m["verified"]}
        for m in cur.fetchall()
    ]
    cur.execute("select * from allergies where patient_id = %s", (patient_id,))
    allergies = [
        {"id": ref("allergies", a, a["substance"]), "substance": a["substance"], "reaction": a["reaction"],
         "severity": a["severity"], "source": a["source"], "verified": a["verified"]}
        for a in cur.fetchall()
    ]
    cur.execute(
        "select * from history_entries where patient_id = %s order by event_date desc nulls last limit %s",
        (patient_id, history_limit),
    )
    history = [
        {"id": ref("history_entries", h, h["title"]), "type": h["type"], "title": h["title"], "details": h["details"],
         "date": h["event_date"].isoformat() if h["event_date"] else None, "source": h["source"]}
        for h in cur.fetchall()
    ]
    cur.execute(
        """
        select test_type, count(*) as n,
               round(avg(100.0 * score / max_score) filter (where rn_first <= 3), 1) as baseline_pct,
               round(avg(100.0 * score / max_score) filter (where rn_last <= 3), 1) as recent_pct,
               max(taken_at) as last_taken
        from (
          select *, row_number() over (partition by test_type order by taken_at) as rn_first,
                    row_number() over (partition by test_type order by taken_at desc) as rn_last
          from cognitive_tests where patient_id = %s
        ) t group by test_type
        """,
        (patient_id,),
    )
    cognitive = [
        {"test_type": r["test_type"], "tests": r["n"], "baseline_pct": float(r["baseline_pct"] or 0),
         "recent_pct": float(r["recent_pct"] or 0), "last_taken": r["last_taken"].date().isoformat()}
        for r in cur.fetchall()
    ]
    cur.execute(
        "select id, test_type, rule, drop_pct, status, created_at from cognitive_alerts where patient_id = %s and status = 'open'",
        (patient_id,),
    )
    alerts = []
    for a in cur.fetchall():
        rid = str(a["id"])
        sources[rid] = {"table": "cognitive_alerts", "label": f"Cognitive alert ({a['test_type']})", "source": "system", "verified": True}
        alerts.append({"id": rid, "test_type": a["test_type"], "rule": a["rule"], "drop_pct": float(a["drop_pct"]),
                       "date": a["created_at"].date().isoformat()})

    payload = {
        "age": age_from_dob(p["dob"]) if p else None,
        "gender": p["gender"] if p else None,
        "blood_group": p["blood_group"] if p else None,
        "known_cognitive_condition": p["has_cognitive_condition"] if p else None,
        "conditions": conditions,
        "medications": meds,
        "allergies": allergies,
        "history": history,
        "cognitive_screening": cognitive,
        "open_cognitive_alerts": alerts,
        "today": date.today().isoformat(),
    }
    return payload, sources
