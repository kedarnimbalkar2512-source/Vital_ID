"use client";

import { Download, Eye, Printer, RefreshCw, ShieldOff } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";

import { usePatientParam } from "@/components/AppShell";
import { Button, Card, ErrorText, PageHeader, Spinner } from "@/components/ui";
import { api, withPatient } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useFetch, usePatientRecord } from "@/lib/hooks";

interface QrState {
  active: boolean;
  token?: string;
  url?: string;
  created_at?: string;
  last_used_at?: string | null;
}

export default function QrPage() {
  const { ready } = useRequireRole("patient", "caregiver");
  const patientParam = usePatientParam();
  const { data: rec } = usePatientRecord(patientParam, ready);
  const qr = useFetch<QrState>(ready ? withPatient("/api/qr/current", patientParam) : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  async function act(kind: "rotate" | "revoke") {
    const msg =
      kind === "rotate"
        ? "Issue a new QR? Any printed card or sticker with the old QR will stop working."
        : "Switch the QR off? Nobody will be able to see the emergency card until you issue a new one.";
    if (!window.confirm(msg)) return;
    setBusy(kind);
    setError(null);
    try {
      qr.setData(await api<QrState>(`/api/qr/${kind}`, { json: { patient_id: patientParam } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function downloadSvg() {
    const svg = cardRef.current?.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vitalid-${rec?.patient.vital_id || "qr"}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!rec || qr.loading) return <Spinner />;
  const p = rec.patient;
  const critical = rec.allergies.filter((a) => a.severity === "life-threatening" || a.severity === "severe");
  const contact = rec.emergency_contacts[0];

  return (
    <div className="space-y-6">
      <PageHeader title="QR card" subtitle="The QR holds only a random link. It never contains medical data, and you can replace it any time." />
      <ErrorText>{error}</ErrorText>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Wallet card">
          {qr.data?.active && qr.data.url ? (
            <>
              <div ref={cardRef} className="mx-auto max-w-sm overflow-hidden rounded-2xl border-2 border-red-600 bg-white shadow print:shadow-none">
                <div className="bg-red-600 px-4 py-2 text-center text-sm font-bold uppercase tracking-wide text-white">
                  {p.has_cognitive_condition ? "I have memory loss: please help me" : "Medical emergency card"}
                </div>
                <div className="flex gap-4 p-4">
                  <QRCodeSVG value={qr.data.url} size={128} level="M" includeMargin={false} />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">{p.full_name}</p>
                    <p className="font-mono text-xs text-slate-600">{p.vital_id}</p>
                    <p className="mt-2">
                      Blood: <b>{p.blood_group || "?"}</b>
                    </p>
                    {critical.length > 0 && <p className="font-semibold text-red-700">Allergy: {critical.map((a) => a.substance).join(", ")}</p>}
                    {contact && (
                      <p className="mt-1 text-xs">
                        Call {contact.relationship?.toLowerCase() || contact.name}: <b>{contact.phone}</b>
                      </p>
                    )}
                  </div>
                </div>
                <p className="border-t px-4 py-2 text-center text-[11px] text-slate-500">Scan for emergency information. Every scan is logged.</p>
              </div>
              <div className="no-print mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print card
                </Button>
                <Button variant="outline" onClick={downloadSvg}>
                  <Download className="h-4 w-4" /> Download QR
                </Button>
                <a href={qr.data.url} target="_blank" rel="noreferrer">
                  <Button variant="outline">
                    <Eye className="h-4 w-4" /> Preview what scanning shows
                  </Button>
                </a>
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">
                Issued {fmtDateTime(qr.data.created_at)} · Last scanned {fmtDateTime(qr.data.last_used_at)}
              </p>
            </>
          ) : (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-600">The QR is switched off. Nobody can open the emergency card.</p>
              <Button className="mt-4" onClick={() => act("rotate")} loading={busy === "rotate"}>
                Issue a new QR
              </Button>
            </div>
          )}
        </Card>

        <div className="no-print space-y-6">
          <Card title="What a scan shows">
            <ul className="space-y-1 text-sm text-slate-700">
              <li>• Name, photo, age and blood group</li>
              <li>• Allergies (moderate and above) and critical medicines</li>
              <li>• Key conditions and up to three emergency contacts</li>
              <li>• Your emergency note{p.has_cognitive_condition ? " and a “has memory loss: how to help” banner" : ""}</li>
              <li>• When the information was last updated</li>
            </ul>
            <p className="mt-3 text-sm text-slate-600">
              It does <b>not</b> show your full history, documents, cognitive scores or doctor notes. Those need your PIN or approval.
              You and your caregiver are notified when the card is scanned.
            </p>
          </Card>
          <Card title="If the card is lost or photographed">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => act("rotate")} loading={busy === "rotate"}>
                <RefreshCw className="h-4 w-4" /> Rotate (new QR)
              </Button>
              {qr.data?.active && (
                <Button variant="danger" onClick={() => act("revoke")} loading={busy === "revoke"}>
                  <ShieldOff className="h-4 w-4" /> Switch QR off
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">Rotating makes every old printout useless immediately.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
