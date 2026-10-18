"use client";

import { Brain, CheckCircle2, Grid3x3, Hash, MapPin } from "lucide-react";
import { useState } from "react";

import { usePatientParam } from "@/components/AppShell";
import { AlertCard } from "@/components/AlertCard";
import { ScreeningDisclaimer } from "@/components/badges";
import { DigitSpan } from "@/components/tests/DigitSpan";
import { Orientation } from "@/components/tests/Orientation";
import { Trail } from "@/components/tests/Trail";
import { WordRecall } from "@/components/tests/WordRecall";
import { TrendChart, type Trend } from "@/components/TrendChart";
import { Button, Card, cn, ErrorText, PageHeader, Spinner } from "@/components/ui";
import { api, withPatient } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { fmtDate, TEST_LABELS } from "@/lib/format";
import { useFetch, usePatientRecord } from "@/lib/hooks";

const TESTS = [
  { id: "word_recall", icon: Brain, blurb: "Remember 5 words, recall them after a short break.", minutes: 2 },
  { id: "orientation", icon: MapPin, blurb: "Today's date, day and where you are.", minutes: 1 },
  { id: "digit_span", icon: Hash, blurb: "Repeat number sequences that get longer.", minutes: 2 },
  { id: "trail", icon: Grid3x3, blurb: "Tap numbered circles in order, quickly.", minutes: 1 },
] as const;

type TestId = (typeof TESTS)[number]["id"];

interface Result {
  score: number;
  max_score: number;
  alert_created: boolean;
}

export default function CognitivePage() {
  const { ready } = useRequireRole("patient", "caregiver");
  const patientParam = usePatientParam();
  const { data: rec } = usePatientRecord(patientParam, ready);
  const pid = rec?.patient.id;
  const trend = useFetch<Trend>(pid ? `/api/cognitive/trend/${pid}` : null);
  const [active, setActive] = useState<TestId | null>(null);
  const [stimuli, setStimuli] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(Result & { test: TestId }) | null>(null);
  const [view, setView] = useState<string>("all");

  async function start(id: TestId) {
    setError(null);
    setResult(null);
    setStimuli(null);
    setActive(id);
    try {
      setStimuli(await api(withPatient(`/api/cognitive/stimuli/${id}`, patientParam)));
    } catch (e) {
      setError((e as Error).message);
      setActive(null);
    }
  }

  async function submit(raw: Record<string, unknown>, duration: number) {
    if (!active) return;
    setBusy(true);
    try {
      const r = await api<Result>("/api/cognitive/tests", {
        json: { test_type: active, raw, duration_sec: Math.round(duration * 10) / 10, patient_id: patientParam },
      });
      setResult({ ...r, test: active });
      setActive(null);
      trend.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!rec) return <Spinner />;
  const props = { stimuli: stimuli as never, busy, onSubmit: submit };

  return (
    <div className="space-y-6">
      <PageHeader title="Cognitive check-in" subtitle="A few minutes, once a week. Scores are compared with your own earlier results." />
      <ErrorText>{error}</ErrorText>

      {active ? (
        <Card title={TEST_LABELS[active]} action={<Button variant="ghost" size="sm" onClick={() => setActive(null)}>Cancel</Button>}>
          <div className="py-4 text-slate-800">
            {!stimuli ? (
              <Spinner />
            ) : active === "word_recall" ? (
              <WordRecall {...props} />
            ) : active === "digit_span" ? (
              <DigitSpan {...props} />
            ) : active === "orientation" ? (
              <Orientation {...props} />
            ) : (
              <Trail {...props} />
            )}
          </div>
        </Card>
      ) : (
        <>
          {result && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold text-emerald-900">
                  {TEST_LABELS[result.test]}: {result.score} / {result.max_score}
                </p>
                <p className="text-sm text-emerald-800">
                  Saved. {result.alert_created ? "This result triggered a screening signal; the doctor and caregiver have been notified." : "Thank you for checking in."}
                </p>
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TESTS.map((t) => {
              const s = trend.data?.summary[t.id];
              return (
                <button key={t.id} onClick={() => start(t.id)} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-400 hover:shadow">
                  <t.icon className="h-6 w-6 text-brand-600" />
                  <p className="mt-3 font-semibold">{TEST_LABELS[t.id]}</p>
                  <p className="mt-1 text-sm text-slate-600">{t.blurb}</p>
                  <p className="mt-3 text-xs text-slate-500">~{t.minutes} min{s ? ` · last ${fmtDate(s.last_taken)}` : " · not taken yet"}</p>
                </button>
              );
            })}
          </div>
        </>
      )}

      {trend.data?.alerts
        .filter((a) => a.status === "open")
        .map((a) => (
          <AlertCard key={a.id} alert={a} onChange={trend.reload} />
        ))}

      <Card
        title="Trend"
        action={
          <div className="flex flex-wrap gap-1">
            {["all", ...Object.keys(trend.data?.series || {})].map((k) => (
              <button key={k} onClick={() => setView(k)} className={cn("rounded-md px-2 py-1 text-xs", view === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}>
                {k === "all" ? "All" : TEST_LABELS[k]}
              </button>
            ))}
          </div>
        }
      >
        {trend.data ? <TrendChart trend={trend.data} types={view === "all" ? undefined : [view]} /> : <Spinner />}
        {trend.data && (
          <p className="mt-3 text-xs text-slate-500">
            How alerts work: baseline = average of the first {trend.data.rules.baseline_tests} tests of each type. A signal is raised if the average of the
            last {trend.data.rules.recent_tests} is at least {trend.data.rules.drop_threshold_pct}% lower, or if the last {trend.data.rules.trend_min_tests}+
            tests fall every time by at least {trend.data.rules.trend_min_drop_pct}% overall.
          </p>
        )}
        <div className="mt-3">
          <ScreeningDisclaimer />
        </div>
      </Card>
    </div>
  );
}
