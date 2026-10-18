"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { Button, cn, ErrorText, Field, Input } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Tab = "patient" | "caregiver" | "doctor";

const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: "patient", label: "Patient", blurb: "Get your VitalID, QR card and cognitive check-ins." },
  { id: "caregiver", label: "Caregiver", blurb: "Help a family member manage records, medicines and alerts." },
  { id: "doctor", label: "Doctor", blurb: "Look up patients with consent. Your licence is verified before access." },
];

function RegisterForm() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("role") as Tab) || "patient");
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", password: "", licence_no: "", council: "", hospital: "", specialty: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (me) router.replace(homeFor(me));
  }, [me, router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const meta: Record<string, string> = { role: tab, full_name: form.full_name.trim(), phone: form.phone.trim() };
    if (tab === "doctor") Object.assign(meta, { licence_no: form.licence_no.trim(), council: form.council.trim(), hospital: form.hospital.trim(), specialty: form.specialty.trim() });
    const { data, error } = await supabase().auth.signUp({ email: form.email, password: form.password, options: { data: meta } });
    setBusy(false);
    if (error) return setError(error.message);
    if (!data.session) setNotice("Check your email to confirm your account, then log in.");
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <Link href="/">
        <Logo className="text-lg" />
      </Link>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn("rounded-md py-1.5 text-sm font-medium", tab === t.id ? "bg-white shadow-sm" : "text-slate-600")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-600">{TABS.find((t) => t.id === tab)?.blurb}</p>
      <Field label="Full name">
        <Input required value={form.full_name} onChange={set("full_name")} />
      </Field>
      <Field label="Mobile number">
        <Input type="tel" value={form.phone} onChange={set("phone")} placeholder="+91" />
      </Field>
      {tab === "doctor" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Medical licence / registration no." hint="Checked by an admin in this prototype; NMC registry check planned.">
            <Input required value={form.licence_no} onChange={set("licence_no")} />
          </Field>
          <Field label="Medical council">
            <Input value={form.council} onChange={set("council")} placeholder="e.g. Maharashtra Medical Council" />
          </Field>
          <Field label="Hospital / clinic">
            <Input value={form.hospital} onChange={set("hospital")} />
          </Field>
          <Field label="Specialty">
            <Input value={form.specialty} onChange={set("specialty")} />
          </Field>
        </div>
      )}
      <Field label="Email">
        <Input type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <Input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} />
      </Field>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{notice}</p>}
      <Button type="submit" className="w-full" loading={busy}>
        Create {tab} account
      </Button>
      <p className="text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

export default function Register() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <Suspense>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
