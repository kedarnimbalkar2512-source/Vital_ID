"use client";

import { Clock, Lock, Unlock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AddMedication } from "@/components/AddMedication";
import { AIBrief } from "@/components/AIBrief";
import { AlertCard } from "@/components/AlertCard";
import { DemoBadge, ScreeningDisclaimer, SourceBadge } from "@/components/badges";
import { PatternsPanel } from "@/components/PatternsPanel";
import { TrendChart, type Trend } from "@/components/TrendChart";
import { Badge, Button, Card, cn, Empty, ErrorText, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { ageFrom, fmtDate, fmtDateTime } from "@/lib/format";
import { useFetch } from "@/lib/hooks";
import type { FullRecord } from "@/lib/types";

const TABS = ["Overview", "History", "Cognitive", "Notes", "Documents", "Patterns"] as const;
type Tab = (typeof TABS)[number];

function QuickAdd({ vitalId, onAdded }: { vitalId: string; onAdded: () => void }) {
  const [kind, setKind] = useState<"condition" | "allergy">("condition");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [sev, setSev] = useState("moderate");
  const [crit, setCrit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (kind === "condition") await api(`/api/patients/${vitalId}/conditions`, { json: { name: a, notes: b || null, is_critical: crit } });
      else await api(`/api/patients/${vitalId}/allergies`, { json: { substance: a, reaction: b || null, severity: sev } });
      setA("");
      setB("");
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-5">
      <Field label="Add">
        <Select value={kind} onChange={(e) => setKind(e.target.value as "condition" | "allergy")}>
          <option value="condition">Diagnosis / condition</option>
          <option value="allergy">Allergy</option>
        </Select>
      </Field>
      <Field label={kind === "condition" ? "Condition" : "Substance"}>
        <Input required value={a} onChange={(e) => setA(e.target.value)} />
      </Field>
      <Field label={kind === "condition" ? "Notes" : "Reaction"}>
        <Input value={b} onChange={(e) => setB(e.target.value)} />
      </Field>
      {kind === "allergy" ? (
        <Field label="Severity">
          <Select value={sev} onChange={(e) => setSev(e.target.value)}>
            {["mild", "moderate", "severe", "life-threatening"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      ) : (
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} /> Key condition
        </label>
      )}
      <div className="flex items-end">
        <Button type="submit" variant="outline" className="w-full">
          Save
        </Button>
      </div>
      <div className="sm:col-span-5">
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}

function NoteForm({ vitalId, onAdded }: { vitalId: string; onAdded: () => void }) {
  const [note, setNote] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await api(`/api/patients/${vitalId}/notes`, { json: { note, sensitive } });
        setBusy(false);
        setNote("");
        onAdded();
      }}
    >
      <Textarea required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clinical note" />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
          Clinician-only (hidden from the patient until released; they can request it)
        </label>
        <Button type="submit" loading={busy}>
          Add note
        </Button>
      </div>
    </form>
  );
}

export default function DoctorPatientView({ params }: { params: { vitalId: string } }) {
  const { me, ready } = useRequireRole("doctor");
  const vitalId = decodeURIComponent(params.vitalId).toUpperCase();
  const rec = useFetch<FullRecord>(ready ? `/api/patients/${vitalId}/record` : null);
  const trend = useFetch<Trend>(rec.data ? `/api/cognitive/trend/${rec.data.patient.id}` : null);
  const [tab, setTab] = useState<Tab>("Overview");

  if (rec.error)
    return (
      <div className="max-w-xl space-y-3">
        <ErrorText>{rec.error}</ErrorText>
        <Link href={`/doctor?vid=${vitalId}`} className="text-sm font-medium text-brand-700 hover:underline">
          ← Request access
        </Link>
      </div>
    );
  if (!rec.data) return <Spinner label="Opening record…" />;
  const r = rec.data;
  const p = r.patient;
  const activeMeds = r.medications.filter((m) => m.status === "active");
  const openAlerts = r.cognitive_alerts.filter((a) => a.status === "open");

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.full_name} <span className="font-mono text-base font-normal text-slate-500">{p.vital_id}</span> <DemoBadge show={p.is_demo} />
          </span>
        }
        subtitle={[ageFrom(p.dob) ? `${ageFrom(p.dob)} y` : null, p.gender, `Blood ${p.blood_group || "?"}`, p.has_cognitive_condition ? "Known memory condition" : null].filter(Boolean).join(" · ")}
        action={
          r.grant && (
            <Badge tone={r.grant.granted_via === "break_glass" ? "red" : "green"}>
              <Clock className="h-3 w-3" /> {r.grant.granted_via === "break_glass" ? "Break-glass" : "Consented"} access until {fmtDateTime(r.grant.expires_at)}
            </Badge>
          )
        }
      />

      {r.allergies.some((a) => a.severity === "life-threatening" || a.severity === "severe") && (
        <div className="rounded-xl bg-red-600 px-4 py-3 text-white">
          <span className="font-bold uppercase">Allergy:</span>{" "}
          {r.allergies
            .filter((a) => a.severity === "life-threatening" || a.severity === "severe")
            .map((a) => `${a.substance} (${a.reaction || a.severity})`)
            .join(" · ")}
        </div>
      )}

      {openAlerts.map((a) => (
        <AlertCard key={a.id} alert={a} onChange={rec.reload} />
      ))}

      <AIBrief vitalId={vitalId} />

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium", tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-6">
          <Card title="Prescribe / add medicine">
            <AddMedication vitalId={vitalId} onAdded={rec.reload} />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={`Active medicines (${activeMeds.length})`}>
              {activeMeds.length === 0 ? (
                <Empty>None recorded.</Empty>
              ) : (
                <ul className="divide-y text-sm">
                  {activeMeds.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-2 py-2">
                      <div>
                        <p>
                          <b>{m.name}</b> {m.dose} {m.is_critical && <Badge tone="red">critical</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">{[m.frequency, m.prescriber, m.start_date ? `since ${fmtDate(m.start_date)}` : null].filter(Boolean).join(" · ")}</p>
                      </div>
                      <SourceBadge source={m.source} verified={m.verified} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Conditions & allergies">
              <ul className="divide-y text-sm">
                {r.conditions.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 py-2">
                    <p>
                      <b>{c.name}</b> <span className="text-slate-500">{c.status}{c.onset_date ? ` · since ${fmtDate(c.onset_date, { month: "short", year: "numeric" })}` : ""}</span>
                    </p>
                    <SourceBadge source={c.source} verified={c.verified} />
                  </li>
                ))}
                {r.allergies.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 py-2">
                    <p className="text-red-800">
                      <b>Allergy: {a.substance}</b> <span>{a.reaction} · {a.severity}</span>
                    </p>
                    <SourceBadge source={a.source} verified={a.verified} />
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t pt-4">
                <QuickAdd vitalId={vitalId} onAdded={rec.reload} />
              </div>
            </Card>
          </div>
          <Card title="Emergency contacts">
            <ul className="text-sm">
              {r.emergency_contacts.map((c) => (
                <li key={c.id}>
                  {c.name} ({c.relationship}) · {c.phone}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "History" && (
        <Card title="Timeline">
          {r.history_entries.length === 0 ? (
            <Empty>No history entries.</Empty>
          ) : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-6">
              {r.history_entries.map((h) => (
                <li key={h.id}>
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-brand-500" />
                  <p className="text-xs text-slate-500">
                    {fmtDate(h.event_date)} · <span className="uppercase">{h.type}</span>
                  </p>
                  <p className="text-sm font-medium">
                    {h.title} <SourceBadge source={h.source} verified={h.verified} />
                  </p>
                  {Object.keys(h.details || {}).length > 0 && (
                    <p className="text-xs text-slate-600">
                      {Object.entries(h.details)
                        .filter(([k]) => k !== "document_id")
                        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                        .join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === "Cognitive" && (
        <Card title="Cognitive screening trend">
          {trend.data ? <TrendChart trend={trend.data} /> : <Spinner />}
          {trend.data && (
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {Object.entries(trend.data.summary).map(([k, s]) => (
                <div key={k} className="rounded-lg border p-3 text-sm">
                  <p className="text-xs uppercase text-slate-500">{s.label}</p>
                  <p>
                    baseline <b>{Math.round(s.baseline_pct)}%</b> → recent <b>{Math.round(s.recent_pct)}%</b>
                  </p>
                  <p className="text-xs text-slate-500">{s.tests} tests</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <ScreeningDisclaimer />
          </div>
        </Card>
      )}

      {tab === "Notes" && (
        <Card title="Clinician notes">
          <NoteForm vitalId={vitalId} onAdded={rec.reload} />
          <ul className="mt-4 space-y-3">
            {r.clinician_notes.map((n) => (
              <li key={n.id} className={cn("rounded-lg p-3 text-sm", n.sensitive && !n.released_at ? "border border-slate-300 bg-slate-100" : "bg-slate-50")}>
                <p>{n.note}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  Dr. {n.doctor_name} · {fmtDate(n.created_at)}
                  {n.sensitive && !n.released_at && (
                    <Badge tone="slate">
                      <Lock className="h-3 w-3" /> clinician-only
                    </Badge>
                  )}
                  {n.patient_access_requested && !n.released_at && <Badge tone="blue">patient requested access</Badge>}
                  {n.sensitive && !n.released_at && n.doctor_id === me?.doctor_id && (
                    <button
                      className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                      onClick={async () => {
                        await api(`/api/notes/${n.id}/release`, { method: "POST" });
                        rec.reload();
                      }}
                    >
                      <Unlock className="h-3 w-3" /> Release to patient
                    </button>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === "Documents" && (
        <Card title="Documents">
          {r.documents.length === 0 ? (
            <Empty>No documents.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {r.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <button
                    className="font-medium hover:underline"
                    onClick={async () => {
                      const { url } = await api<{ url: string }>(`/api/records/documents/${d.id}/url`);
                      window.open(url, "_blank", "noopener");
                    }}
                  >
                    {d.filename}
                  </button>
                  <span className="text-xs text-slate-500">
                    {d.doc_type.replace("_", " ")} · {fmtDate(d.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "Patterns" && <PatternsPanel vitalId={vitalId} />}
    </div>
  );
}
