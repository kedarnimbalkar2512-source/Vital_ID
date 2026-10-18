"use client";

import { Camera, KeyRound, Search, Siren, Smartphone } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DemoBadge } from "@/components/badges";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, PageHeader, Spinner, Textarea } from "@/components/ui";
import { api, publicApi } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useFetch } from "@/lib/hooks";

const QrScanner = dynamic(() => import("@/components/QrScanner"), { ssr: false });

interface MyPatient {
  patient_id: string;
  vital_id: string;
  full_name: string;
  is_demo: boolean;
  granted_via: string;
  expires_at: string;
  open_alerts: number;
}

type Mode = "pin" | "app" | "break";

export default function DoctorHome() {
  const { me, ready } = useRequireRole("doctor");
  const verified = me?.doctor_status === "verified";
  const router = useRouter();
  const params = useSearchParams();
  const patients = useFetch<MyPatient[]>(ready && verified ? "/api/doctor/patients" : null);
  const [vid, setVid] = useState(params.get("vid") || "");
  const [mode, setMode] = useState<Mode>("pin");
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (poll.current) clearInterval(poll.current);
  }, []);

  const open = (v: string) => router.push(`/doctor/patient/${v}`);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const vital_id = vid.trim().toUpperCase();
    try {
      if (mode === "break") {
        if (!window.confirm("Emergency access is logged, time-limited, and the patient and family are notified immediately. Continue?")) return;
        const r = await api<{ vital_id: string }>("/api/access/break-glass", { json: { vital_id, reason } });
        return open(r.vital_id);
      }
      const r = await api<{ status: string; vital_id: string; request_id?: string }>("/api/access/request", {
        json: { vital_id, pin: mode === "pin" ? pin : null, reason: reason || null },
      });
      if (r.status === "granted") return open(r.vital_id);
      setPending(r.request_id!);
      poll.current = setInterval(async () => {
        const s = await api<{ status: string; vital_id: string }>(`/api/access/requests/${r.request_id}`);
        if (s.status === "approved") {
          clearInterval(poll.current!);
          open(s.vital_id);
        } else if (s.status !== "pending") {
          clearInterval(poll.current!);
          setPending(null);
          setError(`The request was ${s.status}.`);
        }
      }, 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Spinner />;
  if (!verified)
    return (
      <div className="max-w-xl">
        <PageHeader title="Awaiting verification" />
        <Card>
          <p className="text-sm text-slate-700">
            Your licence number is being checked by a VitalID admin. You&apos;ll be able to look up patients once it&apos;s approved. In production this step
            will check the National Medical Commission registry automatically.
          </p>
          <Badge tone="amber" className="mt-3">
            {me?.doctor_status}
          </Badge>
        </Card>
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Patient lookup" subtitle="Full records need the VitalID and the patient's consent. Everything you open is logged." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="VitalID">
                  <Input required placeholder="VID-XXXXXX" className="font-mono text-lg uppercase" value={vid} onChange={(e) => setVid(e.target.value.toUpperCase())} />
                </Field>
              </div>
              <Button type="button" variant="outline" onClick={() => setScanning((s) => !s)}>
                <Camera className="h-4 w-4" /> Scan QR
              </Button>
            </div>
            {scanning && (
              <QrScanner
                onToken={async (token) => {
                  setScanning(false);
                  try {
                    const e = await publicApi<{ vital_id: string }>(`/api/emergency/${token}`);
                    setVid(e.vital_id);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
                onError={(m) => setError(m)}
              />
            )}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["pin", KeyRound, "Patient PIN"],
                  ["app", Smartphone, "Ask in their app"],
                  ["break", Siren, "Emergency"],
                ] as const
              ).map(([m, Icon, label]) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                    mode === m ? (m === "break" ? "border-red-500 bg-red-50 text-red-800" : "border-brand-500 bg-brand-50 text-brand-800") : "border-slate-200 text-slate-600"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            {mode === "pin" && (
              <Field label="Patient's consent PIN" hint="The patient (or caregiver) tells you their PIN. Wrong PINs are logged; 5 in 15 minutes locks PIN entry.">
                <Input required type="password" inputMode="numeric" pattern="\d{4,6}" className="w-40 text-lg tracking-widest" value={pin} onChange={(e) => setPin(e.target.value)} />
              </Field>
            )}
            {mode === "app" && (
              <Field label="Reason (shown to the patient)">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="OPD consultation" />
              </Field>
            )}
            {mode === "break" && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <Field label="Clinical reason (required, logged and shown to the family)">
                  <Textarea required minLength={15} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Unconscious after road accident, brought to ER, no relatives present" />
                </Field>
                <p className="mt-2 text-xs text-red-800">Break-glass is for patients who cannot consent. Access is short-lived and reviewed afterwards.</p>
              </div>
            )}
            <ErrorText>{error}</ErrorText>
            {pending ? (
              <div className="flex items-center gap-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                Waiting for the patient or caregiver to approve in their app…
              </div>
            ) : (
              <Button type="submit" size="lg" loading={busy} variant={mode === "break" ? "danger" : "primary"}>
                <Search className="h-4 w-4" />
                {mode === "pin" ? "Open record" : mode === "app" ? "Send request" : "Use emergency access"}
              </Button>
            )}
          </form>
        </Card>
        <Card className="lg:col-span-2" title="Patients you can access now">
          {!patients.data ? (
            <Spinner />
          ) : patients.data.length === 0 ? (
            <Empty>None right now.</Empty>
          ) : (
            <ul className="divide-y">
              {patients.data.map((p) => (
                <li key={p.patient_id}>
                  <Link href={`/doctor/patient/${p.vital_id}`} className="flex items-center gap-3 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">
                        {p.full_name} <DemoBadge show={p.is_demo} />
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        {p.vital_id} · until {fmtDateTime(p.expires_at)}
                      </p>
                    </div>
                    {p.open_alerts > 0 && <Badge tone="amber">{p.open_alerts} alert{p.open_alerts > 1 ? "s" : ""}</Badge>}
                    {p.granted_via === "break_glass" && <Badge tone="red">break-glass</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
