"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Cited, SourceRef } from "@/lib/types";

import { AIDisclaimer } from "./badges";
import { Button, Card, ErrorText } from "./ui";

interface Brief {
  brief: {
    one_line: string;
    key_conditions: Cited[];
    active_medications: Cited[];
    allergies: Cited[];
    red_flags: Cited[];
    recent_changes: Cited[];
    cognitive_status: Cited | null;
  };
  sources: Record<string, SourceRef>;
  model: string;
  generated_at: string;
  cached: boolean;
}

export function SourceChips({ ids, sources }: { ids: string[]; sources: Record<string, SourceRef> }) {
  if (!ids?.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => {
        const s = sources[id];
        if (!s) return null;
        const unverified = s.source === "ai-extracted" && !s.verified;
        return (
          <span
            key={id}
            title={`${s.table.replace(/_/g, " ")} · ${s.source || ""}${s.verified ? " · verified" : ""}`}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${unverified ? "bg-amber-100 text-amber-800" : s.source === "patient-reported" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}
          >
            {s.label.length > 28 ? s.label.slice(0, 27) + "…" : s.label}
          </span>
        );
      })}
    </span>
  );
}

function Section({ title, items, sources, tone }: { title: string; items: Cited[]; sources: Record<string, SourceRef>; tone?: "red" }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone === "red" ? "text-red-700" : "text-slate-500"}`}>{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((c, i) => (
          <li key={i} className={`text-sm ${tone === "red" ? "font-medium text-red-800" : "text-slate-800"}`}>
            • {c.text}
            <SourceChips ids={c.source_ids} sources={sources} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AIBrief({ vitalId }: { vitalId: string }) {
  const [data, setData] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true);
      setError(null);
      try {
        setData(await api<Brief>("/api/ai/doctor-brief", { json: { vital_id: vitalId, refresh } }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [vitalId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <Card
      className="border-violet-200"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" /> 30-second AI brief
        </span>
      }
      action={
        <Button size="sm" variant="ghost" onClick={() => load(true)} loading={busy}>
          <RefreshCw className="h-4 w-4" /> Regenerate
        </Button>
      }
    >
      {busy && !data && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${90 - i * 12}%` }} />
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {data && (
        <div className="space-y-4">
          <p className="text-base font-medium text-slate-900">{data.brief.one_line}</p>
          <Section title="Red flags" items={data.brief.red_flags} sources={data.sources} tone="red" />
          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Key conditions" items={data.brief.key_conditions} sources={data.sources} />
            <Section title="Active medicines" items={data.brief.active_medications} sources={data.sources} />
            <Section title="Allergies" items={data.brief.allergies} sources={data.sources} />
            <Section title="Recent changes" items={data.brief.recent_changes} sources={data.sources} />
          </div>
          {data.brief.cognitive_status && <Section title="Cognitive screening" items={[data.brief.cognitive_status]} sources={data.sources} />}
          <AIDisclaimer />
          <p className="text-[11px] text-slate-400">
            {data.model} · generated {timeAgo(data.generated_at)}
            {data.cached ? " (cached; the record hasn't changed since)" : ""}. Grey tags show which records each line is based on.
          </p>
        </div>
      )}
    </Card>
  );
}
