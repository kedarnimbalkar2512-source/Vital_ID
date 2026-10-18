"""Seeds clearly-labelled SYNTHETIC demo accounts and records into the real database.

Every demo profile, patient and cognitive test is flagged is_demo = true and the UI shows a
"Synthetic demo record" badge. No real patient data is used anywhere.

Usage (from backend/, with .env filled in):
    python -m scripts.seed_demo --password '<demo password>' --pin 2468
    python -m scripts.seed_demo --reset ...      # delete previous demo accounts first

Accounts are created through the Supabase Auth admin API (so they are real, loginable users).
--local-auth inserts straight into auth.users instead; that is only for the local test database.
"""

import argparse
import os
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.llm import ai_configured  # noqa: E402
from app.cognitive.service import check_for_alert, summarise_alert  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import close_pool  # noqa: E402
from app.ids import hash_token, new_qr_nonce, new_vital_id, qr_token_from_nonce  # noqa: E402
from app.pin import hash_pin  # noqa: E402

TODAY = date.today()


def days_ago(n: int) -> date:
    return TODAY - timedelta(days=n)


# --------------------------------------------------------------------------- people
PEOPLE = [
    {"key": "ramesh", "role": "patient", "full_name": "Ramesh Patil", "phone": "+91 90000 00001"},
    {"key": "sunita", "role": "patient", "full_name": "Sunita Deshpande", "phone": "+91 90000 00002"},
    {"key": "priya", "role": "caregiver", "full_name": "Priya Patil", "phone": "+91 90000 00003"},
    {"key": "mehta", "role": "doctor", "full_name": "Anjali Mehta", "phone": "+91 90000 00004",
     "licence_no": "MMC-2011-04471", "council": "Maharashtra Medical Council", "hospital": "Sahyadri Demo Hospital, Pune",
     "specialty": "Emergency Medicine", "verified": True},
    {"key": "khan", "role": "doctor", "full_name": "Imran Khan", "phone": "+91 90000 00005",
     "licence_no": "MMC-2016-11902", "council": "Maharashtra Medical Council", "hospital": "City Demo Clinic, Pune",
     "specialty": "General Practice", "verified": False},
    {"key": "admin", "role": "admin", "full_name": "VitalID Admin", "phone": None},
]


def email_for(key: str, domain: str) -> str:
    return f"{key}.demo@{domain}"


# --------------------------------------------------------------------------- auth
class SupabaseAdmin:
    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/auth/v1/admin"
        self.h = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    def find(self, email: str) -> str | None:
        page = 1
        while True:
            r = httpx.get(f"{self.base}/users", params={"page": page, "per_page": 200}, headers=self.h, timeout=20)
            r.raise_for_status()
            users = r.json().get("users", [])
            for u in users:
                if (u.get("email") or "").lower() == email.lower():
                    return u["id"]
            if len(users) < 200:
                return None
            page += 1

    def create(self, email: str, password: str, meta: dict) -> str:
        r = httpx.post(f"{self.base}/users", headers=self.h, timeout=20,
                       json={"email": email, "password": password, "email_confirm": True, "user_metadata": meta})
        if r.status_code in (200, 201):
            return r.json()["id"]
        existing = self.find(email)
        if existing:
            return existing
        raise RuntimeError(f"Could not create {email}: {r.status_code} {r.text[:200]}")

    def delete(self, user_id: str) -> None:
        httpx.delete(f"{self.base}/users/{user_id}", headers=self.h, timeout=20)


def create_local_user(cur, email: str, meta: dict) -> str:
    cur.execute("select id from auth.users where email = %s", (email,))
    row = cur.fetchone()
    if row:
        return row["id"]
    cur.execute("insert into auth.users (email, raw_user_meta_data) values (%s, %s) returning id", (email, Jsonb(meta)))
    return cur.fetchone()["id"]


# --------------------------------------------------------------------------- cognitive history
def cognitive_series(rng: random.Random, weeks: int, start: float, end: float, max_score: int, noise: float) -> list[int]:
    """A gentle line from `start` to `end` (as fractions of max) with small random noise."""
    out = []
    for i in range(weeks):
        frac = start + (end - start) * (i / max(weeks - 1, 1)) ** 1.6
        val = round((frac + rng.uniform(-noise, noise)) * max_score)
        out.append(max(0, min(max_score, val)))
    return out


def seed_cognitive(cur, patient_id, profile_id, rng: random.Random, plan: dict, weeks: int) -> None:
    s = get_settings()
    maxes = {"word_recall": 5, "orientation": 5, "digit_span": s.digit_span_max, "trail": s.trail_points}
    for test_type, (start, end) in plan.items():
        m = maxes[test_type]
        scores = cognitive_series(rng, weeks, start, end, m, 0.04)
        for i, score in enumerate(scores):
            taken = datetime.combine(TODAY - timedelta(weeks=weeks - i), time(10, rng.randint(0, 59)), tzinfo=timezone.utc)
            cur.execute(
                """insert into cognitive_tests (patient_id, test_type, score, max_score, duration_sec, raw, taken_at,
                                                administered_by, is_demo)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, true)""",
                (patient_id, test_type, score, m, rng.randint(40, 160), Jsonb({"synthetic_seed": True}), taken, profile_id),
            )


# --------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--password", default=os.environ.get("DEMO_PASSWORD"), help="password for every demo login")
    ap.add_argument("--pin", default=os.environ.get("DEMO_PIN"), help="consent PIN for the demo patients (4-6 digits)")
    ap.add_argument("--email-domain", default=os.environ.get("DEMO_EMAIL_DOMAIN", "example.com"))
    ap.add_argument("--reset", action="store_true", help="delete existing demo accounts first")
    ap.add_argument("--local-auth", action="store_true", help="write auth.users directly (local test DB only)")
    ap.add_argument("--seed", type=int, default=24102026, help="random seed for the synthetic cognitive history")
    args = ap.parse_args()

    s = get_settings()
    if not args.local_auth and not args.password:
        ap.error("--password (or DEMO_PASSWORD) is required")
    if not args.pin or not args.pin.isdigit() or not 4 <= len(args.pin) <= 6:
        ap.error("--pin (or DEMO_PIN) must be 4-6 digits")
    admin = None if args.local_auth else SupabaseAdmin(s.supabase_url, s.supabase_service_role_key)
    rng = random.Random(args.seed)

    with psycopg.connect(s.database_url, row_factory=dict_row, autocommit=True, prepare_threshold=None) as conn:
        cur = conn.cursor()
        if args.reset:
            cur.execute("select user_id from profiles where is_demo")
            ids = [r["user_id"] for r in cur.fetchall()]
            for uid in ids:
                if admin:
                    admin.delete(str(uid))
                else:
                    cur.execute("delete from auth.users where id = %s", (uid,))
            print(f"Removed {len(ids)} previous demo accounts")

        with conn.transaction():
            cur.execute("select set_config('app.skip_audit', 'on', true)")
            prof: dict[str, dict] = {}
            for p in PEOPLE:
                email = email_for(p["key"], args.email_domain)
                meta = {"role": p["role"] if p["role"] != "admin" else "patient", "full_name": p["full_name"],
                        "phone": p["phone"]}
                if p["role"] == "doctor":
                    meta.update({k: p[k] for k in ("licence_no", "council", "hospital", "specialty")})
                uid = admin.create(email, args.password, meta) if admin else create_local_user(cur, email, meta)
                cur.execute("update profiles set is_demo = true, role = %s where user_id = %s returning id",
                            (p["role"], uid))
                row = cur.fetchone()
                if not row:
                    raise RuntimeError(f"No profile for {email}; is the signup trigger installed?")
                prof[p["key"]] = {"profile_id": row["id"], "email": email, **p}
                if p["role"] == "doctor" and p.get("verified"):
                    cur.execute("""update doctors set verification_status = 'verified', verified_at = now()
                                   where profile_id = %s""", (row["id"],))

            pin_hash = hash_pin(args.pin)

            def make_patient(key: str, **fields) -> dict:
                cur.execute("select id, vital_id from patients where profile_id = %s", (prof[key]["profile_id"],))
                existing = cur.fetchone()
                if existing:
                    return existing
                cur.execute(
                    """insert into patients (profile_id, vital_id, dob, gender, blood_group, has_cognitive_condition,
                                             emergency_note, city, is_demo)
                       values (%(profile_id)s, %(vital_id)s, %(dob)s, %(gender)s, %(blood_group)s, %(cog)s, %(note)s, %(city)s, true)
                       returning id, vital_id""",
                    {"profile_id": prof[key]["profile_id"], "vital_id": new_vital_id(), **fields},
                )
                pt = cur.fetchone()
                cur.execute("insert into patient_secrets (patient_id, pin_hash, pin_set_at) values (%s, %s, now())",
                            (pt["id"], pin_hash))
                nonce = new_qr_nonce()
                cur.execute("insert into qr_tokens (patient_id, nonce, token_hash) values (%s, %s, %s)",
                            (pt["id"], nonce, hash_token(qr_token_from_nonce(nonce))))
                pt["new"] = True
                return pt

            ramesh = make_patient(
                "ramesh", dob=date(TODAY.year - 72, 3, 14), gender="male", blood_group="O+", cog=True, city="Pune",
                note="I have memory loss (early Alzheimer's). I may be confused or lost. Please speak slowly, keep me "
                     "safe and call my daughter Priya.",
            )
            sunita = make_patient(
                "sunita", dob=date(TODAY.year - 66, 8, 2), gender="female", blood_group="B+", cog=False, city="Pune",
                note=None,
            )
            mehta, khan = prof["mehta"], prof["khan"]

            if ramesh.get("new"):
                rid, by = ramesh["id"], mehta["profile_id"]
                cur.execute(
                    """insert into emergency_contacts (patient_id, name, relationship, phone, priority) values
                       (%s, 'Priya Patil', 'Daughter', '+91 90000 00003', 1),
                       (%s, 'Suresh Patil', 'Son', '+91 90000 00006', 2)""", (rid, rid))
                conditions = [
                    ("Early Alzheimer's disease", days_ago(330), True, "doctor-entered", True, by),
                    ("Atrial fibrillation", days_ago(1100), True, "doctor-entered", True, by),
                    ("Hypertension", days_ago(3200), False, "doctor-entered", True, by),
                    ("Type 2 diabetes", days_ago(2400), False, "patient-reported", False, prof["priya"]["profile_id"]),
                ]
                for name, onset, crit, src, ver, rec in conditions:
                    cur.execute("""insert into conditions (patient_id, name, onset_date, is_critical, source, verified, recorded_by)
                                   values (%s, %s, %s, %s, %s, %s, %s)""", (rid, name, onset, crit, src, ver, rec))
                meds = [
                    ("Warfarin", "5 mg", "Once daily, evening", days_ago(1100), True, "doctor-entered", True, ["20:00"]),
                    ("Donepezil", "5 mg", "Once daily, bedtime", days_ago(320), False, "doctor-entered", True, ["21:30"]),
                    ("Metoprolol", "25 mg", "Twice daily", days_ago(1100), False, "doctor-entered", True, ["08:00", "20:00"]),
                    ("Metformin", "500 mg", "Twice daily with food", days_ago(2300), False, "patient-reported", False, ["08:30", "20:30"]),
                ]
                for name, dose, freq, start, crit, src, ver, times in meds:
                    cur.execute(
                        """insert into medications (patient_id, name, dose, frequency, start_date, is_critical, source,
                                                    verified, prescriber, reminder_times, recorded_by)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (rid, name, dose, freq, start, crit, src, ver,
                         "Dr. Anjali Mehta" if src == "doctor-entered" else None, times, by))
                cur.execute(
                    """insert into allergies (patient_id, substance, reaction, severity, source, verified, recorded_by) values
                       (%s, 'Penicillin', 'Anaphylaxis', 'life-threatening', 'doctor-entered', true, %s),
                       (%s, 'Sulfa drugs', 'Skin rash', 'moderate', 'patient-reported', false, %s)""",
                    (rid, by, rid, prof["priya"]["profile_id"]))
                history = [
                    ("surgery", "Cataract surgery, right eye", {"hospital": "Demo Eye Centre"}, days_ago(2600), "patient-reported"),
                    ("visit", "Palpitations: atrial fibrillation diagnosed, warfarin started", {"inr_target": "2.0-3.0"}, days_ago(1100), "doctor-entered"),
                    ("vaccination", "Influenza vaccine", {"dose": "annual"}, days_ago(380), "patient-reported"),
                    ("vaccination", "Pneumococcal vaccine (PCV13)", {}, days_ago(700), "doctor-entered"),
                    ("visit", "Memory complaints: MoCA 22/30, referred to neurology", {"moca": 22}, days_ago(345), "doctor-entered"),
                    ("visit", "Neurology review: early Alzheimer's disease, donepezil started", {"mri": "mild hippocampal atrophy"}, days_ago(330), "doctor-entered"),
                    ("lab", "HbA1c", {"value": 7.1, "unit": "%"}, days_ago(300), "doctor-entered"),
                    ("lab", "HbA1c", {"value": 7.6, "unit": "%"}, days_ago(120), "doctor-entered"),
                    ("lab", "INR", {"value": 2.4, "target": "2.0-3.0"}, days_ago(150), "doctor-entered"),
                    ("lab", "INR", {"value": 2.9, "target": "2.0-3.0"}, days_ago(90), "doctor-entered"),
                    ("lab", "INR", {"value": 3.5, "target": "2.0-3.0"}, days_ago(30), "doctor-entered"),
                    ("vitals", "Blood pressure", {"systolic": 138, "diastolic": 84, "pulse": 78}, days_ago(120), "doctor-entered"),
                    ("vitals", "Blood pressure", {"systolic": 146, "diastolic": 88, "pulse": 82}, days_ago(30), "doctor-entered"),
                    ("visit", "Fall at home: bruised left forearm, no head injury", {"note": "missed evening meds twice that week"}, days_ago(45), "patient-reported"),
                ]
                for typ, title, details, when, src in history:
                    cur.execute(
                        """insert into history_entries (patient_id, type, title, details, event_date, source, verified, recorded_by)
                           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        (rid, typ, title, Jsonb(details), when, src, src == "doctor-entered",
                         by if src == "doctor-entered" else prof["priya"]["profile_id"]))
                cur.execute(
                    """insert into clinician_notes (patient_id, doctor_id, note, sensitive)
                       select %s, d.id, %s, %s from doctors d where d.profile_id = %s""",
                    (rid, "Discussed driving: advised to stop driving. Family agrees. Review home safety for falls.", False,
                     mehta["profile_id"]))
                cur.execute(
                    """insert into clinician_notes (patient_id, doctor_id, note, sensitive)
                       select %s, d.id, %s, %s from doctors d where d.profile_id = %s""",
                    (rid, "Prognosis conversation deferred; patient became anxious. Revisit with daughter present.", True,
                     mehta["profile_id"]))
                cur.execute(
                    """insert into caregiver_links (patient_id, caregiver_profile_id, relationship, status, decided_at)
                       values (%s, %s, 'Daughter', 'active', now()) on conflict do nothing""",
                    (rid, prof["priya"]["profile_id"]))
                # ~16 weeks of weekly check-ins showing a gradual decline (synthetic)
                seed_cognitive(cur, rid, prof["ramesh"]["profile_id"], rng, {
                    "word_recall": (0.92, 0.48), "orientation": (1.0, 0.68), "digit_span": (0.82, 0.6), "trail": (0.95, 0.62),
                }, weeks=16)

            if sunita.get("new"):
                sid = sunita["id"]
                cur.execute("""insert into emergency_contacts (patient_id, name, relationship, phone)
                               values (%s, 'Vikram Deshpande', 'Husband', '+91 90000 00007')""", (sid,))
                cur.execute("""insert into conditions (patient_id, name, onset_date, source, verified) values
                               (%s, 'Hypertension', %s, 'patient-reported', false)""", (sid, days_ago(1500)))
                cur.execute("""insert into medications (patient_id, name, dose, frequency, source, reminder_times) values
                               (%s, 'Telmisartan', '40 mg', 'Once daily', 'patient-reported', '{08:00}')""", (sid,))
                seed_cognitive(cur, sid, prof["sunita"]["profile_id"], rng, {
                    "word_recall": (0.9, 0.9), "orientation": (1.0, 1.0), "digit_span": (0.85, 0.85), "trail": (0.9, 0.92),
                }, weeks=8)

            # run the real decline rules over the seeded history (creates alerts + caregiver notifications)
            created = []
            for pt in (ramesh, sunita):
                for t in ("word_recall", "orientation", "digit_span", "trail"):
                    alert = check_for_alert(cur, pt["id"], t)
                    if alert:
                        created.append(alert["id"])

    if created and ai_configured():
        for alert_id in created:
            summarise_alert(alert_id)
    close_pool()

    print("\nSYNTHETIC demo data ready (all records flagged is_demo):")
    print(f"  {'login':34} role")
    for p in PEOPLE:
        print(f"  {email_for(p['key'], args.email_domain):34} {p['role']}"
              + ("  (pending verification: approve as admin)" if p["role"] == "doctor" and not p.get("verified") else ""))
    print(f"\n  Ramesh Patil  VitalID {ramesh['vital_id']}")
    print(f"  Sunita Deshpande  VitalID {sunita['vital_id']}")
    print(f"  Cognitive alerts opened by the decline rules: {len(created)}")
    print("  Password and PIN: the values you passed in (not printed).")


if __name__ == "__main__":
    main()
