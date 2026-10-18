"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Input } from "../ui";
import type { TestProps } from "./types";

type Phase = "intro" | "study" | "delay" | "recall";

export function WordRecall({ stimuli, onSubmit, busy }: TestProps<{ words: string[]; study_seconds: number; delay_seconds: number }>) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [left, setLeft] = useState(0);
  const [entries, setEntries] = useState<string[]>(["", "", "", "", ""]);
  const [sum, setSum] = useState("");
  const started = useRef(0);
  const delayStart = useRef(0);

  useEffect(() => {
    if (phase !== "study" && phase !== "delay") return;
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (left > 0) return;
    if (phase === "study") {
      setPhase("delay");
      setLeft(stimuli.delay_seconds);
      delayStart.current = Date.now();
    } else if (phase === "delay") setPhase("recall");
  }, [left, phase, stimuli.delay_seconds]);

  if (phase === "intro")
    return (
      <div className="space-y-4">
        <p className="text-lg">You will see 5 words. Read them aloud and try to remember them. After a short break we will ask you to recall them.</p>
        <Button
          size="lg"
          onClick={() => {
            started.current = Date.now();
            setPhase("study");
            setLeft(stimuli.study_seconds);
          }}
        >
          Show the words
        </Button>
      </div>
    );

  if (phase === "study")
    return (
      <div className="space-y-6 text-center">
        <div className="flex flex-wrap justify-center gap-3">
          {stimuli.words.map((w) => (
            <span key={w} className="rounded-xl bg-brand-50 px-5 py-4 text-3xl font-semibold capitalize text-brand-800">
              {w}
            </span>
          ))}
        </div>
        <p className="text-slate-500">Remember these words · {left}s</p>
      </div>
    );

  if (phase === "delay")
    return (
      <div className="space-y-4 text-center">
        <p className="text-lg">Short break. While you wait, count backwards from 100 in sevens (100, 93, 86…).</p>
        <Input className="mx-auto max-w-xs text-center text-lg" placeholder="type as you count (optional)" value={sum} onChange={(e) => setSum(e.target.value)} />
        <p className="text-4xl font-semibold text-slate-700">{left}s</p>
        <button className="text-xs text-slate-400 underline" onClick={() => setLeft(0)}>
          Continue early (shorter delay is recorded with the result)
        </button>
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-lg">Type the words you remember, in any order.</p>
      <div className="grid gap-2 sm:grid-cols-5">
        {entries.map((v, i) => (
          <Input key={i} className="text-lg" autoFocus={i === 0} value={v} onChange={(e) => setEntries(entries.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
      </div>
      <Button
        size="lg"
        loading={busy}
        onClick={() =>
          onSubmit(
            { words: stimuli.words, recalled: entries.filter((x) => x.trim()), delay_sec: Math.round((Date.now() - delayStart.current) / 1000) },
            (Date.now() - started.current) / 1000,
          )
        }
      >
        Submit
      </Button>
    </div>
  );
}
