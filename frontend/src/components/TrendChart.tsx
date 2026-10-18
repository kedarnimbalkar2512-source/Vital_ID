"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { TEST_LABELS } from "@/lib/format";

export interface TrendPoint {
  taken_at: string;
  pct: number;
}

export interface Trend {
  series: Record<string, (TrendPoint & { id: string; score: number; max_score: number })[]>;
  summary: Record<string, { label: string; tests: number; baseline_pct: number; recent_pct: number; baseline_ready: boolean; last_taken: string }>;
  composite: { week: string; pct: number; n: number }[];
  alerts: import("@/lib/types").CognitiveAlert[];
  rules: { baseline_tests: number; recent_tests: number; drop_threshold_pct: number; trend_min_tests: number; trend_min_drop_pct: number };
  disclaimer: string;
}

// colour-blind-safe palette (Okabe-Ito)
const COLORS: Record<string, string> = {
  word_recall: "#0072B2",
  orientation: "#D55E00",
  digit_span: "#009E73",
  trail: "#CC79A7",
  clock: "#E69F00",
};

/** One line per test type, as % of max score, with each type's baseline drawn faintly. */
export function TrendChart({ trend, height = 300, types }: { trend: Trend; height?: number; types?: string[] }) {
  const keys = (types || Object.keys(trend.series)).filter((k) => trend.series[k]?.length);
  const byDay = new Map<string, Record<string, number | string>>();
  for (const k of keys) {
    for (const p of trend.series[k]) {
      const day = p.taken_at.slice(0, 10);
      const row = byDay.get(day) || { day };
      row[k] = p.pct;
      byDay.set(day, row);
    }
  }
  const data = Array.from(byDay.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">No check-ins yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          tick={{ fontSize: 11, fill: "#64748b" }}
          minTickGap={24}
        />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "#64748b" }} />
        <Tooltip
          labelFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          formatter={(v: number, k: string) => [`${Math.round(v)}%`, TEST_LABELS[k] || k]}
        />
        <Legend formatter={(k: string) => TEST_LABELS[k] || k} wrapperStyle={{ fontSize: 12 }} />
        {keys.length === 1 && trend.summary[keys[0]]?.baseline_ready && (
          <ReferenceLine y={trend.summary[keys[0]].baseline_pct} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "baseline", fontSize: 11, fill: "#64748b", position: "insideTopRight" }} />
        )}
        {keys.map((k) => (
          <Line key={k} type="monotone" dataKey={k} stroke={COLORS[k] || "#334155"} strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
