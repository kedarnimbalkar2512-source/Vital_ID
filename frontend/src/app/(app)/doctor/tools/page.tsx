"use client";

import { NotebookPen } from "lucide-react";
import { useState } from "react";

import { AIDisclaimer } from "@/components/badges";
import { PatternsPanel } from "@/components/PatternsPanel";
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";

interface Analysis {
  symptoms: string[];
  possible_conditions: { name: string; likelihood: string; rationale: string }[];
  suggested_next_steps: string[];
  red_flags: string[];
  severity: "low" | "moderate" | "high" | "critical";
  disclaimer: string;
}

export default function DoctorTools() {
  useRequireRole("doctor");
  const [text, setText] = useState("");
  const [vid, setVid] = useState("");
  const [patVid, setPatVid] = useState<string | null>(null);
  const [res, setRes] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyse(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRes(await api<Analysis>("/api/ai/analyze-notes", { json: { text, vital_id: vid || null } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sevTone = res?.severity === "critical" || res?.severity === "high" ? "red" : res?.severity === "moderate" ? "amber" : "green";
  return (
    <div className="space-y-6">
      <PageHeader title="AI tools" subtitle="Suggestions to consider, never a diagnosis. Don't paste names or contact details." />
      <Card title={<span className="flex items-center gap-2"><NotebookPen className="h-4 w-4 text-violet-600" /> Clinical notes analyser</span>}>
        <form onSubmit={analyse} className="space-y-3">
          <Textarea
            required
            minLength={10}
            className="min-h-[140px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="72M, brought by daughter. 3 days increasing confusion, poor appetite, burning micturition. On warfarin, donepezil. T 38.2, HR 102, BP 104/66…"
          />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Save to patient (optional VitalID)">
              <Input value={vid} onChange={(e) => setVid(e.target.value.toUpperCase())} placeholder="VID-XXXXXX" />
            </Field>
            <Button type="submit" loading={busy}>
              Analyse note
            </Button>
          </div>
        </form>
        <ErrorText>{error}</ErrorText>
        {res && (
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              Severity: <Badge tone={sevTone}>{res.severity}</Badge>
            </p>
            {res.red_flags.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
                <p className="font-semibold">Red flags</p>
                <ul>{res.red_flags.map((f) => <li key={f}>• {f}</li>)}</ul>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Symptoms</p>
                <ul className="mt-1 text-sm">{res.symptoms.map((s) => <li key={s}>• {s}</li>)}</ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Possible conditions to consider</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {res.possible_conditions.map((c) => (
                    <li key={c.name}>
                      • <b>{c.name}</b> <Badge tone={c.likelihood === "high" ? "amber" : "slate"}>{c.likelihood}</Badge>
                      <p className="text-xs text-slate-600">{c.rationale}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Suggested next steps</p>
                <ul className="mt-1 text-sm">{res.suggested_next_steps.map((s) => <li key={s}>• {s}</li>)}</ul>
              </div>
            </div>
            <AIDisclaimer text={res.disclaimer} />
          </div>
        )}
      </Card>
      <Card title="Pattern detector">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPatVid(vid.trim().toUpperCase() || null);
          }}
        >
          <Field label="VitalID (you need active access)">
            <Input value={vid} onChange={(e) => setVid(e.target.value.toUpperCase())} placeholder="VID-XXXXXX" />
          </Field>
          <Button type="submit" variant="outline">
            Load
          </Button>
        </form>
        {patVid && (
          <div className="mt-4">
            <PatternsPanel key={patVid} vitalId={patVid} />
          </div>
        )}
      </Card>
      <AIDisclaimer />
    </div>
  );
}
