"use client";

import Link from "next/link";

import { AlertCard } from "@/components/AlertCard";
import { ScreeningDisclaimer } from "@/components/badges";
import { Empty, PageHeader, Spinner } from "@/components/ui";
import { useRequireRole } from "@/lib/auth";
import { useFetch } from "@/lib/hooks";
import type { CognitiveAlert } from "@/lib/types";

export default function AlertsPage() {
  const { me, ready } = useRequireRole();
  const alerts = useFetch<CognitiveAlert[]>(ready ? "/api/cognitive/alerts" : null);
  return (
    <div className="space-y-4">
      <PageHeader title="Cognitive alerts" subtitle="Open screening signals for the patients you can see." />
      <ScreeningDisclaimer />
      {!alerts.data ? (
        <Spinner />
      ) : alerts.data.length === 0 ? (
        <Empty>No open alerts.</Empty>
      ) : (
        alerts.data.map((a) => (
          <div key={a.id}>
            <AlertCard alert={a} onChange={alerts.reload} showPatient />
            <Link
              href={me?.role === "doctor" ? `/doctor/patient/${a.vital_id}` : `/patient/cognitive?patient=${a.patient_id}`}
              className="ml-1 mt-1 inline-block text-sm font-medium text-brand-700 hover:underline"
            >
              Open trend →
            </Link>
          </div>
        ))
      )}
    </div>
  );
}
