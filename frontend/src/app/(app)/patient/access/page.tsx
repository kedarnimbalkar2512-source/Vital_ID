"use client";

import { ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";

import { usePatientParam } from "@/components/AppShell";
import { Badge, Button, Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { api, withPatient } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { useFetch } from "@/lib/hooks";
import type { AccessRequest, AuditRow, Grant } from "@/lib/types";

const VIA: Record<string, string> = { pin: "PIN", app_approval: "app approval", break_glass: "EMERGENCY break-glass" };

interface CaregiverLink {
  id: string;
  relationship: string | null;
  status: "pending" | "active";
  full_name: string;
  phone: string | null;
}

function actorLabel(r: AuditRow) {
  if (r.actor_role === "emergency_viewer") return "Someone who scanned the QR";
  if (!r.actor_name) return "System";
  const prefix = r.actor_role === "doctor" ? "Dr. " : "";
  return `${prefix}${r.actor_name}${r.actor_hospital ? ` (${r.actor_hospital})` : ""}`;
}

export default function AccessPage() {
  const { me, ready } = useRequireRole("patient", "caregiver");
  const patientParam = usePatientParam();
  const access = useFetch<{ grants: Grant[]; requests: AccessRequest[] }>(ready ? withPatient("/api/access/me", patientParam) : null);
  const audit = useFetch<AuditRow[]>(ready ? withPatient("/api/audit/me", patientParam) : null);
  const caregivers = useFetch<CaregiverLink[]>(ready && me?.role === "patient" ? "/api/caregivers/for-patient" : null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
      access.reload();
      audit.reload();
      caregivers.reload();
    }
  }

  if (!access.data) return <Spinner />;
  const active = access.data.grants.filter((g) => g.active);
  const past = access.data.grants.filter((g) => !g.active);
  const unreviewed = access.data.grants.filter((g) => g.granted_via === "break_glass" && !g.reviewed_at);

  return (
    <div className="space-y-6">
      <PageHeader title="Access & privacy" subtitle="Who can see the record, for how long, and everyone who has looked." />

      {access.data.requests.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-sky-600" /> Waiting for your approval</span>}>
          <ul className="divide-y">
            {access.data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    Dr. {r.doctor_name} {r.hospital && <span className="font-normal text-slate-500">· {r.hospital}</span>}
                  </p>
                  <p className="text-slate-600">{r.reason || "No reason given"} · {timeAgo(r.created_at)}</p>
                </div>
                <Button size="sm" loading={busy === r.id + "y"} onClick={() => run(r.id + "y", () => api(`/api/access/requests/${r.id}/decide`, { json: { approve: true } }))}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" loading={busy === r.id + "n"} onClick={() => run(r.id + "n", () => api(`/api/access/requests/${r.id}/decide`, { json: { approve: false } }))}>
                  Deny
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {unreviewed.map((g) => (
        <div key={g.id} className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="font-semibold text-red-900">Emergency access by Dr. {g.doctor_name}{g.hospital ? ` (${g.hospital})` : ""}</p>
          <p className="mt-1 text-sm text-red-800">
            {fmtDateTime(g.created_at)} · Reason: {g.reason}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" loading={busy === g.id + "r"} onClick={() => run(g.id + "r", () => api(`/api/access/${g.id}/review`, { method: "POST" }))}>
              I&apos;ve reviewed this
            </Button>
            {g.active && (
              <Button size="sm" variant="danger" loading={busy === g.id} onClick={() => run(g.id, () => api(`/api/access/${g.id}/revoke`, { method: "POST" }))}>
                End access now
              </Button>
            )}
          </div>
        </div>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Doctors with access now</span>}>
          {active.length === 0 ? (
            <Empty>No doctor can see the full record right now.</Empty>
          ) : (
            <ul className="divide-y">
              {active.map((g) => (
                <li key={g.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">
                      Dr. {g.doctor_name} {g.hospital && <span className="font-normal text-slate-500">· {g.hospital}</span>}
                    </p>
                    <p className="text-slate-600">
                      via {VIA[g.granted_via]} · until {fmtDateTime(g.expires_at)}
                    </p>
                  </div>
                  <Button size="sm" variant="danger" loading={busy === g.id} onClick={() => run(g.id, () => api(`/api/access/${g.id}/revoke`, { method: "POST" }))}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <details className="mt-3 text-sm text-slate-600">
              <summary className="cursor-pointer">Past access ({past.length})</summary>
              <ul className="mt-2 space-y-1">
                {past.map((g) => (
                  <li key={g.id}>
                    Dr. {g.doctor_name} · {VIA[g.granted_via]} · {fmtDateTime(g.created_at)} · {g.revoked_at ? "revoked" : "expired"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        {me?.role === "patient" && (
          <Card title={<span className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Caregivers</span>}>
            {!caregivers.data?.length ? (
              <Empty>No caregivers. A family member can register as a caregiver and request a link using your VitalID.</Empty>
            ) : (
              <ul className="divide-y">
                {caregivers.data.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">{c.full_name}</p>
                      <p className="text-slate-600">{c.relationship} · {c.phone}</p>
                    </div>
                    {c.status === "pending" ? (
                      <>
                        <Button size="sm" loading={busy === c.id + "y"} onClick={() => run(c.id + "y", () => api(`/api/caregivers/links/${c.id}/decide`, { json: { approve: true } }))}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" loading={busy === c.id + "n"} onClick={() => run(c.id + "n", () => api(`/api/caregivers/links/${c.id}/decide`, { json: { approve: false } }))}>
                          Decline
                        </Button>
                      </>
                    ) : (
                      <>
                        <Badge tone="green">active</Badge>
                        <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => run(c.id, () => api(`/api/caregivers/links/${c.id}/decide`, { json: { approve: false } }))}>
                          Remove
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Card title="Who viewed or changed the record">
        {!audit.data ? (
          <Spinner />
        ) : audit.data.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Who</th>
                  <th className="py-2 pr-4">What</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {audit.data.map((r) => (
                  <tr key={r.id} className={r.action === "break_glass" ? "bg-red-50" : r.outcome === "denied" ? "bg-amber-50" : ""}>
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-500">{fmtDateTime(r.at)}</td>
                    <td className="py-2 pr-4 font-medium">{actorLabel(r)}</td>
                    <td className="py-2 pr-4 text-slate-700">
                      {r.summary}
                      {r.target_type && !["patients", "access_grants", "access_requests", "qr_tokens", "ai_summaries"].includes(r.target_type) && (
                        <span className="text-slate-500"> {r.target_type.replace(/_/g, " ").replace(/s$/, "")}</span>
                      )}
                      {r.action === "access_denied" && r.meta?.reason === "wrong_pin" && <span className="text-amber-700"> (wrong PIN)</span>}
                      {typeof r.meta?.reason === "string" && r.action === "break_glass" && <span className="text-red-700">: {r.meta.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
