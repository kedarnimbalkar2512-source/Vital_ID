"use client";

import { Bell, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import type { Notification, Role } from "@/lib/types";

import { DemoBadge } from "./badges";
import { Logo } from "./Logo";
import { cn } from "./ui";

const NAV: Record<Role, { href: string; label: string }[]> = {
  patient: [
    { href: "/patient", label: "Home" },
    { href: "/patient/profile", label: "Medical profile" },
    { href: "/patient/qr", label: "QR card" },
    { href: "/patient/cognitive", label: "Cognitive check-in" },
    { href: "/patient/documents", label: "Documents" },
    { href: "/patient/access", label: "Access & privacy" },
  ],
  caregiver: [
    { href: "/caregiver", label: "My patients" },
    { href: "/alerts", label: "Alerts" },
  ],
  doctor: [
    { href: "/doctor", label: "Patient lookup" },
    { href: "/doctor/tools", label: "AI tools" },
    { href: "/alerts", label: "Alerts" },
  ],
  admin: [{ href: "/admin", label: "Doctor verification" }],
};

/** Patient pages also serve caregivers: `?patient=<id>` selects the linked patient. */
export function usePatientParam(): string | null {
  return useSearchParams().get("patient");
}

function NotificationsMenu() {
  const { me, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (open) api<Notification[]>("/api/notifications").then(setItems).catch(() => setItems([]));
  }, [open]);

  async function markAll() {
    await api("/api/notifications/read", { json: [] });
    setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    refresh();
  }

  const unread = me?.unread_notifications || 0;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button onClick={markAll} className="text-xs text-brand-700 hover:underline">
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  className={cn("w-full px-4 py-3 text-left hover:bg-slate-50", !n.read_at && "bg-brand-50/60")}
                  onClick={() => {
                    setOpen(false);
                    if (n.link) router.push(n.link);
                  }}
                >
                  <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const patientParam = useSearchParams().get("patient");
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = me ? NAV[me.role] : [];

  const caregiverNav =
    me?.role === "caregiver" && patientParam
      ? NAV.patient.map((n) => ({ ...n, href: `${n.href}?patient=${patientParam}` }))
      : [];

  const links = (
    <>
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium",
            pathname === n.href ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          {n.label}
        </Link>
      ))}
      {caregiverNav.length > 0 && (
        <>
          <p className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Managing patient</p>
          {caregiverNav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium",
                pathname === n.href.split("?")[0] ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {n.label}
            </Link>
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button className="rounded-lg p-2 hover:bg-slate-100 md:hidden" onClick={() => setMobileOpen((o) => !o)} aria-label="Menu">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link href="/">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {me?.is_demo && <DemoBadge />}
            <span className="hidden text-sm text-slate-600 sm:inline">
              {me?.role === "doctor" ? "Dr. " : ""}
              {me?.full_name}
              <span className="ml-1 text-xs capitalize text-slate-400">({me?.role})</span>
            </span>
            <NotificationsMenu />
            <button
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav className="no-print hidden w-52 shrink-0 flex-col gap-1 md:flex">{links}</nav>
        {mobileOpen && <nav className="no-print fixed inset-x-0 top-14 z-20 flex flex-col gap-1 border-b bg-white p-4 shadow md:hidden">{links}</nav>}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <footer className="no-print mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-400">
        VitalID supports clinicians; it does not replace clinical judgement or emergency services. AI output is a suggestion and cognitive
        scores are screening signals, not diagnoses. Prototype: synthetic data only.
      </footer>
    </div>
  );
}
