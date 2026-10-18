# VitalID prototype

A medical memory for people whose own memory is failing: one random VitalID per patient, an emergency/wandering QR,
two-layer consented doctor access with a 30-second AI brief, drug-conflict warnings, cognitive check-ins with
decline alerts, and a patient-visible audit log. Built for NeuroVerse Ideathon 2026 (Track 1).

All demo data is **synthetic** and flagged `is_demo` (the UI shows a "Synthetic demo record" badge).

| Layer | What |
|---|---|
| `frontend/` | Next.js 14 (App Router) + TypeScript + Tailwind, Recharts, `qrcode.react`, `@yudiel/react-qr-scanner`. Uses Supabase only for login; all data goes through the API. |
| `backend/` | FastAPI + Pydantic. Verifies the Supabase JWT, enforces consent, writes the audit log, calls Groq (Llama 3.3 70B, JSON mode). |
| `supabase/migrations/` | Schema, RLS on every table, private storage buckets, drug-interaction rule base. |

## 1. Supabase

1. Create a project at supabase.com.
2. SQL editor: run the four files in `supabase/migrations/` **in order** (schema, rls, storage, drug_reference).
3. Authentication → Providers → Email: enabled. For the demo you can turn off "Confirm email".
4. Note from Project Settings: the project URL, the `anon` key, the `service_role` key, and the database connection
   string (Database → Connection string → URI, session pooler).

## 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, GROQ_API_KEY, QR_TOKEN_SECRET
uvicorn app.main:app --reload --port 8000
```

Seed the synthetic demo accounts (Ramesh, Sunita, caregiver Priya, Dr. Mehta (verified), Dr. Khan (pending), admin):

```bash
python -m scripts.seed_demo --password '<pick a demo password>' --pin <4-6 digit PIN>
# re-run from scratch:  ... --reset
```

It prints the logins and Ramesh's VitalID. Logins are `<name>.demo@example.com`.

Tests (need a local PostgreSQL 16; they load the migrations into a scratch database):
`pip install -r requirements-dev.txt && TEST_DATABASE_ADMIN_URL=postgresql://postgres@localhost:5432/postgres pytest`

## 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
npm run dev                 # http://localhost:3000
```

## 4. Deploy

- Frontend → Vercel (root `frontend/`, same three env vars, `NEXT_PUBLIC_API_URL` = the Render URL).
- Backend → Render/Railway (root `backend/`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; set
  `FRONTEND_URL` and `CORS_ORIGINS` to the Vercel URL). QR codes encode `FRONTEND_URL/e/<token>`, so set it
  before printing cards.

## Demo path (brief §9)

1. Log in as Ramesh → dashboard, VitalID + QR card (`/patient/qr`, print or "Preview what scanning shows").
2. Scan the QR with a phone → `/e/<token>`: "has memory loss, call daughter", penicillin allergy, warfarin.
3. Log in as Dr. Mehta → enter Ramesh's VitalID + PIN → record opens with the AI brief.
4. Prescribe Ibuprofen → "Check conflicts" shows the warfarin bleeding warning (rule base + AI second check).
5. Cognitive tab / Priya's alerts page → declining trend and screening signals.
6. Ramesh → Access & privacy → "Dr. Anjali Mehta viewed the record at …".

Also: app-approval consent (Dr. Khan after admin approval → Ramesh approves), break-glass, caregiver linking,
document upload + AI extraction review, clinician-only notes with "request access", notes analyser and pattern detector.

## How the safety rules are implemented

- **VitalID**: `VID-` + 6 chars from a 32-symbol alphabet via `secrets` (≈1.07 billion), never sequential.
- **QR**: encodes only `/e/<token>`. Token = HMAC(`QR_TOKEN_SECRET`, random nonce); DB stores the nonce and the
  token's SHA-256. Rotate/revoke from the QR page. Each scan is logged and notifies the patient and caregivers.
- **Consent**: doctor must be admin-verified, then VitalID + PIN (argon2-hashed, 5 wrong tries in 15 min locks PIN
  entry) or in-app approval. Grants expire (24 h default) and can be revoked. Break-glass needs a written reason,
  lasts 4 h, and notifies the family; the patient marks it reviewed.
- **RLS**: on every table; browsers can only ever write `patient-reported` rows to their own record. The backend
  re-checks every cross-user read (`app/access.py`). Admins cannot read clinical data.
- **Audit**: DB triggers log every create/edit/delete with the actor; the API logs views, grants, denials, AI briefs
  and emergency scans.
- **AI**: only de-identified clinical fields are sent (no name, phone, contacts, city, VitalID, exact DOB). JSON mode +
  Pydantic validation, temperature 0.1, cited record ids are checked against the record, every panel says
  "AI suggestion — verify clinically".
- **Cognitive alerts** (`app/cognitive/alerts.py`): baseline = mean of first 3 tests per type; alert if mean of last 3
  is ≥20% lower, or the last 4+ never rise and fall ≥10%. Thresholds are env-configurable. Screening signal, not
  a diagnosis.
- **Drug check**: rule base in `drug_classes` / `drug_interactions` / `allergy_cross_reactivity` (well-known pairs only,
  extend by inserting rows), then the LLM as a second check.

## Local development without Supabase

`supabase/local/` has a stand-in for Supabase's `auth` schema and a tiny fake auth server, used only to run the tests
and click through the app against plain PostgreSQL. Never deploy them.

## Not built (deck "future scope")

Medical GitHub case sharing, ABHA/FHIR and NMC API integration, mobile app, Marathi/Hindi voice, wearables, PubMed RAG,
clock-drawing test, SMS/push notifications (notifications are in-app).
