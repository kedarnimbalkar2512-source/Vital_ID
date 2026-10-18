"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import type { Extraction } from "@/lib/types";

import { AIDisclaimer } from "./badges";
import { Button, ErrorText, Input } from "./ui";

type Item = Record<string, unknown>;

/** Every AI-extracted field is editable and must be ticked before it is saved to the record. */
export function ExtractionReview({ documentId, extraction, onDone }: { documentId: string; extraction: Extraction; onDone: () => void }) {
  const init = (xs: object[] = []): Item[] => xs.map((x) => ({ ...x, _keep: true }));
  const [meds, setMeds] = useState<Item[]>(init(extraction.medications));
  const [conds, setConds] = useState<Item[]>(init(extraction.conditions));
  const [alls, setAlls] = useState<Item[]>(init(extraction.allergies));
  const [labs, setLabs] = useState<Item[]>(init(extraction.lab_results));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function section(title: string, rows: Item[], set: (r: Item[]) => void, keys: string[]) {
    if (!rows.length) return null;
    return (
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="checkbox" checked={!!r._keep} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, _keep: e.target.checked } : x)))} />
              {keys.map((k) => (
                <Input key={k} placeholder={k} value={String(r[k] ?? "")} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const strip = (rows: Item[]) =>
    rows
      .filter((r) => r._keep)
      .map((r) => {
        const copy = { ...r };
        delete copy._keep;
        return copy;
      });

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/ai/documents/${documentId}/confirm`, {
        json: { medications: strip(meds), conditions: strip(conds), allergies: strip(alls), lab_results: strip(labs) },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const empty = !meds.length && !conds.length && !alls.length && !labs.length;
  return (
    <div className="mt-3 space-y-4 rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <AIDisclaimer text="AI-extracted and unverified. Check every field against the document, correct anything wrong, and untick what shouldn't be saved." />
      {extraction.summary && <p className="text-sm text-slate-700">{extraction.summary}</p>}
      {empty && <p className="text-sm text-slate-600">Nothing structured was found in this document.</p>}
      {section("Medicines", meds, setMeds, ["name", "dose", "frequency"])}
      {section("Conditions", conds, setConds, ["name"])}
      {section("Allergies", alls, setAlls, ["substance", "reaction"])}
      {section("Lab results", labs, setLabs, ["test", "value", "unit", "reference_range"])}
      <ErrorText>{error}</ErrorText>
      {!empty && (
        <Button onClick={confirm} loading={busy}>
          Save ticked items to the record
        </Button>
      )}
    </div>
  );
}
