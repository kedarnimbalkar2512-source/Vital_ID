"use client";

import { useCallback, useEffect, useState } from "react";

import { api, withPatient } from "./api";
import type { FullRecord } from "./types";

export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** The signed-in patient's record, or a linked patient's when a caregiver passes their id. */
export function usePatientRecord(patientId: string | null, enabled = true) {
  return useFetch<FullRecord>(enabled ? withPatient("/api/patients/me", patientId) : null);
}
