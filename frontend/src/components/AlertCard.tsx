"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";
import { fmtDate, TEST_LABELS } from "@/lib/format";
import type { CognitiveAlert } from "@/lib/types";

import { Button } from "./ui";

export function AlertCard({ alert, onChange, showPatient }: { alert: CognitiveAlert; onChange?: () => void; showPatient?: boolean }) {
  const [busy, setBusy] = useState(false);
  const label = TEST_LABELS[alert.test_type] || alert.test_type;
  const rule =
    alert.rule === "baseline_drop"
      ? `Average of the last tests is ${Math.round(alert.drop_pct)}% below the first tests (baseline).`
      : `Scores have gone down on each of the most recent tests (${Math.round(alert.drop_pct)}% overall).`;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-900">
            Screening signal: {label}
            {showPatient && alert.full_name && (
              <span className="font-normal text-amber-800">
                {" "}
                · {alert.full_name} ({alert.vital_id})
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-amber-900">
            {Math.round(alert.baseline_score)}% → {Math.round(alert.recent_score)}%. {rule}
          </p>
          {alert.ai_summary && (
            <p className="mt-2 rounded-md bg-white/70 p-2 text-sm text-slate-700">
              <span className="mr-1 text-xs font-semibold uppercase text-violet-700">AI note</span>
              {alert.ai_summary}
            </p>
          )}
          <p className="mt-2 text-xs text-amber-800">Raised {fmtDate(alert.created_at)} · Not a diagnosis. Please consult a doctor.</p>
        </div>
        {alert.status === "open" && onChange && (
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await api(`/api/cognitive/alerts/${alert.id}/acknowledge`, { method: "POST" });
              setBusy(false);
              onChange();
            }}
          >
            Acknowledge
          </Button>
        )}
      </div>
    </div>
  );
}
