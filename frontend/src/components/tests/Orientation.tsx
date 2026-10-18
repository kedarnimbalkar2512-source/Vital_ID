"use client";

import { useRef, useState } from "react";

import { Button, Field, Input } from "../ui";
import type { TestProps } from "./types";

export function Orientation({ stimuli, onSubmit, busy }: TestProps<{ questions: { key: string; prompt: string }[] }>) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const started = useRef(Date.now());
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ answers }, (Date.now() - started.current) / 1000);
      }}
    >
      <p className="text-lg">Answer without looking at a phone, clock or calendar.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {stimuli.questions.map((q) => (
          <Field key={q.key} label={q.prompt}>
            <Input className="text-lg" value={answers[q.key] || ""} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Button size="lg" type="submit" loading={busy}>
        Submit
      </Button>
    </form>
  );
}
