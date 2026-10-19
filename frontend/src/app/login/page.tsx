"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BackendBanner } from "@/components/BackendStatus";
import { Logo } from "@/components/Logo";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";
import { useBackendStatus } from "@/lib/backend";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const { me, error: meError } = useAuth();
  const router = useRouter();
  const backend = useBackendStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace(homeFor(me));
  }, [me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Signing in loads the profile from the API, so wait for the server rather than hang silently.
    await backend.waitUntilLive();
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <Link href="/">
          <Logo className="text-lg" />
        </Link>
        <h1 className="text-xl font-semibold">Log in</h1>
        <BackendBanner />
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorText>{error || meError}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>
          {busy && backend.state !== "live" ? `Waiting for server… ${backend.elapsed}s` : "Log in"}
        </Button>
        <p className="text-center text-sm text-slate-600">
          New here?{" "}
          <Link href="/register" className="font-medium text-brand-700 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
