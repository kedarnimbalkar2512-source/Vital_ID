"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Input } from "../ui";
import type { TestProps } from "./types";

interface Trial {
  length: number;
  sequence: string;
}

/** Forward digit span: two sequences per length; stops after both sequences of a length are missed. */
export function DigitSpan({ stimuli, onSubmit, busy }: TestProps<{ trials: Trial[]; show_ms_per_digit: number }>) {
  const [idx, setIdx] = useState(-1);
  const [showing, setShowing] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [results, setResults] = useState<{ sequence: string; response: string }[]>([]);
  const [done, setDone] = useState(false);
  const started = useRef(0);

  useEffect(() => {
    if (idx < 0 || idx >= stimuli.trials.length) return;
    const seq = stimuli.trials[idx].sequence;
    let i = 0;
    setShowing("");
    const t = setInterval(() => {
      if (i < seq.length) setShowing(seq[i++]);
      else {
        clearInterval(t);
        setShowing(null);
      }
    }, stimuli.show_ms_per_digit);
    return () => clearInterval(t);
  }, [idx, stimuli]);

  function next() {
    const trial = stimuli.trials[idx];
    const res = [...results, { sequence: trial.sequence, response: answer }];
    setResults(res);
    setAnswer("");
    const sameLength = res.filter((r) => r.sequence.length === trial.length);
    const lengthDone = sameLength.length === 2;
    const bothWrong = lengthDone && sameLength.every((r) => r.sequence !== r.response.replace(/\D/g, ""));
    if (bothWrong || idx + 1 >= stimuli.trials.length) setDone(true);
    else setIdx(idx + 1);
  }

  if (idx < 0)
    return (
      <div className="space-y-4">
        <p className="text-lg">Numbers will appear one at a time. When they stop, type them in the same order. The sequences get longer.</p>
        <Button
          size="lg"
          onClick={() => {
            started.current = Date.now();
            setIdx(0);
          }}
        >
          Start
        </Button>
      </div>
    );

  if (done)
    return (
      <div className="space-y-4">
        <p className="text-lg">Well done. Submit your answers.</p>
        <Button size="lg" loading={busy} onClick={() => onSubmit({ trials: results }, (Date.now() - started.current) / 1000)}>
          Submit
        </Button>
      </div>
    );

  return (
    <div className="space-y-6 text-center">
      <p className="text-sm text-slate-500">
        Sequence {idx + 1} · {stimuli.trials[idx].length} digits
      </p>
      {showing !== null ? (
        <p className="h-24 text-7xl font-bold text-brand-700">{showing}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          className="mx-auto flex max-w-sm gap-2"
        >
          <Input autoFocus inputMode="numeric" className="text-center text-2xl tracking-widest" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <Button type="submit">Next</Button>
        </form>
      )}
    </div>
  );
}
