"use client";

import { useState } from "react";

import { DemoBadge } from "@/components/badges";
import { Badge, Button, Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { useFetch } from "@/lib/hooks";

interface Doctor {
  id: string;
  full_name: string;
  email: string | null;
  licence_no: string;
  council: string | null;
  hospital: string | null;
  specialty: string | null;
  verification_status: "pending" | "verified" | "rejected";
  is_demo: boolean;
  created_at: string;
}

export default function AdminPage() {
  const { ready } = useRequireRole("admin");
  const doctors = useFetch<Doctor[]>(ready ? "/api/admin/doctors" : null);
  const stats = useFetch<Record<string, number>>(ready ? "/api/admin/stats" : null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(d: Doctor, approve: boolean) {
    setBusy(d.id + approve);
    await api(`/api/admin/doctors/${d.id}/verify`, { json: { approve } });
    setBusy(null);
    doctors.reload();
    stats.reload();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Doctor verification"
        subtitle="Prototype: check the licence number against the State Medical Council / NMC register manually, then approve. Production: automated NMC registry verification."
      />
      {stats.data && (
        <div className="grid gap-3 sm:grid-cols-5">
          {Object.entries(stats.data).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">{k.replace(/_/g, " ")}</p>
              <p className="text-2xl font-semibold">{v}</p>
            </div>
          ))}
        </div>
      )}
      <Card title="Doctors">
        {!doctors.data ? (
          <Spinner />
        ) : doctors.data.length === 0 ? (
          <Empty>No doctor accounts yet.</Empty>
        ) : (
          <ul className="divide-y">
            {doctors.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    Dr. {d.full_name} <DemoBadge show={d.is_demo} />
                  </p>
                  <p className="text-slate-600">
                    Licence <span className="font-mono">{d.licence_no}</span> · {d.council || "council not given"} · {d.hospital || "—"} · {d.specialty || "—"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {d.email} · registered {fmtDate(d.created_at)}
                  </p>
                </div>
                <Badge tone={d.verification_status === "verified" ? "green" : d.verification_status === "pending" ? "amber" : "red"}>{d.verification_status}</Badge>
                {d.verification_status !== "verified" && (
                  <Button size="sm" loading={busy === d.id + true} onClick={() => decide(d, true)}>
                    Approve
                  </Button>
                )}
                {d.verification_status !== "rejected" && (
                  <Button size="sm" variant="outline" loading={busy === d.id + false} onClick={() => decide(d, false)}>
                    {d.verification_status === "verified" ? "Revoke" : "Reject"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-slate-500">Admins approve accounts but have no routine access to clinical records.</p>
    </div>
  );
}
