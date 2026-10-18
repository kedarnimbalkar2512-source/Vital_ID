"use client";

import { Brain, Clock, Pill, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

import { usePatientParam } from "@/components/AppShell";
import { AlertCard } from "@/components/AlertCard";
import { DemoBadge, ScreeningDisclaimer } from "@/components/badges";
import { TrendChart, type Trend } from "@/components/TrendChart";
import { Badge, Card, Empty, ErrorText, PageHeader, Spinner } from "@/components/ui";
import { withPatient } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useFetch, usePatientRecord } from "@/lib/hooks";
import type { AccessRequest, FullRecord } from "@/lib/types";

function completeness(r: FullRecord) {
  const checks = [
    !!r.patient.dob,
    !!r.patient.blood_group && r.patient.blood_group !== "unknown",
    r.emergency_contacts.length > 0,
    r.allergies.length > 0,
    r.medications.length > 0,
    r.conditions.length > 0,
    r.pin_set,
    !!r.patient.emergency_note,
  ];
  return Math.round((100 * checks.filter(Boolean).length) / checks.length);
}

export default function PatientHome() {
  const { ready } = useRequireRole("patient", "caregiver");
  const patientParam = usePatientParam();
  const { data: rec, error, reload } = usePatientRecord(patientParam, ready);
  const pid = rec?.patient.id;
  const trend = useFetch<Trend>(pid ? `/api/cognitive/trend/${pid}` : null);
  const qr = useFetch<{ active: boolean; url?: string }>(ready ? withPatient("/api/qr/current", patientParam) : null);
  const access = useFetch<{ requests: AccessRequest[] }>(ready ? withPatient("/api/access/me", patientParam) : null);
  const q = patientParam ? `?patient=${patientParam}` : "";

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!rec) return <Spinner />;
  const p = rec.patient;
  const pct = completeness(rec);
  const activeMeds = rec.medications.filter((m) => m.status === "active");
  const openAlerts = rec.cognitive_alerts.filter((a) => a.status === "open");
  const reminders = activeMeds
    .flatMap((m) => (m.reminder_times || []).map((t) => ({ t, m })))
    .sort((a, b) => a.t.localeCompare(b.t));

  return (
    <div className="space-y-6">
      <PageHeader title={patientParam ? p.full_name : `Hello, ${p.full_name.split(" ")[0]}`} subtitle={patientParam ? "You are managing this patient's record as their caregiver." : undefined} action={<DemoBadge show={p.is_demo} />} />

      {(access.data?.requests.length || 0) > 0 && (
        <Link href={`/patient/access${q}`} className="flex items-center gap-3 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-900 hover:bg-sky-100">
          <ShieldAlert className="h-5 w-5" />
          <span className="text-sm font-medium">
            {access.data!.requests.length} doctor{access.data!.requests.length > 1 ? "s are" : " is"} asking to see the record. Review now.
          </span>
        </Link>
      )}

      {openAlerts.map((a) => (
        <AlertCard key={a.id} alert={a} onChange={reload} />
      ))}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="VitalID card">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="font-mono text-2xl font-bold tracking-widest text-brand-700">{p.vital_id}</p>
            {qr.data?.active && qr.data.url ? (
              <QRCodeSVG value={qr.data.url} size={150} level="M" />
            ) : (
              <p className="text-sm text-slate-500">QR is switched off</p>
            )}
            <Link href={`/patient/qr${q}`} className="text-sm font-medium text-brand-700 hover:underline">
              Print card, rotate or revoke →
            </Link>
          </div>
        </Card>

        <Card className="lg:col-span-2" title="Cognitive check-ins" action={<Link href={`/patient/cognitive${q}`} className="text-sm font-medium text-brand-700 hover:underline">Take a check-in →</Link>}>
          {trend.data ? <TrendChart trend={trend.data} height={220} /> : <Spinner />}
          <div className="mt-3">
            <ScreeningDisclaimer />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Profile completeness">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16">
              <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#257b72" strokeWidth="3.5" strokeDasharray={`${pct} 100`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 grid place-items-center text-sm font-semibold">{pct}%</span>
            </div>
            <ul className="space-y-1 text-sm text-slate-600">
              {!rec.pin_set && <li>• Set a consent PIN</li>}
              {!rec.emergency_contacts.length && <li>• Add an emergency contact</li>}
              {!p.emergency_note && <li>• Write an emergency note</li>}
              {!rec.allergies.length && <li>• Record allergies (or “none”)</li>}
              {pct === 100 && <li>Everything important is filled in.</li>}
            </ul>
          </div>
          <Link href={`/patient/profile${q}`} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
            Edit medical profile →
          </Link>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Today&apos;s medicines</span>}>
          {reminders.length === 0 ? (
            <Empty>No reminder times set.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {reminders.map(({ t, m }) => (
                <li key={m.id + t} className="flex items-center justify-between py-2">
                  <span className="font-mono text-slate-500">{t}</span>
                  <span className="flex-1 px-3 font-medium">
                    {m.name} <span className="font-normal text-slate-500">{m.dose}</span>
                  </span>
                  {m.is_critical && <Badge tone="red">critical</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><Pill className="h-4 w-4" /> Key information</span>}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Blood group</dt><dd className="font-semibold">{p.blood_group || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Allergies</dt><dd className="text-right font-medium text-red-700">{rec.allergies.map((a) => a.substance).join(", ") || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Active medicines</dt><dd>{activeMeds.length}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Conditions</dt><dd className="text-right">{rec.conditions.filter((c) => c.status === "active").map((c) => c.name).join(", ") || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Last updated</dt><dd>{fmtDateTime(p.updated_at)}</dd></div>
          </dl>
        </Card>
      </div>

      {trend.data && Object.keys(trend.data.summary).length > 0 && (
        <Card title={<span className="flex items-center gap-2"><Brain className="h-4 w-4" /> Scores vs. baseline</span>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(trend.data.summary).map(([k, s]) => {
              const delta = s.recent_pct - s.baseline_pct;
              return (
                <div key={k} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{Math.round(s.recent_pct)}%</p>
                  <p className={delta < -5 ? "text-xs text-amber-700" : "text-xs text-slate-500"}>
                    baseline {Math.round(s.baseline_pct)}% · {s.tests} tests
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
