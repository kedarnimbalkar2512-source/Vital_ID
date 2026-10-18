"use client";

import { Activity, Brain, FileLock2, QrCode, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/Logo";
import { homeFor, useAuth } from "@/lib/auth";

const features = [
  {
    icon: Brain,
    title: "Cognitive tracking",
    body: "Short in-app memory and attention check-ins, compared with the patient's own baseline. A sustained drop alerts the doctor and family as a screening signal.",
  },
  {
    icon: QrCode,
    title: "Emergency & wandering QR",
    body: "A wallet card or sticker. Whoever finds the patient sees only what's needed to help: allergies, critical medicines, and who to call.",
  },
  {
    icon: Stethoscope,
    title: "30-second AI brief",
    body: "When a doctor opens the record, AI summarises conditions, medicines, allergies and red flags, each linked back to the source record.",
  },
  {
    icon: ShieldCheck,
    title: "Two-layer consent",
    body: "Full records need the VitalID plus the patient's PIN or in-app approval. Access is time-limited and revocable. Break-glass is logged and notified.",
  },
  {
    icon: Activity,
    title: "Drug-conflict warnings",
    body: "Adding a medicine checks it against current medicines and allergies using a rule base, with AI as a second check.",
  },
  {
    icon: FileLock2,
    title: "Who viewed my record",
    body: "Every view, edit, grant and emergency scan is in an audit log the patient and caregiver can read.",
  },
];

export default function Landing() {
  const { me } = useAuth();
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo className="text-lg" />
        <nav className="flex items-center gap-2">
          {me ? (
            <Link href={homeFor(me)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Open VitalID
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
                Log in
              </Link>
              <Link href="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <p className="mb-3 inline-block rounded-full bg-white px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
          For dementia, Alzheimer&apos;s and post-stroke memory loss
        </p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          A medical memory for people whose own memory is failing.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          One health ID holding the complete history, instant consented access for verified doctors with an AI summary, and cognitive
          tracking that catches decline early.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className="rounded-lg bg-brand-600 px-5 py-3 font-medium text-white hover:bg-brand-700">
            Register as a patient or caregiver
          </Link>
          <Link href="/register?role=doctor" className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-medium text-slate-800 hover:bg-slate-50">
            I&apos;m a doctor
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <f.icon className="h-6 w-6 text-brand-600" />
            <h3 className="mt-3 font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="rounded-xl bg-slate-900 p-6 text-slate-100">
          <h2 className="text-lg font-semibold">Our privacy promise</h2>
          <ul className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <li>• The QR code holds an opaque, revocable token, never medical data.</li>
            <li>• Doctors need your VitalID and your consent; access expires automatically.</li>
            <li>• Names and contact details are never sent to the AI model.</li>
            <li>• Row-level security on every table; files live in private storage.</li>
            <li>• Designed around India&apos;s DPDP Act 2023 principles and ABHA-compatible by design (integration is future work).</li>
            <li>• This prototype uses synthetic demo data only.</li>
          </ul>
        </div>
        <p className="mt-6 text-xs text-slate-500">
          VitalID supports clinicians; it does not replace clinical judgement or emergency services. AI output is a suggestion and
          cognitive scores are screening signals, not diagnoses.
        </p>
      </section>
    </div>
  );
}
