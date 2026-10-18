"use client";

import { FileText, ScanText, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { usePatientParam } from "@/components/AppShell";
import { ExtractionReview } from "@/components/ExtractionReview";
import { Badge, Button, Card, Empty, ErrorText, Field, PageHeader, Select, Spinner } from "@/components/ui";
import { api, upload } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { usePatientRecord } from "@/lib/hooks";
import type { DocumentMeta } from "@/lib/types";

const STATUS: Record<string, { label: string; tone: "slate" | "amber" | "green" | "red" | "violet" }> = {
  none: { label: "Not scanned", tone: "slate" },
  processing: { label: "Scanning…", tone: "violet" },
  needs_review: { label: "Needs review", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  failed: { label: "Scan failed", tone: "red" },
};

export default function DocumentsPage() {
  const { ready } = useRequireRole("patient", "caregiver");
  const patientParam = usePatientParam();
  const { data: rec, reload } = usePatientRecord(patientParam, ready);
  const [docType, setDocType] = useState("prescription");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setBusy("upload");
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("doc_type", docType);
    if (patientParam) form.append("patient_id", patientParam);
    try {
      await upload("/api/records/documents", form);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function scan(d: DocumentMeta) {
    setBusy(d.id);
    setError(null);
    try {
      await api("/api/ai/extract-document", { json: { document_id: d.id } });
      setOpen(d.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      reload();
    }
  }

  async function view(d: DocumentMeta) {
    try {
      const { url } = await api<{ url: string }>(`/api/records/documents/${d.id}/url`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(d: DocumentMeta) {
    if (!window.confirm(`Delete ${d.filename}?`)) return;
    await api(`/api/records/documents/${d.id}`, { method: "DELETE" });
    reload();
  }

  if (!rec) return <Spinner />;
  return (
    <div className="space-y-6">
      <PageHeader title="Documents" subtitle="Prescriptions and lab reports, stored privately. Scan one to fill the record automatically, then check it." />
      <Card title="Upload">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Type">
            <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="prescription">Prescription</option>
              <option value="lab_report">Lab report</option>
              <option value="discharge_summary">Discharge summary</option>
              <option value="imaging">Imaging</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()} loading={busy === "upload"}>
            <Upload className="h-4 w-4" /> Choose file (PDF or image, max 10 MB)
          </Button>
        </div>
        <ErrorText>{error}</ErrorText>
      </Card>
      <Card title="Your documents">
        {rec.documents.length === 0 ? (
          <Empty>No documents yet.</Empty>
        ) : (
          <ul className="divide-y">
            {rec.documents.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <FileText className="h-5 w-5 text-slate-400" />
                  <button className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" onClick={() => view(d)}>
                    {d.filename}
                  </button>
                  <span className="text-xs text-slate-500">
                    {d.doc_type.replace("_", " ")} · {fmtDate(d.created_at)}
                  </span>
                  <Badge tone={STATUS[d.extraction_status].tone}>{STATUS[d.extraction_status].label}</Badge>
                  {d.extraction_status === "needs_review" ? (
                    <Button size="sm" variant="outline" onClick={() => setOpen(open === d.id ? null : d.id)}>
                      Review
                    </Button>
                  ) : d.extraction_status !== "confirmed" ? (
                    <Button size="sm" variant="outline" loading={busy === d.id} onClick={() => scan(d)}>
                      <ScanText className="h-4 w-4" /> Scan with AI
                    </Button>
                  ) : null}
                  <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(d)} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {open === d.id && d.extracted_json && d.extraction_status === "needs_review" && (
                  <ExtractionReview
                    documentId={d.id}
                    extraction={d.extracted_json}
                    onDone={() => {
                      setOpen(null);
                      reload();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
