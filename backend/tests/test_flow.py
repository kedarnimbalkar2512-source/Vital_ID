import json
import re

from conftest import make_user, sql


def register_patient(client, name="Test Patient", **body):
    p = make_user("patient", name)
    r = client.post("/api/patients/register-id", json={"blood_group": "O+", "city": "Pune", **body}, headers=p["headers"])
    assert r.status_code == 200, r.text
    p.update(r.json())
    return p


def verified_doctor(client, name="Mehta"):
    d = make_user("doctor", name, licence_no="MMC-12345", hospital="Test Hospital")
    sql("update doctors set verification_status = 'verified', verified_at = now() where profile_id = %s", (d["profile_id"],))
    return d


def test_vital_id_is_random_and_well_formed(client):
    ids = {register_patient(client)["vital_id"] for _ in range(5)}
    assert len(ids) == 5
    assert all(re.fullmatch(r"VID-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}", i) for i in ids)


def test_admin_role_cannot_be_self_assigned(client):
    u = make_user("admin", "Sneaky")
    assert sql("select role from profiles where id = %s", (u["profile_id"],))[0][0] == "patient"


def test_qr_emergency_view_is_minimal_and_logged(client):
    p = register_patient(client, "Ramesh Test", has_cognitive_condition=True)
    pid = p["patient_id"]
    sql("insert into allergies (patient_id, substance, reaction, severity, source) values (%s, 'Penicillin', 'Anaphylaxis', 'life-threatening', 'doctor-entered')", (pid,))
    sql("insert into medications (patient_id, name, dose, is_critical) values (%s, 'Warfarin', '5 mg', true), (%s, 'Vitamin D', '1000 IU', false)", (pid, pid))
    sql("insert into emergency_contacts (patient_id, name, relationship, phone) values (%s, 'Priya', 'daughter', '+910000000000')", (pid,))

    qr = client.get("/api/qr/current", headers=p["headers"]).json()
    assert qr["active"] and qr["url"].endswith(qr["token"])
    # the token is not stored in the database, only its hash
    assert not sql("select 1 from qr_tokens where token_hash = %s or nonce = %s", (qr["token"], qr["token"]))

    e = client.get(f"/api/emergency/{qr['token']}").json()
    assert e["full_name"] == "Ramesh Test" and e["has_cognitive_condition"]
    assert [m["name"] for m in e["critical_medications"]] == ["Warfarin"]
    assert e["allergies"][0]["substance"] == "Penicillin"
    assert "phone" not in e and "dob" not in e  # whitelisted fields only
    assert sql("select count(*) from audit_logs where patient_id = %s and action = 'emergency_scan'", (pid,))[0][0] == 1

    rotated = client.post("/api/qr/rotate", json={}, headers=p["headers"]).json()
    assert client.get(f"/api/emergency/{qr['token']}").status_code == 404
    assert client.get(f"/api/emergency/{rotated['token']}").status_code == 200


def test_doctor_needs_consent_and_pin_lockout(client):
    p = register_patient(client)
    d = verified_doctor(client)
    assert client.get(f"/api/patients/{p['vital_id']}/record", headers=d["headers"]).status_code == 403

    # no PIN set yet
    r = client.post("/api/access/request", json={"vital_id": p["vital_id"], "pin": "1234"}, headers=d["headers"])
    assert r.status_code == 409
    assert client.post("/api/patients/pin", json={"pin": "4821"}, headers=p["headers"]).status_code == 200

    r = client.post("/api/access/request", json={"vital_id": p["vital_id"], "pin": "0000"}, headers=d["headers"])
    assert r.status_code == 403
    r = client.post("/api/access/request", json={"vital_id": p["vital_id"], "pin": "4821"}, headers=d["headers"])
    assert r.status_code == 200 and r.json()["status"] == "granted"

    rec = client.get(f"/api/patients/{p['vital_id']}/record", headers=d["headers"])
    assert rec.status_code == 200
    log = client.get("/api/audit/me", headers=p["headers"]).json()
    actions = [l["action"] for l in log]
    assert "view" in actions and "grant" in actions and "access_denied" in actions
    assert any(l["actor_name"] == "Mehta" for l in log if l["action"] == "view")

    # revoke => no more access
    grant_id = r.json()["grant_id"]
    assert client.post(f"/api/access/{grant_id}/revoke", headers=p["headers"]).status_code == 200
    assert client.get(f"/api/patients/{p['vital_id']}/record", headers=d["headers"]).status_code == 403

    # lockout after repeated wrong PINs
    for _ in range(4):
        client.post("/api/access/request", json={"vital_id": p["vital_id"], "pin": "1111"}, headers=d["headers"])
    r = client.post("/api/access/request", json={"vital_id": p["vital_id"], "pin": "4821"}, headers=d["headers"])
    assert r.status_code == 429


def test_unverified_doctor_is_blocked_until_admin_approves(client):
    p = register_patient(client)
    d = make_user("doctor", "New Doc", licence_no="MMC-99999")
    r = client.post("/api/access/break-glass", json={"vital_id": p["vital_id"], "reason": "Unconscious after a fall"}, headers=d["headers"])
    assert r.status_code == 403
    admin = make_user("patient", "Admin")
    sql("update profiles set role = 'admin' where id = %s", (admin["profile_id"],))
    doctors = client.get("/api/admin/doctors?status=pending", headers=admin["headers"]).json()
    doc_id = next(x["id"] for x in doctors if x["licence_no"] == "MMC-99999")
    assert client.post(f"/api/admin/doctors/{doc_id}/verify", json={"approve": True}, headers=admin["headers"]).status_code == 200
    r = client.post("/api/access/break-glass", json={"vital_id": p["vital_id"], "reason": "Unconscious after a fall"}, headers=d["headers"])
    assert r.status_code == 200
    notes = sql("select kind from notifications where profile_id = %s", (p["profile_id"],))
    assert ("break_glass",) in notes


def test_app_approval_flow(client):
    p = register_patient(client)
    d = verified_doctor(client)
    r = client.post("/api/access/request", json={"vital_id": p["vital_id"], "reason": "OPD visit"}, headers=d["headers"]).json()
    assert r["status"] == "pending"
    pending = client.get("/api/access/me", headers=p["headers"]).json()["requests"]
    assert len(pending) == 1
    client.post(f"/api/access/requests/{r['request_id']}/decide", json={"approve": True}, headers=p["headers"])
    assert client.get(f"/api/access/requests/{r['request_id']}", headers=d["headers"]).json()["status"] == "approved"
    assert client.get(f"/api/patients/{p['vital_id']}/record", headers=d["headers"]).status_code == 200


def test_caregiver_link_requires_patient_approval(client):
    p = register_patient(client)
    c = make_user("caregiver", "Priya")
    link = client.post("/api/caregivers/link", json={"vital_id": p["vital_id"], "relationship": "daughter"}, headers=c["headers"]).json()
    assert client.get(f"/api/patients/me?patient_id={p['patient_id']}", headers=c["headers"]).status_code == 403
    client.post(f"/api/caregivers/links/{link['id']}/decide", json={"approve": True}, headers=p["headers"])
    assert client.get(f"/api/patients/me?patient_id={p['patient_id']}", headers=c["headers"]).status_code == 200


def test_drug_check_rules(client, fake_llm):
    responses, _ = fake_llm
    responses["second check"] = json.dumps({"warnings": [], "summary": "No additional concerns."})
    p = register_patient(client)
    pid = p["patient_id"]
    sql("insert into medications (patient_id, name, dose) values (%s, 'Warfarin 5 mg', '5 mg'), (%s, 'Donepezil', '5 mg')", (pid, pid))
    sql("insert into allergies (patient_id, substance, severity) values (%s, 'Penicillin', 'life-threatening')", (pid,))
    check = lambda drug: client.post("/api/ai/drug-check", json={"drug_name": drug}, headers=p["headers"]).json()

    r = check("Ibuprofen 400mg")
    assert r["rule_warnings"][0]["severity"] == "major" and "Warfarin 5 mg" in r["rule_warnings"][0]["involves"]
    r = check("Amoxicillin")
    assert r["rule_warnings"][0]["type"] == "drug-allergy" and r["rule_warnings"][0]["severity"] == "contraindicated"
    r = check("Cefuroxime")
    assert r["rule_warnings"][0]["type"] == "cross-reactivity"
    r = check("Oxybutynin")
    assert any("Donepezil" in w["involves"] for w in r["rule_warnings"])
    assert check("Paracetamol")["rule_warnings"] == []


def test_doctor_brief_cites_only_real_records(client, fake_llm):
    responses, calls = fake_llm
    p = register_patient(client, "Secret Name")
    d = verified_doctor(client)
    client.post("/api/patients/pin", json={"pin": "1357"}, headers=p["headers"])
    client.post("/api/access/request", json={"vital_id": p["vital_id"], "pin": "1357"}, headers=d["headers"])
    med = sql("insert into medications (patient_id, name, dose, is_critical) values (%s, 'Warfarin', '5 mg', true) returning id", (p["patient_id"],))[0][0]
    responses["30-second brief"] = json.dumps({
        "one_line": "Older adult on anticoagulation.",
        "key_conditions": [],
        "active_medications": [{"text": "Warfarin 5 mg", "source_ids": [str(med), "made-up-id"]}],
        "allergies": [], "red_flags": [], "recent_changes": [],
    })
    r = client.post("/api/ai/doctor-brief", json={"vital_id": p["vital_id"]}, headers=d["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["brief"]["active_medications"][0]["source_ids"] == [str(med)]
    assert body["sources"][str(med)]["table"] == "medications"
    sent = calls[-1]["messages"][1]["content"]
    assert "Secret Name" not in sent and p["vital_id"] not in sent and "Pune" not in sent
    # second call is served from cache
    assert client.post("/api/ai/doctor-brief", json={"vital_id": p["vital_id"]}, headers=d["headers"]).json()["cached"]


def test_cognitive_scoring_and_decline_alert(client, fake_llm):
    responses, _ = fake_llm
    responses["cognitive screening change"] = json.dumps({"summary": "Recall scores have dropped."})
    p = register_patient(client)
    c = make_user("caregiver", "Daughter")
    link = client.post("/api/caregivers/link", json={"vital_id": p["vital_id"], "relationship": "daughter"}, headers=c["headers"]).json()
    client.post(f"/api/caregivers/links/{link['id']}/decide", json={"approve": True}, headers=p["headers"])

    words = ["apple", "chair", "river", "red", "dog"]

    def take(recalled):
        r = client.post("/api/cognitive/tests", json={"test_type": "word_recall", "raw": {"words": words, "recalled": recalled}},
                        headers=p["headers"])
        assert r.status_code == 200, r.text
        return r.json()

    assert take(["Apple", "chiar", "river", "red", "dog"])["score"] == 5  # case + one typo forgiven
    results = [take(words), take(words[:4]), take(words[:4]), take(words[:3]), take(words[:2])]
    assert [r["alert_created"] for r in results].count(True) == 1  # later tests refresh the open alert
    alert = sql("select rule, baseline_score, recent_score from cognitive_alerts where patient_id = %s and status = 'open'", (p["patient_id"],))
    assert len(alert) == 1 and alert[0][0] == "baseline_drop"  # 100% baseline -> 60% recent
    alerts = client.get("/api/cognitive/alerts", headers=c["headers"]).json()
    assert alerts and alerts[0]["rule"] in ("baseline_drop", "downward_trend")
    assert sql("select count(*) from notifications where profile_id = %s and kind = 'cognitive_alert'", (c["profile_id"],))[0][0] == 1
    trend = client.get(f"/api/cognitive/trend/{p['patient_id']}", headers=c["headers"]).json()
    assert trend["summary"]["word_recall"]["tests"] == 6
    assert sql("select ai_summary from cognitive_alerts where patient_id = %s", (p["patient_id"],))[0][0] == "Recall scores have dropped."


def test_orientation_and_trail_scoring():
    from datetime import datetime

    from app.cognitive import scoring

    now = datetime(2026, 10, 24, 11, 0)
    s, m, _ = scoring.score_orientation(
        {"answers": {"year": "2026", "month": "Oct", "date": "24", "day_of_week": "saturday", "city": "pune"}}, "Pune", now)
    assert (s, m) == (5, 5)
    s, m, _ = scoring.score_orientation({"answers": {"year": "2025", "month": "10", "date": "20", "day_of_week": "Mon"}}, None, now)
    assert (s, m) == (1, 4)
    s, m, d = scoring.score_trail({"n": 10, "clicks": [str(i) for i in range(1, 11)], "time_allowance_sec": 30}, 25)
    assert (s, m) == (10, 10)
    s, m, d = scoring.score_trail({"n": 10, "clicks": ["1", "3", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "time_allowance_sec": 30}, 52)
    assert d["errors"] == 1 and d["time_penalty"] == 2 and s == 7


def test_rls_isolates_patients():
    """Browser-level access (anon key + JWT) through RLS, without the backend."""
    import os

    import psycopg

    from conftest import make_user as mk

    a, b = mk("patient", "A"), mk("patient", "B")
    for u in (a, b):
        vid = "VID-" + str(u["user_id"].int % 10**6).zfill(6).translate(str.maketrans("01", "AB"))
        sql("insert into patients (profile_id, vital_id) values (%s, %s)", (u["profile_id"], vid))
    pa = sql("select id from patients where profile_id = %s", (a["profile_id"],))[0][0]
    pb = sql("select id from patients where profile_id = %s", (b["profile_id"],))[0][0]
    sql("insert into allergies (patient_id, substance, source) values (%s, 'Latex', 'patient-reported')", (pb,))

    with psycopg.connect(os.environ["DATABASE_URL"]) as c:
        c.execute("set role authenticated")
        c.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": str(a["user_id"])}),))
        assert c.execute("select count(*) from allergies where patient_id = %s", (pb,)).fetchone()[0] == 0
        assert c.execute("select count(*) from patients").fetchone()[0] == 1
        # can't write into someone else's record, nor claim a doctor-entered source
        for stmt, params in [
            ("insert into allergies (patient_id, substance, source, recorded_by) values (%s, 'x', 'patient-reported', %s)", (pb, a["profile_id"])),
            ("insert into allergies (patient_id, substance, source, recorded_by) values (%s, 'x', 'doctor-entered', %s)", (pa, a["profile_id"])),
        ]:
            try:
                with c.transaction():
                    c.execute(stmt, params)
                raise AssertionError("insert should have been refused")
            except psycopg.errors.InsufficientPrivilege:
                pass
        with c.transaction():
            c.execute("insert into allergies (patient_id, substance, source, recorded_by) values (%s, 'Dust', 'patient-reported', %s)", (pa, a["profile_id"]))
        # no browser access to secrets, QR tokens, or vital_id changes
        for stmt in ["select * from patient_secrets", "select * from qr_tokens", "update patients set vital_id = 'VID-AAAAAA'"]:
            try:
                with c.transaction():
                    c.execute(stmt)
                raise AssertionError(f"should be refused: {stmt}")
            except psycopg.errors.InsufficientPrivilege:
                pass
    # the browser insert was audited with the right actor
    assert sql("select actor_profile_id from audit_logs where patient_id = %s and target_type = 'allergies'", (pa,))[0][0] == a["profile_id"]


def test_patient_record_crud_is_patient_reported(client):
    p = register_patient(client)
    r = client.post("/api/records/medications", json={"data": {"name": "Paracetamol", "dose": "500 mg", "source": "doctor-entered"}},
                    headers=p["headers"])
    assert r.status_code == 200 and r.json()["source"] == "patient-reported" and not r.json()["verified"]
    mid = r.json()["id"]
    assert client.patch(f"/api/records/medications/{mid}", json={"data": {"dose": "650 mg"}}, headers=p["headers"]).json()["dose"] == "650 mg"
    doc_med = sql("insert into medications (patient_id, name, source) values (%s, 'Warfarin', 'doctor-entered') returning id", (p["patient_id"],))[0][0]
    assert client.delete(f"/api/records/medications/{doc_med}", headers=p["headers"]).status_code == 403
    other = register_patient(client)
    assert client.delete(f"/api/records/medications/{mid}", headers=other["headers"]).status_code == 403
    assert client.delete(f"/api/records/medications/{mid}", headers=p["headers"]).status_code == 200
    assert client.patch("/api/records/patient", json={"blood_group": "B+", "full_name": "New Name"}, headers=p["headers"]).status_code == 200
    me = client.get("/api/me", headers=p["headers"]).json()
    assert me["full_name"] == "New Name" and me["vital_id"] == p["vital_id"]
