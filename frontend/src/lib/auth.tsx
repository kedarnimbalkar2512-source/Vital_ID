"use client";

import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api, ApiError } from "./api";
import { supabase } from "./supabase";
import type { Me, Role } from "./types";

interface AuthState {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) {
      setMe(null);
      return;
    }
    try {
      setMe(await api<Me>("/api/me"));
      setError(null);
    } catch (e) {
      setMe(null);
      setError(e instanceof ApiError ? e.message : "Could not reach the VitalID API");
    }
  }, []);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadMe(data.session);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") loadMe(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadMe]);

  const value: AuthState = {
    session,
    me,
    loading,
    error,
    refresh: () => loadMe(session),
    signOut: async () => {
      await supabase().auth.signOut();
      setMe(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function homeFor(me: Me): string {
  if (me.role === "patient") return me.patient_id ? "/patient" : "/onboarding";
  if (me.role === "caregiver") return "/caregiver";
  if (me.role === "doctor") return "/doctor";
  return "/admin";
}

/** Redirects to /login when signed out, or home when the role doesn't match. */
export function useRequireRole(...roles: Role[]) {
  const { me, loading, session } = useAuth();
  const router = useRouter();
  const key = roles.join(",");
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (me && roles.length && !roles.includes(me.role)) router.replace(homeFor(me));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, me, key, router]);
  return { me, ready: !loading && !!me && (!roles.length || roles.includes(me.role)) };
}
