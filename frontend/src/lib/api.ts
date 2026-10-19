import { supabase } from "./supabase";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Long enough for a Render cold start (~50 s) plus an AI call, short enough to never hang forever.
const TIMEOUT_MS = 90_000;

async function request(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(0, aborted ? "The server took too long to answer. Please try again." : "Could not reach the VitalID server. It may be starting up; try again in a moment.");
  } finally {
    clearTimeout(timer);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
  } catch {
    /* not JSON */
  }
  throw new ApiError(res.status, message);
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await request(`${API_URL}${path}`, {
    ...rest,
    method: rest.method || (json !== undefined ? "POST" : "GET"),
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await authHeader()),
      ...(headers as Record<string, string>),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  return handle<T>(res);
}

export async function upload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await request(`${API_URL}${path}`, { method: "POST", headers: await authHeader(), body: form });
  return handle<T>(res);
}

/** Unauthenticated call (public emergency view). */
export async function publicApi<T = unknown>(path: string): Promise<T> {
  return handle<T>(await request(`${API_URL}${path}`, { cache: "no-store" }));
}

export function withPatient(path: string, patientId?: string | null): string {
  if (!patientId) return path;
  return path + (path.includes("?") ? "&" : "?") + `patient_id=${encodeURIComponent(patientId)}`;
}
