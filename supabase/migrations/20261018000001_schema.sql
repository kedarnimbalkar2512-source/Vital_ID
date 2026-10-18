-- VitalID schema. Run in the Supabase SQL editor or with `supabase db push`.
-- Every table has id/created_at/updated_at and RLS enabled (policies live in the next migration).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create schema if not exists app;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'patient' check (role in ('patient', 'caregiver', 'doctor', 'admin')),
  full_name text not null default '',
  phone text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  vital_id text not null unique check (vital_id ~ '^VID-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  dob date,
  gender text check (gender in ('female', 'male', 'other', 'undisclosed')),
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown')),
  photo_url text,              -- storage path inside the private "photos" bucket, never a public URL
  has_cognitive_condition boolean not null default false,
  emergency_note text,         -- e.g. "Has memory loss. Speak slowly, call my daughter."
  city text,                   -- used by the orientation test ("which city are you in?")
  preferred_language text default 'en',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Consent PIN lives apart from patients so that no RLS policy can ever expose the hash.
create table public.patient_secrets (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  pin_hash text,
  pin_set_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  licence_no text not null,
  council text,
  hospital text,
  specialty text,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.caregiver_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  caregiver_profile_id uuid not null references public.profiles(id) on delete cascade,
  relationship text,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, caregiver_profile_id)
);

-- ---------------------------------------------------------------------------
-- Medical record. `source` says where each entry came from; `verified` stays
-- false for AI-extracted entries until the patient or a doctor confirms them.
-- ---------------------------------------------------------------------------
create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  relationship text,
  phone text not null,
  priority int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conditions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'resolved')),
  onset_date date,
  notes text,
  is_critical boolean not null default false,   -- shown on the emergency view
  source text not null default 'patient-reported' check (source in ('patient-reported', 'doctor-entered', 'ai-extracted')),
  verified boolean not null default false,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  dose text,
  frequency text,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'stopped')),
  prescriber text,
  is_critical boolean not null default false,   -- e.g. blood thinners, insulin: shown on the emergency view
  reminder_times text[] not null default '{}',   -- 'HH:MM' strings for medication reminders
  source text not null default 'patient-reported' check (source in ('patient-reported', 'doctor-entered', 'ai-extracted')),
  verified boolean not null default false,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.allergies (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  substance text not null,
  reaction text,
  severity text not null default 'moderate' check (severity in ('mild', 'moderate', 'severe', 'life-threatening')),
  source text not null default 'patient-reported' check (source in ('patient-reported', 'doctor-entered', 'ai-extracted')),
  verified boolean not null default false,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.history_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  type text not null check (type in ('visit', 'surgery', 'lab', 'vaccination', 'vitals')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  event_date date,
  source text not null default 'patient-reported' check (source in ('patient-reported', 'doctor-entered', 'ai-extracted')),
  verified boolean not null default false,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  storage_path text not null unique,
  doc_type text not null default 'other' check (doc_type in ('prescription', 'lab_report', 'discharge_summary', 'imaging', 'other')),
  filename text not null,
  mime_type text,
  size bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  extraction_status text not null default 'none' check (extraction_status in ('none', 'processing', 'needs_review', 'confirmed', 'failed')),
  extracted_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinician_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.doctors(id) on delete set null,
  note text not null,
  sensitive boolean not null default false,
  patient_access_requested boolean not null default false,
  access_requested_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Consent and access
-- ---------------------------------------------------------------------------
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  grant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  scope text not null default 'full' check (scope in ('full', 'emergency')),
  granted_via text not null check (granted_via in ('pin', 'app_approval', 'break_glass')),
  reason text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,     -- break-glass grants get a later review by the patient/caregiver
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.access_requests
  add constraint access_requests_grant_fk foreign key (grant_id) references public.access_grants(id) on delete set null;

-- The QR code carries only an opaque token. The token is derived from `nonce` with a
-- server-side secret (HMAC), and only its SHA-256 hash is stored for lookup.
create table public.qr_tokens (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  nonce text not null,
  token_hash text not null unique,
  scope text not null default 'emergency' check (scope in ('emergency')),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Cognitive layer
-- ---------------------------------------------------------------------------
create table public.cognitive_tests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  test_type text not null check (test_type in ('word_recall', 'digit_span', 'orientation', 'trail', 'clock')),
  score numeric not null check (score >= 0),
  max_score numeric not null check (max_score > 0),
  duration_sec numeric,
  raw jsonb not null default '{}'::jsonb,
  taken_at timestamptz not null default now(),
  administered_by uuid references public.profiles(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (score <= max_score)
);

create table public.cognitive_alerts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  test_type text not null,
  rule text not null check (rule in ('baseline_drop', 'downward_trend')),
  baseline_score numeric not null,   -- percentages (0-100)
  recent_score numeric not null,
  drop_pct numeric not null,
  ai_summary text,
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI cache, audit, notifications
-- ---------------------------------------------------------------------------
create table public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  type text not null check (type in ('doctor_brief', 'pattern', 'notes', 'drug_check', 'extraction', 'cognitive_alert')),
  content jsonb not null,
  model text not null,
  input_hash text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,  -- null for anonymous QR scans
  actor_role text,
  action text not null check (action in (
    'view', 'create', 'edit', 'delete', 'grant', 'revoke', 'break_glass', 'emergency_scan',
    'access_request', 'access_denied', 'ai_brief', 'verify', 'link'
  )),
  target_type text,
  target_id uuid,
  patient_id uuid references public.patients(id) on delete cascade,
  outcome text not null default 'success' check (outcome in ('success', 'denied', 'error')),
  meta jsonb not null default '{}'::jsonb,   -- never secrets, never PINs
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete cascade,
  kind text not null check (kind in ('break_glass', 'cognitive_alert', 'access_request', 'access_granted', 'caregiver_request', 'note_access_request', 'emergency_scan', 'info')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Drug reference data for the rule-based conflict check (seeded separately).
-- ---------------------------------------------------------------------------
create table public.drug_classes (
  id uuid primary key default gen_random_uuid(),
  drug_name text not null,           -- lower-case generic or brand name
  class_name text not null,          -- lower-case class, e.g. 'anticoagulant'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (drug_name, class_name)
);

create table public.drug_interactions (
  id uuid primary key default gen_random_uuid(),
  term_a text not null,              -- a drug name or a class name (lower-case)
  term_b text not null,
  severity text not null check (severity in ('minor', 'moderate', 'major', 'contraindicated')),
  description text not null,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_a, term_b)
);

create table public.allergy_cross_reactivity (
  id uuid primary key default gen_random_uuid(),
  allergen text not null,            -- allergy substance or class (lower-case)
  drug_term text not null,           -- drug name or class that may cross-react
  severity text not null check (severity in ('minor', 'moderate', 'major', 'contraindicated')),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (allergen, drug_term)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index on public.emergency_contacts (patient_id);
create index on public.conditions (patient_id);
create index on public.medications (patient_id);
create index on public.allergies (patient_id);
create index on public.history_entries (patient_id, event_date desc);
create index on public.documents (patient_id);
create index on public.clinician_notes (patient_id);
create index on public.caregiver_links (caregiver_profile_id);
create index on public.access_grants (patient_id, doctor_id);
create index on public.access_requests (patient_id, status);
create index on public.qr_tokens (patient_id);
create index on public.cognitive_tests (patient_id, test_type, taken_at);
create index on public.cognitive_alerts (patient_id, status);
create index on public.ai_summaries (patient_id, type, created_at desc);
create index on public.audit_logs (patient_id, at desc);
create index on public.audit_logs (actor_profile_id, at desc);
create index on public.notifications (profile_id, created_at desc);
create index on public.drug_classes (drug_name);

-- updated_at triggers on every table
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'patients', 'patient_secrets', 'doctors', 'caregiver_links', 'emergency_contacts',
    'conditions', 'medications', 'allergies', 'history_entries', 'documents', 'clinician_notes',
    'access_requests', 'access_grants', 'qr_tokens', 'cognitive_tests', 'cognitive_alerts',
    'ai_summaries', 'audit_logs', 'notifications', 'drug_classes', 'drug_interactions', 'allergy_cross_reactivity'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
