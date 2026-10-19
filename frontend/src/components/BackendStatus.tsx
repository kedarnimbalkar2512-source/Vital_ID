"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { TYPICAL_WAKE_SECONDS, useBackendStatus } from "@/lib/backend";

import { cn } from "./ui";

function Dot({ tone }: { tone: "amber" | "green" | "red" | "slate" }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {tone !== "green" && tone !== "slate" && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", tone === "amber" ? "bg-amber-400" : "bg-red-400")} />
      )}
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          tone === "amber" && "bg-amber-500",
          tone === "green" && "bg-emerald-500",
          tone === "red" && "bg-red-500",
          tone === "slate" && "bg-slate-400",
        )}
      />
    </span>
  );
}

/** Full status panel for the login and register pages. */
export function BackendBanner() {
  const { state, elapsed, wokeAfter, retry } = useBackendStatus();

  if (state === "checking") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <Dot tone="slate" />
        Checking the server…
      </div>
    );
  }

  if (state === "live") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <Dot tone="green" />
        <span>
          <strong>Server is live.</strong> You can log in now
          {wokeAfter ? ` (woke up in ${wokeAfter}s).` : "."}
        </span>
      </div>
    );
  }

  const pct = Math.min(95, Math.round((elapsed / TYPICAL_WAKE_SECONDS) * 100));
  const slow = state === "slow";
  return (
    <div role="status" aria-live="polite" className={cn("space-y-2 rounded-lg border px-3 py-2.5 text-sm", slow ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
      <div className="flex items-center gap-2">
        <Dot tone={slow ? "red" : "amber"} />
        <strong>{slow ? "Server is taking longer than usual" : elapsed < 2 ? "Server is offline, starting it…" : "Server is starting…"}</strong>
        <span className="ml-auto font-mono tabular-nums">{elapsed}s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/70">
        <div className={cn("h-full rounded-full transition-[width] duration-1000", slow ? "bg-red-400" : "bg-amber-500")} style={{ width: `${slow ? 100 : pct}%` }} />
      </div>
      <p className="text-xs">
        {slow ? (
          <>
            No answer after {elapsed} seconds.{" "}
            <button type="button" onClick={retry} className="font-semibold underline">
              Retry
            </button>
          </>
        ) : (
          `The free server sleeps when idle and usually wakes in about ${TYPICAL_WAKE_SECONDS} seconds. You can type your details meanwhile.`
        )}
      </p>
    </div>
  );
}

/** Small floating indicator on every other page; hidden when the server is already awake. */
export function BackendPill() {
  const { state, elapsed, wokeAfter } = useBackendStatus();
  const pathname = usePathname();
  const [showLive, setShowLive] = useState(false);

  // Briefly confirm "live" after a wake-up, then get out of the way.
  useEffect(() => {
    if (state !== "live" || !wokeAfter) return;
    setShowLive(true);
    const t = setTimeout(() => setShowLive(false), 4000);
    return () => clearTimeout(t);
  }, [state, wokeAfter]);

  if (pathname === "/login" || pathname === "/register") return null;
  if (state === "checking" || (state === "live" && !showLive)) return null;

  const tone = state === "live" ? "green" : state === "slow" ? "red" : "amber";
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-lg"
    >
      <Dot tone={tone} />
      {state === "live" ? (
        "Server is live"
      ) : (
        <>
          {state === "slow" ? "Server is slow to wake" : "Server is starting"}
          <span className="font-mono tabular-nums text-slate-500">{elapsed}s</span>
        </>
      )}
    </div>
  );
}
