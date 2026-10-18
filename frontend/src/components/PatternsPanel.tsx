"use client";

import { TrendingDown } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";
import type { SourceRef } from "@/lib/types";

import { SourceChips } from "./AIBrief";
import { AIDisclaimer } from "./badges";
import { Badge, Button, Card, ErrorText } from "./ui";

interface Report {
  report: {
    patterns: { title: string; detail: string; trend: string; source_ids: string[] }[];
    risk_flags: { title: string; detail: string; level: string; source_ids: string[] }[];
  };
  sources: Record<string, SourceRef>;
  model: string;
}

export function PatternsPanel({ vitalId }: { vitalId: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      setData(await api<Report>("/api/ai/patterns", { json: { vital_id: vitalId } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-violet-600" /> Pattern & risk detection
        </span>
      }
      action={
        <Button size="sm" onClick={run} loading={busy}>
          {data ? "Run again" : "Analyse history"}
        </Button>
      }
    >
      <ErrorText>{error}</ErrorText>
      {!data && !busy && <p className="text-sm text-slate-500">Looks across labs, vitals, visits and cognitive scores for recurring problems and worsening trends.</p>}
      {data && (
        <div className="space-y-4">
          {data.report.risk_flags.map((f, i) => (
            <div key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
              <p className="font-semibold text-red-900">
                {f.title} <Badge tone={f.level === "high" ? "red" : f.level === "medium" ? "amber" : "slate"}>{f.level} risk</Badge>
              </p>
              <p className="text-red-900">
                {f.detail} <SourceChips ids={f.source_ids} sources={data.sources} />
              </p>
            </div>
          ))}
          {data.report.patterns.map((p, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">
                {p.title} <Badge tone={p.trend === "worsening" ? "amber" : p.trend === "improving" ? "green" : "slate"}>{p.trend}</Badge>
              </p>
              <p className="text-slate-700">
                {p.detail} <SourceChips ids={p.source_ids} sources={data.sources} />
              </p>
            </div>
          ))}
          {!data.report.patterns.length && !data.report.risk_flags.length && <p className="text-sm text-slate-500">No patterns supported by at least two records.</p>}
          <AIDisclaimer />
        </div>
      )}
    </Card>
  );
}
