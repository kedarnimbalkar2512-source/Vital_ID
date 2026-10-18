"use client";

import { Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { usePatientParam } from "@/components/AppShell";
import { DemoBadge } from "@/components/badges";
import { RecordSection } from "@/components/RecordSection";
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, useRequireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { usePatientRecord } from "@/lib/hooks";
import type { Allergy, Condition, EmergencyContact, FullRecord, HistoryEntry, Medication } from "@/lib/types";

function Demographics({ rec, patientId, onSaved }: { rec: FullRecord; patientId: string | null; onSaved: () => void }) {
  const p = rec.patient;
  const [form, setForm] = useState({
    dob: p.dob || "",
    gender: p.gender || "undisclosed",
    blood_group: p.blood_group || "unknown",
    city: p.city || "",
    has_cognitive_condition: p.has_cognitive_condition,
    emergency_note: p.emergency_note || "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/records/patient", { method: "PATCH", json: { patient_id: patientId, ...form, dob: form.dob || null } });
      setMsg("Saved");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Basics & emergency note">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date of birth">
          <Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
        </Field>
        <Field label="Gender">
          <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            {["female", "male", "other", "undisclosed"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="Blood group">
          <Select value={form.blood_group} onChange={(e) => setForm({ ...form, blood_group: e.target.value })}>
            {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
          <input type="checkbox" checked={form.has_cognitive_condition} onChange={(e) => setForm({ ...form, has_cognitive_condition: e.target.checked })} />
          Has a memory condition (shows a &ldquo;how to help&rdquo; banner on the emergency card)
        </label>
        <div className="sm:col-span-2 lg:col-span-4">
          <Field label="Emergency note" hint="Shown to whoever scans the QR. Example: “I have memory loss. Please speak slowly and call my daughter.”">
            <Textarea value={form.emergency_note} maxLength={500} onChange={(e) => setForm({ ...form, emergency_note: e.target.value })} />
          </Field>
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} loading={busy}>
          Save
        </Button>
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
      </div>
    </Card>
  );
}

function PinCard({ rec, patientId }: { rec: FullRecord; patientId: string | null }) {
  const { me } = useAuth();
  const [pin, setPin] = useState("");
  const [current, setCurrent] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsCurrent = rec.pin_set && me?.role === "patient";
  async function save() {
    setError(null);
    try {
      await api("/api/patients/pin", { json: { pin, current_pin: current || null, patient_id: patientId } });
      setMsg("PIN saved");
      setPin("");
      setCurrent("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Lock className="h-4 w-4" /> Consent PIN</span>} action={rec.pin_set ? <Badge tone="green">set</Badge> : <Badge tone="amber">not set</Badge>}>
      <p className="mb-3 text-sm text-slate-600">A doctor needs your VitalID and this PIN to open your full record. Never write it on the QR card.</p>
      <div className="flex flex-wrap items-end gap-3">
        {needsCurrent && (
          <Field label="Current PIN">
            <Input className="w-32" type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
        )}
        <Field label={rec.pin_set ? "New PIN" : "PIN (4–6 digits)"}>
          <Input className="w-32" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        </Field>
        <Button onClick={save} disabled={!/^\d{4,6}$/.test(pin)}>
          Save PIN
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
    </Card>
  );
}

function NotesCard({ rec, patientId, onChange }: { rec: FullRecord; patientId: string | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Clinician notes">
      {rec.clinician_notes.length === 0 && rec.hidden_notes === 0 && <p className="text-sm text-slate-500">No notes from doctors yet.</p>}
      <ul className="space-y-3">
        {rec.clinician_notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p>{n.note}</p>
            <p className="mt-1 text-xs text-slate-500">
              Dr. {n.doctor_name}
              {n.hospital ? `, ${n.hospital}` : ""} · {fmtDate(n.created_at)}
            </p>
          </li>
        ))}
      </ul>
      {rec.hidden_notes > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm">
          <span>
            {rec.hidden_notes} clinician-only note{rec.hidden_notes > 1 ? "s are" : " is"} held back by the doctor. You have a right to your record and can ask
            for {rec.hidden_notes > 1 ? "them" : "it"}.
          </span>
          {rec.hidden_notes_requested ? (
            <Badge tone="blue">Requested</Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await api("/api/notes/request-access", { json: { patient_id: patientId } });
                setBusy(false);
                onChange();
              }}
            >
              Request access
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ProfilePage() {
  const { ready } = useRequireRole("patient", "caregiver");
  const patientParam = usePatientParam();
  const { data: rec, error, reload } = usePatientRecord(patientParam, ready);
  const [key, setKey] = useState(0);
  useEffect(() => setKey((k) => k + 1), [rec?.patient.updated_at]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!rec) return <Spinner />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Medical profile"
        subtitle={`${rec.patient.full_name} · ${rec.patient.vital_id}. Every entry shows where it came from.`}
        action={<DemoBadge show={rec.patient.is_demo} />}
      />
      <Demographics key={key} rec={rec} patientId={patientParam} onSaved={reload} />
      <div className="grid gap-6 xl:grid-cols-2">
        <RecordSection<Allergy>
          title="Allergies"
          table="allergies"
          rows={rec.allergies}
          patientId={patientParam}
          onChange={reload}
          fields={[
            { key: "substance", label: "Substance", required: true },
            { key: "reaction", label: "Reaction" },
            { key: "severity", label: "Severity", type: "select", options: ["moderate", "mild", "severe", "life-threatening"] },
          ]}
          render={(a) => (
            <p className="text-sm">
              <span className="font-medium">{a.substance}</span>
              {a.reaction && <span className="text-slate-500"> · {a.reaction}</span>}
              <span className={`ml-2 text-xs font-semibold uppercase ${a.severity === "life-threatening" || a.severity === "severe" ? "text-red-600" : "text-slate-500"}`}>{a.severity}</span>
            </p>
          )}
        />
        <RecordSection<Medication>
          title="Medicines"
          table="medications"
          rows={rec.medications}
          patientId={patientParam}
          onChange={reload}
          fields={[
            { key: "name", label: "Medicine", required: true },
            { key: "dose", label: "Dose", placeholder: "5 mg" },
            { key: "frequency", label: "How often", placeholder: "Once daily" },
            { key: "status", label: "Status", type: "select", options: ["active", "stopped"] },
            { key: "reminder_times", label: "Reminder times", type: "times" },
            { key: "start_date", label: "Started", type: "date" },
            { key: "is_critical", label: "Critical (show on emergency card)", type: "checkbox" },
          ]}
          render={(m) => (
            <div className="text-sm">
              <p>
                <span className="font-medium">{m.name}</span> <span className="text-slate-600">{m.dose}</span>
                {m.is_critical && <span className="ml-2 text-xs font-semibold uppercase text-red-600">critical</span>}
                {m.status === "stopped" && <span className="ml-2 text-xs uppercase text-slate-400">stopped</span>}
              </p>
              <p className="text-xs text-slate-500">
                {[m.frequency, m.prescriber, m.reminder_times?.length ? `reminders ${m.reminder_times.join(", ")}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
          )}
        />
        <RecordSection<Condition>
          title="Conditions"
          table="conditions"
          rows={rec.conditions}
          patientId={patientParam}
          onChange={reload}
          fields={[
            { key: "name", label: "Condition", required: true },
            { key: "status", label: "Status", type: "select", options: ["active", "resolved"] },
            { key: "onset_date", label: "Since", type: "date" },
            { key: "is_critical", label: "Key condition (show on emergency card)", type: "checkbox" },
          ]}
          render={(c) => (
            <p className="text-sm">
              <span className="font-medium">{c.name}</span>
              <span className="text-slate-500"> · {c.status}{c.onset_date ? ` since ${fmtDate(c.onset_date, { month: "short", year: "numeric" })}` : ""}</span>
            </p>
          )}
        />
        <RecordSection<EmergencyContact>
          title="Emergency contacts"
          table="emergency_contacts"
          rows={rec.emergency_contacts}
          patientId={patientParam}
          onChange={reload}
          fields={[
            { key: "name", label: "Name", required: true },
            { key: "relationship", label: "Relationship" },
            { key: "phone", label: "Phone", required: true },
            { key: "priority", label: "Priority (1 = call first)", type: "select", options: ["1", "2", "3"] },
          ]}
          render={(c) => (
            <p className="text-sm">
              <span className="font-medium">{c.name}</span> <span className="text-slate-500">· {c.relationship} · {c.phone}</span>
            </p>
          )}
        />
      </div>
      <RecordSection<HistoryEntry>
        title="History: visits, surgeries, labs, vaccinations, vitals"
        table="history_entries"
        rows={rec.history_entries}
        patientId={patientParam}
        onChange={reload}
        fields={[
          { key: "type", label: "Type", type: "select", options: ["visit", "surgery", "lab", "vaccination", "vitals"] },
          { key: "title", label: "Title", required: true },
          { key: "event_date", label: "Date", type: "date" },
        ]}
        render={(h) => (
          <div className="text-sm">
            <p>
              <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase text-slate-600">{h.type}</span>
              <span className="font-medium">{h.title}</span>
              <span className="text-slate-500"> · {fmtDate(h.event_date)}</span>
            </p>
            {Object.keys(h.details || {}).length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                {Object.entries(h.details)
                  .filter(([k]) => k !== "results" && k !== "document_id")
                  .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <PinCard rec={rec} patientId={patientParam} />
        <NotesCard rec={rec} patientId={patientParam} onChange={reload} />
      </div>
    </div>
  );
}
