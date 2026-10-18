"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { api } from "@/lib/api";

import { SourceBadge } from "./badges";
import { Button, Card, Empty, ErrorText, Field, Input, Select } from "./ui";

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "date" | "select" | "checkbox" | "times";
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

interface Row {
  id: string;
  source?: string;
  verified?: boolean;
}

/** A list of record entries with add / edit / delete for patient-reported rows. */
export function RecordSection<T extends Row>({
  title,
  table,
  rows,
  fields,
  render,
  patientId,
  onChange,
  readOnly,
}: {
  title: string;
  table: string;
  rows: T[];
  fields: FieldDef[];
  render: (row: T) => ReactNode;
  patientId?: string | null;
  onChange: () => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function start(row?: T) {
    setError(null);
    setEditing(row ? row.id : "new");
    const d: Record<string, unknown> = {};
    for (const f of fields) {
      const v = row ? (row as unknown as Record<string, unknown>)[f.key] : undefined;
      d[f.key] = row ? (v ?? (f.type === "checkbox" ? false : "")) : f.type === "checkbox" ? false : f.options?.[0] ?? "";
      if (typeof d[f.key] === "number") d[f.key] = String(d[f.key]);
    }
    if (d.reminder_times && Array.isArray(d.reminder_times)) d.reminder_times = (d.reminder_times as string[]).join(", ");
    setDraft(d);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const data: Record<string, unknown> = { ...draft };
    if ("reminder_times" in data) {
      data.reminder_times = String(data.reminder_times || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{1,2}:\d{2}$/.test(s));
    }
    for (const k of Object.keys(data)) if (data[k] === "") data[k] = null;
    try {
      if (editing === "new") await api(`/api/records/${table}`, { json: { patient_id: patientId || null, data } });
      else await api(`/api/records/${table}/${editing}`, { method: "PATCH", json: { data } });
      setEditing(null);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: T) {
    if (!confirmDelete(row)) return;
    try {
      await api(`/api/records/${table}/${row.id}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const form = (
    <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) =>
          f.type === "checkbox" ? (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} />
              {f.label}
            </label>
          ) : (
            <Field key={f.key} label={f.label + (f.required ? " *" : "")}>
              {f.type === "select" ? (
                <Select value={String(draft[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                  {f.options!.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={f.type === "date" ? "date" : "text"}
                  placeholder={f.placeholder || (f.type === "times" ? "08:00, 20:00" : undefined)}
                  value={String(draft[f.key] ?? "")}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
            </Field>
          ),
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={save} loading={busy}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <Card
      title={title}
      action={
        !readOnly && (
          <Button size="sm" variant="outline" onClick={() => start()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )
      }
    >
      {editing === "new" && form}
      {rows.length === 0 && editing !== "new" ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">{render(row)}</div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.source && <SourceBadge source={row.source} verified={row.verified} />}
                  {!readOnly && (!row.source || row.source === "patient-reported") && (
                    <>
                      <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => start(row)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" onClick={() => remove(row)} aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {!readOnly && row.source === "ai-extracted" && !row.verified && <VerifyButton table={table} id={row.id} onDone={onChange} />}
                </div>
              </div>
              {editing === row.id && form}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function confirmDelete(row: Row) {
  const name = (row as unknown as Record<string, unknown>).name;
  return typeof window === "undefined" || window.confirm(`Delete this entry${name ? ` (${String(name)})` : ""}?`);
}

export function VerifyButton({ table, id, onDone }: { table: string; id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await api(`/api/patients/records/${table}/${id}/verify`, { method: "POST" });
        setBusy(false);
        onDone();
      }}
    >
      Confirm
    </Button>
  );
}
