"use client";

import { AlertOctagon, HeartPulse, Phone, Pill, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { publicApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

interface Emergency {
  full_name: string;
  vital_id: string;
  photo_url: string | null;
  blood_group: string | null;
  age: number | null;
  has_cognitive_condition: boolean;
  emergency_note: string | null;
  allergies: { substance: string; reaction: string | null; severity: string; verified: boolean }[];
  critical_medications: { name: string; dose: string | null; frequency: string | null }[];
  key_conditions: string[];
  emergency_contacts: { name: string; relationship: string | null; phone: string }[];
  last_updated: string;
  is_demo: boolean;
}

export default function EmergencyView({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Emergency | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicApi<Emergency>(`/api/emergency/${encodeURIComponent(params.token)}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.token]);

  if (error)
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div>
          <Logo className="text-lg" />
          <p className="mt-6 text-lg font-medium">{error}</p>
          <p className="mt-2 text-slate-600">In an emergency, call 112.</p>
        </div>
      </div>
    );
  if (!data) return <div className="grid min-h-screen place-items-center text-slate-500">Loading emergency information…</div>;

  const first = data.full_name.split(" ")[0];
  const contact = data.emergency_contacts[0];
  return (
    <div className="min-h-screen bg-white pb-10 text-[17px]">
      <header className="flex items-center justify-between bg-red-700 px-4 py-3 text-white">
        <span className="font-bold uppercase tracking-wide">Emergency information</span>
        <a href="tel:112" className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-red-700">
          Call 112
        </a>
      </header>
      {data.is_demo && <p className="bg-amber-100 px-4 py-1 text-center text-xs font-medium text-amber-900">Synthetic demo record, not a real person</p>}

      <div className="mx-auto max-w-lg space-y-4 p-4">
        {data.has_cognitive_condition && (
          <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
            <p className="text-xl font-bold text-amber-900">{first} has memory loss.</p>
            <p className="mt-1 text-amber-900">
              {first} may be confused, lost or unable to give their name. Please stay with them, speak slowly and calmly, and call{" "}
              {contact ? `${contact.relationship?.toLowerCase() || "their contact"} ${contact.name.split(" ")[0]}` : "the number below"}.
            </p>
            {contact && (
              <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-lg font-bold text-white">
                <Phone className="h-5 w-5" /> Call {contact.name.split(" ")[0]}: {contact.phone}
              </a>
            )}
          </section>
        )}

        <section className="flex items-center gap-4">
          {data.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.photo_url} alt={data.full_name} className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-xl bg-slate-100 text-2xl font-bold text-slate-400">{first[0]}</div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{data.full_name}</h1>
            <p className="text-slate-600">
              {data.age ? `${data.age} years · ` : ""}VitalID <span className="font-mono">{data.vital_id}</span>
            </p>
          </div>
          <div className="ml-auto rounded-xl bg-red-50 px-3 py-2 text-center">
            <HeartPulse className="mx-auto h-5 w-5 text-red-600" />
            <p className="text-xl font-bold text-red-700">{data.blood_group || "?"}</p>
          </div>
        </section>

        {data.allergies.length > 0 && (
          <section className="rounded-2xl bg-red-600 p-4 text-white">
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
              <AlertOctagon className="h-5 w-5" /> Allergies
            </p>
            <ul className="mt-2 space-y-1">
              {data.allergies.map((a) => (
                <li key={a.substance} className="text-xl font-bold">
                  {a.substance}
                  <span className="ml-2 text-base font-normal opacity-90">
                    {a.reaction ? `${a.reaction}, ` : ""}
                    {a.severity}
                    {!a.verified ? " (self-reported)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.critical_medications.length > 0 && (
          <section className="rounded-2xl border border-slate-200 p-4">
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              <Pill className="h-4 w-4" /> Critical medicines
            </p>
            <ul className="mt-2 space-y-1">
              {data.critical_medications.map((m) => (
                <li key={m.name} className="text-lg">
                  <b>{m.name}</b> {m.dose} <span className="text-slate-500">{m.frequency}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.key_conditions.length > 0 && (
          <section className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Key conditions</p>
            <p className="mt-1 text-lg">{data.key_conditions.join(" · ")}</p>
          </section>
        )}

        {data.emergency_note && (
          <section className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Note from {first}</p>
            <p className="mt-1">{data.emergency_note}</p>
          </section>
        )}

        <section className="space-y-2">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Emergency contacts</p>
          {data.emergency_contacts.map((c) => (
            <a key={c.phone} href={`tel:${c.phone.replace(/\s/g, "")}`} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
              <span>
                <b>{c.name}</b> <span className="text-slate-500">{c.relationship}</span>
              </span>
              <span className="flex items-center gap-1 font-semibold text-brand-700">
                <Phone className="h-4 w-4" /> {c.phone}
              </span>
            </a>
          ))}
        </section>

        <Link href={`/doctor?vid=${data.vital_id}`} className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
          <Stethoscope className="h-5 w-5" />
          Doctor? Log in to request full records with the patient&apos;s consent or emergency access.
        </Link>

        <p className="text-center text-xs text-slate-500">
          Last updated {fmtDateTime(data.last_updated)}. This scan has been logged and the family notified. VitalID does not replace emergency services.
        </p>
      </div>
    </div>
  );
}
