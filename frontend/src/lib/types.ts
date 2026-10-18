export type Role = "patient" | "caregiver" | "doctor" | "admin";
export type Source = "patient-reported" | "doctor-entered" | "ai-extracted";

export interface Me {
  profile_id: string;
  role: Role;
  full_name: string;
  phone: string | null;
  is_demo: boolean;
  patient_id: string | null;
  vital_id: string | null;
  doctor_id: string | null;
  doctor_status: "pending" | "verified" | "rejected" | null;
  unread_notifications: number;
}

interface Base {
  id: string;
  patient_id: string;
  created_at: string;
  updated_at: string;
}

export interface Condition extends Base {
  name: string;
  status: "active" | "resolved";
  onset_date: string | null;
  notes: string | null;
  is_critical: boolean;
  source: Source;
  verified: boolean;
}

export interface Medication extends Base {
  name: string;
  dose: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "active" | "stopped";
  prescriber: string | null;
  is_critical: boolean;
  reminder_times: string[];
  source: Source;
  verified: boolean;
}

export interface Allergy extends Base {
  substance: string;
  reaction: string | null;
  severity: "mild" | "moderate" | "severe" | "life-threatening";
  source: Source;
  verified: boolean;
}

export interface HistoryEntry extends Base {
  type: "visit" | "surgery" | "lab" | "vaccination" | "vitals";
  title: string;
  details: Record<string, unknown>;
  event_date: string | null;
  source: Source;
  verified: boolean;
}

export interface EmergencyContact extends Base {
  name: string;
  relationship: string | null;
  phone: string;
  priority: number;
}

export interface DocumentMeta {
  id: string;
  doc_type: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  extraction_status: "none" | "processing" | "needs_review" | "confirmed" | "failed";
  extracted_json: Extraction | null;
  created_at: string;
}

export interface Extraction {
  document_date: string | null;
  medications: { name: string; dose?: string | null; frequency?: string | null }[];
  conditions: { name: string }[];
  allergies: { substance: string; reaction?: string | null }[];
  lab_results: { test: string; value: string; unit?: string | null; reference_range?: string | null }[];
  summary?: string | null;
  model?: string;
}

export interface ClinicianNote {
  id: string;
  note: string;
  sensitive: boolean;
  released_at: string | null;
  patient_access_requested: boolean;
  doctor_name: string;
  hospital: string | null;
  doctor_id: string | null;
  created_at: string;
}

export interface CognitiveAlert {
  id: string;
  patient_id: string;
  test_type: string;
  rule: "baseline_drop" | "downward_trend";
  baseline_score: number;
  recent_score: number;
  drop_pct: number;
  ai_summary: string | null;
  status: "open" | "acknowledged";
  created_at: string;
  vital_id?: string;
  full_name?: string;
}

export interface PatientRow {
  id: string;
  vital_id: string;
  full_name: string;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  blood_group: string | null;
  photo_url: string | null;
  has_cognitive_condition: boolean;
  emergency_note: string | null;
  city: string | null;
  is_demo: boolean;
  updated_at: string;
}

export interface FullRecord {
  patient: PatientRow;
  conditions: Condition[];
  medications: Medication[];
  allergies: Allergy[];
  history_entries: HistoryEntry[];
  emergency_contacts: EmergencyContact[];
  documents: DocumentMeta[];
  clinician_notes: ClinicianNote[];
  hidden_notes: number;
  hidden_notes_requested?: boolean;
  cognitive_alerts: CognitiveAlert[];
  pin_set: boolean;
  grant?: { id: string; granted_via: string; expires_at: string } | null;
}

export interface Grant {
  id: string;
  doctor_name: string;
  hospital: string | null;
  specialty: string | null;
  granted_via: "pin" | "app_approval" | "break_glass";
  reason: string | null;
  expires_at: string;
  revoked_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  active: boolean;
}

export interface AccessRequest {
  id: string;
  doctor_name: string;
  hospital: string | null;
  specialty: string | null;
  reason: string | null;
  created_at: string;
}

export interface AuditRow {
  id: string;
  action: string;
  summary: string;
  target_type: string | null;
  outcome: string;
  meta: Record<string, unknown>;
  at: string;
  actor_role: string | null;
  actor_name: string | null;
  actor_hospital: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Cited {
  text: string;
  source_ids: string[];
}

export interface SourceRef {
  table: string;
  label: string;
  source: string | null;
  verified: boolean | null;
}

export interface DrugWarning {
  type: string;
  severity: "minor" | "moderate" | "major" | "contraindicated";
  involves: string[];
  description: string;
  source_ids: string[];
  reference: string | null;
}
