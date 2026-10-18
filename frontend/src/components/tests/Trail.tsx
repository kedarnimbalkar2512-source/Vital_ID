"use client";

import { useRef, useState } from "react";

import { Button, cn } from "../ui";
import type { TestProps } from "./types";

interface Point {
  label: string;
  x: number;
  y: number;
}

/** Trail-making (part A style): tap the circles 1 → N in order, as quickly as you can. */
export function Trail({ stimuli, onSubmit, busy }: TestProps<{ points: Point[]; time_allowance_sec: number }>) {
  const [started, setStarted] = useState(false);
  const [clicks, setClicks] = useState<string[]>([]);
  const [next, setNext] = useState(1);
  const [wrong, setWrong] = useState<string | null>(null);
  const t0 = useRef(0);
  const n = stimuli.points.length;
  const finished = next > n;

  function tap(label: string) {
    if (finished) return;
    setClicks((c) => [...c, label]);
    if (label === String(next)) setNext(next + 1);
    else {
      setWrong(label);
      setTimeout(() => setWrong(null), 400);
    }
  }

  if (!started)
    return (
      <div className="space-y-4">
        <p className="text-lg">Tap the numbered circles in order, 1, 2, 3… up to {n}, as quickly and accurately as you can.</p>
        <Button
          size="lg"
          onClick={() => {
            t0.current = Date.now();
            setStarted(true);
          }}
        >
          Start
        </Button>
      </div>
    );

  const visited = stimuli.points.slice(0, next - 1);
  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-square w-full max-w-md select-none rounded-xl border border-slate-200 bg-slate-50">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={visited.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#32998c" strokeWidth="0.8" />
        </svg>
        {stimuli.points.map((p) => {
          const done = Number(p.label) < next;
          return (
            <button
              key={p.label}
              onClick={() => tap(p.label)}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              className={cn(
                "absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-lg font-bold transition",
                done ? "border-brand-600 bg-brand-600 text-white" : "border-slate-400 bg-white text-slate-800 hover:border-brand-500",
                wrong === p.label && "border-red-500 bg-red-100",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {finished && (
        <div className="text-center">
          <Button
            size="lg"
            loading={busy}
            onClick={() => onSubmit({ n, clicks, time_allowance_sec: stimuli.time_allowance_sec }, (Date.now() - t0.current) / 1000)}
          >
            Submit
          </Button>
        </div>
      )}
    </div>
  );
}
