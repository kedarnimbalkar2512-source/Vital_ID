"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Card, ErrorText, Field, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, useRequireRole } from "@/lib/auth";

export default function Onboarding() {
  const { me, ready } = useRequireRole("patient");
  const { refresh } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ dob: "", gender: "", blood_group: "", city: "", has_cognitive_condition: false, pin: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me?.patient_id) router.replace("/patient");
  }, [me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/patients/register-id", {
        json: {
          dob: form.dob || null,
          gender: form.gender || null,
          blood_group: form.blood_group || null,
          city: form.city || null,
          has_cognitive_condition: form.has_cognitive_condition,
        },
      });
      if (form.pin) await api("/api/patients/pin", { json: { pin: form.pin } });
      await refresh();
      router.replace("/patient");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!ready) return null;
  return (
    <div className="max-w-2xl">
      <PageHeader title={`Welcome, ${me?.full_name.split(" ")[0]}`} subtitle="A few details and we'll create your VitalID." />
      <Card>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of birth">
            <Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Blood group">
            <Select value={form.blood_group} onChange={(e) => setForm({ ...form, blood_group: e.target.value })}>
              <option value="">Not sure</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          </Field>
          <Field label="City you live in" hint="Used by the orientation question in check-ins.">
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.has_cognitive_condition}
              onChange={(e) => setForm({ ...form, has_cognitive_condition: e.target.checked })}
            />
            <span>
              I have a memory condition (e.g. dementia, Alzheimer&apos;s, post-stroke memory loss). Your emergency card will tell whoever
              finds you how to help.
            </span>
          </label>
          <Field label="Consent PIN (4–6 digits)" hint="A doctor needs your VitalID and this PIN to open your full record. You can set it later.">
            <Input inputMode="numeric" pattern="\d{4,6}" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <ErrorText>{error}</ErrorText>
            <Button type="submit" loading={busy} className="mt-2">
              Create my VitalID
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
