"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";
import type { DrugWarning } from "@/lib/types";

import { AIDisclaimer, SeverityBadge } from "./badges";
import { Button, ErrorText, Field, Input } from "./ui";

interface CheckResult {
  rule_warnings: DrugWarning[];
  ai: { warnings: { severity: string; involves: string[]; explanation: string }[]; summary: string } | null;
  ai_error: string | null;
  disclaimer: string;
}

/** Doctor adds a medicine: conflict check first (rules + AI), then save with warnings acknowledged. */
export function AddMedication({ vitalId, onAdded }: { vitalId: string; onAdded: () => void }) {
  const [form, setForm] = useState({ name: "", dose: "", frequency: "", is_critical: false });
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    setBusy("check");
    setError(null);
    try {
      setCheck(await api<CheckResult>("/api/ai/drug-check", { json: { drug_name: form.name, vital_id: vitalId } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const ack = [...(check?.rule_warnings || []).map((w) => w.description), ...(check?.ai?.warnings || []).map((w) => w.explanation)];
      await api(`/api/patients/${vitalId}/medications`, { json: { ...form, warnings_acknowledged: ack } });
      setForm({ name: "", dose: "", frequency: "", is_critical: false });
      setCheck(null);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const serious = check?.rule_warnings.some((w) => w.severity === "major" || w.severity === "contraindicated") || check?.ai?.warnings.some((w) => w.severity === "major" || w.severity === "contraindicated");
  const any = (check?.rule_warnings.length || 0) + (check?.ai?.warnings.length || 0) > 0;

  return (
    <div className="space-y-3">
      <form onSubmit={runCheck} className="grid gap-3 sm:grid-cols-4">
        <Field label="Medicine">
          <Input required value={form.name} onChange={(e) => (setForm({ ...form, name: e.target.value }), setCheck(null))} placeholder="e.g. Ibuprofen" />
        </Field>
        <Field label="Dose">
          <Input value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} placeholder="400 mg" />
        </Field>
        <Field label="Frequency">
          <Input value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} placeholder="TDS after food" />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="outline" className="w-full" loading={busy === "check"}>
            Check conflicts
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-4">
          <input type="checkbox" checked={form.is_critical} onChange={(e) => setForm({ ...form, is_critical: e.target.checked })} />
          Critical medicine (show on the emergency card)
        </label>
      </form>
      <ErrorText>{error}</ErrorText>
      {check && (
        <div className={`space-y-3 rounded-lg border p-4 ${serious ? "border-red-300 bg-red-50" : any ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}>
          {!any && (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <ShieldCheck className="h-4 w-4" /> No known conflicts with current medicines or allergies.
            </p>
          )}
          {check.rule_warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${w.severity === "moderate" ? "text-amber-600" : "text-red-600"}`} />
              <div>
                <p className="font-semibold">
                  {w.involves.join(" + ")} <SeverityBadge severity={w.severity} /> <span className="text-xs font-normal text-slate-500">rule base · {w.type}</span>
                </p>
                <p>{w.description}</p>
                {w.reference && <p className="text-xs text-slate-500">Source: {w.reference}</p>}
              </div>
            </div>
          ))}
          {check.ai?.warnings.map((w, i) => (
            <div key={"ai" + i} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <div>
                <p className="font-semibold">
                  {w.involves.join(" + ")} <SeverityBadge severity={w.severity} /> <span className="text-xs font-normal text-violet-700">AI second check</span>
                </p>
                <p>{w.explanation}</p>
              </div>
            </div>
          ))}
          {check.ai?.summary && <p className="text-sm text-slate-700">AI: {check.ai.summary}</p>}
          {check.ai_error && <p className="text-xs text-slate-500">AI second check unavailable: rule-based results only.</p>}
          <AIDisclaimer text={check.disclaimer} />
          <div className="flex gap-2">
            <Button variant={serious ? "danger" : "primary"} onClick={save} loading={busy === "save"}>
              {any ? "Acknowledge warnings and add" : "Add medicine"}
            </Button>
            <Button variant="ghost" onClick={() => setCheck(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
