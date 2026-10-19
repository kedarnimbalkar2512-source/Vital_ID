"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { API_URL } from "./api";

/**
 * The API runs on Render's free plan, which sleeps after ~15 idle minutes and takes ~30-60 s to wake.
 * One /api/health ping when the site opens starts the wake-up early; we poll only while it is waking.
 */
export type BackendState = "checking" | "starting" | "slow" | "live";

/** Typical cold start, used only for the progress estimate. */
export const TYPICAL_WAKE_SECONDS = 50;
const POLL_MS = 5000;
const PING_TIMEOUT_MS = 8000;
/** Stop polling after this long and offer a Retry button instead. */
const GIVE_UP_AFTER_S = 120;

interface BackendStatus {
  state: BackendState;
  /** Seconds since we started waiting for the backend (0 when live). */
  elapsed: number;
  /** How long the last wake-up took, once live. */
  wokeAfter: number | null;
  retry: () => void;
  /** Resolves once the backend answers /api/health. */
  waitUntilLive: () => Promise<void>;
}

const BackendContext = createContext<BackendStatus | null>(null);

async function ping(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/health`, { cache: "no-store", signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function BackendStatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BackendState>("checking");
  const [elapsed, setElapsed] = useState(0);
  const [wokeAfter, setWokeAfter] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const run = useRef(0);
  const waiters = useRef<(() => void)[]>([]);
  const stateRef = useRef<BackendState>("checking");

  const set = useCallback((s: BackendState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const wake = useCallback(async () => {
    const id = ++run.current;
    startedAt.current = Date.now();
    setElapsed(0);
    let first = true;
    while (id === run.current) {
      if (await ping()) {
        if (id !== run.current) return;
        // A quick first answer means it was already awake: no "starting" flash.
        setWokeAfter(first ? null : Math.round((Date.now() - startedAt.current) / 1000));
        set("live");
        waiters.current.splice(0).forEach((resolve) => resolve());
        return;
      }
      if (id !== run.current) return;
      first = false;
      if ((Date.now() - startedAt.current) / 1000 > GIVE_UP_AFTER_S) {
        set("slow");
        return;
      }
      set("starting");
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }, [set]);

  // Start waking the backend as soon as the site opens.
  useEffect(() => {
    const runs = run;
    wake();
    return () => {
      runs.current++;
    };
  }, [wake]);

  // Live seconds counter while waiting.
  useEffect(() => {
    if (state === "live" || state === "slow") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [state]);

  const waitUntilLive = useCallback(
    () => (stateRef.current === "live" ? Promise.resolve() : new Promise<void>((resolve) => waiters.current.push(resolve))),
    [],
  );

  const value: BackendStatus = { state, elapsed, wokeAfter, retry: wake, waitUntilLive };
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackendStatus() {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error("useBackendStatus must be used inside BackendStatusProvider");
  return ctx;
}
