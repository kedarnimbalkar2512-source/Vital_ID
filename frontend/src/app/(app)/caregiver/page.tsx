"use client";

import { Link2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DemoBadge } from "@/components/badges";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { useFetch } from "@/lib/hooks";

interface Linked {
  link_id: string;
  status: "pending" | "active";
  relationship: string | null;
  patient_id: string;
  vital_id: string;
  is_demo: boolean;
  full_name: string | null;
  open_alerts: number | null;
  active_meds: number | null;
  last_test: string | null;
}

export default function CaregiverHome() {
  const { ready } = useRequireRole("caregiver");
  const list = useFetch<Linked[]>(ready ? "/api/caregivers/me" : null);
  const [vid, setVid] = useState("");
  const [rel, setRel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/caregivers/link", { json: { vital_id: vid, relationship: rel } });
      setVid("");
      setRel("");
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My patients" subtitle="Family members you help look after." />
      {list.loading && !list.data ? (
        <Spinner />
      ) : !list.data?.length ? (
        <Empty>You aren&apos;t linked to anyone yet. Ask your family member for their VitalID below.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.data.map((p) =>
            p.status === "active" ? (
              <Link key={p.link_id} href={`/patient?patient=${p.patient_id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-400">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg font-semibold">{p.full_name}</p>
                    <p className="font-mono text-sm text-slate-500">{p.vital_id}</p>
                  </div>
                  <DemoBadge show={p.is_demo} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  {p.open_alerts ? <Badge tone="amber">{p.open_alerts} cognitive signal{p.open_alerts > 1 ? "s" : ""}</Badge> : <Badge tone="green">No open alerts</Badge>}
                  <Badge>{p.active_meds} active medicines</Badge>
                  <Badge>Last check-in {fmtDate(p.last_test)}</Badge>
                </div>
                <p className="mt-3 text-sm font-medium text-brand-700">Manage record →</p>
              </Link>
            ) : (
              <div key={p.link_id} className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
                <p className="font-mono text-sm">{p.vital_id}</p>
                <p className="mt-1 text-sm text-slate-600">Waiting for the patient to approve your link.</p>
              </div>
            ),
          )}
        </div>
      )}
      <Card title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Link to a family member</span>}>
        <form onSubmit={link} className="flex flex-wrap items-end gap-3">
          <Field label="Their VitalID">
            <Input required placeholder="VID-XXXXXX" value={vid} onChange={(e) => setVid(e.target.value.toUpperCase())} />
          </Field>
          <Field label="You are their…">
            <Input required placeholder="daughter, son, spouse…" value={rel} onChange={(e) => setRel(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy}>
            Request link
          </Button>
        </form>
        <ErrorText>{error}</ErrorText>
        <p className="mt-2 text-xs text-slate-500">Nothing is shared until they approve the request in their app.</p>
      </Card>
    </div>
  );
}
