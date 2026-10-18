import { Badge } from "./ui";
import type { Source } from "@/lib/types";

export function SourceBadge({ source, verified }: { source: Source | string | null; verified?: boolean | null }) {
  if (source === "doctor-entered") return <Badge tone="green">Doctor-entered</Badge>;
  if (source === "ai-extracted")
    return verified ? <Badge tone="violet">AI-extracted · confirmed</Badge> : <Badge tone="amber">AI-extracted (unverified)</Badge>;
  return (
    <Badge tone="blue">
      Patient-reported{verified ? " · verified" : ""}
    </Badge>
  );
}

export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return <Badge tone="amber">Synthetic demo record</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severity === "life-threatening" || severity === "contraindicated" ? "red" : severity === "severe" || severity === "major" ? "red" : severity === "moderate" ? "amber" : "slate";
  return <Badge tone={tone}>{severity}</Badge>;
}

export function AIDisclaimer({ text = "AI suggestion — verify clinically. Not a diagnosis or prescription." }: { text?: string }) {
  return <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-800">{text}</p>;
}

export function ScreeningDisclaimer() {
  return (
    <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">
      Cognitive scores are screening signals compared with this person&apos;s own baseline. They are not a diagnosis; a drop means
      &ldquo;consult a doctor&rdquo;.
    </p>
  );
}
