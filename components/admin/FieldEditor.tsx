"use client";

import { useActionState, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IDLE, fmtDateTime, type AdminActionState } from "@/lib/admin/console";
import type { EditGroup, EditRow } from "@/lib/admin/edits-view";
import { AdminForm, type AdminAction } from "@/components/admin/AdminForm";

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const buttonCls = "inline-flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export interface FieldEditorActions {
  save: AdminAction;
  release: AdminAction;
  revert: AdminAction;
}

/** Phones (< 640px): the groups start closed. The server renders them open (the desktop default). */
const PHONE = "(max-width: 639px)";
function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const usePhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

/**
 * The field editor (specs/data-platform/change-sets.md "Admin edits"): a search box over every row's label and path,
 * then each registry topic as a disclosure (open on desktop, closed on phones; a search opens every group it matches)
 * of rows: the value and its citation, the chips, the typed input with a note and Save, and for an edited path Release
 * and History with Revert to this. The Server Actions re-check everything; nothing here is trusted.
 */
export function FieldEditor({ unit, groups, actions }: { unit: string; groups: EditGroup[]; actions: FieldEditorActions }) {
  const [query, setQuery] = useState("");
  const phone = usePhone();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, rows: q ? g.rows.filter((r) => r.label.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : g.rows })).filter((g) => g.rows.length > 0);
  const edited = groups.reduce((n, g) => n + g.rows.filter((r) => r.edited).length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a field by name or path"
          aria-label="Find a field"
          autoComplete="off"
          className={`${inputCls} sm:max-w-md`}
        />
        <p className="text-sm text-muted-foreground">
          {edited === 0 ? "No value edited" : `${edited} value${edited === 1 ? "" : "s"} edited`}
        </p>
      </div>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">No field matches “{query.trim()}”.</p>}
      {shown.map((g) => {
        const open = q ? true : (toggled[g.topic] ?? !phone);
        return (
          <details
            key={g.topic}
            open={open}
            onToggle={(e) => {
              const now = e.currentTarget.open;
              if (!q && now !== open) setToggled((t) => ({ ...t, [g.topic]: now }));
            }}
            className="rounded-2xl border bg-card"
          >
            <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 font-display text-lg font-bold tracking-tight sm:px-5">
              {g.label}
              <span className="text-sm font-normal text-muted-foreground">{g.rows.length}</span>
            </summary>
            <ul className="divide-y border-t">
              {g.rows.map((r) => (
                <FieldRow key={r.path} unit={unit} row={r} actions={actions} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "edit" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold",
        tone === "edit" && "bg-primary/10 text-primary",
        tone === "warn" && "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** One field: what it is and says, then the form. */
export function FieldRow({ unit, row, actions }: { unit: string; row: EditRow; actions: FieldEditorActions }) {
  return (
    <li className="space-y-2 px-4 py-3 sm:px-5" data-path={row.path}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {row.label}
          {row.edited && <Chip tone="edit">Edited</Chip>}
        </span>
        <span className="min-w-0 font-mono text-[13px] break-words tabular-nums">{row.display}</span>
      </div>
      <p className="font-mono text-xs break-all text-muted-foreground">{row.path}</p>
      <p className="text-xs text-muted-foreground">{row.cited}</p>
      {row.derivedNote && <p className="text-xs text-muted-foreground">{row.derivedNote}.</p>}
      {row.readersNote && <p className="text-xs text-muted-foreground">{row.readersNote}.</p>}
      {row.releasedPending && <p className="text-xs text-muted-foreground">Released: the next publish brings back the pipelines&apos; value.</p>}
      {row.newerPipeline && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="min-w-0 break-words">{row.newerPipeline}</span>
          {row.liveEditId !== null && <ReleaseButton id={row.liveEditId} action={actions.release} />}
        </div>
      )}
      <SaveForm unit={unit} row={row} action={actions.save} />
      {row.edited && row.liveEditId !== null && !row.newerPipeline && <ReleaseButton id={row.liveEditId} action={actions.release} />}
      {row.history.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">History ({row.history.length})</summary>
          <ol className="space-y-2 pb-1">
            {row.history.map((h) => (
              <li key={h.id} className="space-y-1 rounded-xl border px-3 py-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] break-words">{h.display}</span>
                  <Chip tone={h.status === "live" ? "edit" : "muted"}>{h.status === "live" ? "Live" : h.status === "released" ? "Released" : "Replaced"}</Chip>
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(h.at)} · {h.who}
                  {h.note ? ` · ${h.note}` : ""}
                </p>
                {h.status !== "live" && <AdminForm action={actions.revert} hidden={{ edit: String(h.id) }} trigger="Revert to this" pendingLabel="Saving…" />}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function ReleaseButton({ id, action }: { id: number; action: AdminAction }) {
  return <AdminForm action={action} hidden={{ edit: String(id) }} trigger="Release" description="Lets the pipelines' value show again" pendingLabel="Releasing…" />;
}

/** The typed input, the note, Clear this value, and Save. */
function SaveForm({ unit, row, action }: { unit: string; row: EditRow; action: AdminAction }) {
  const id = useId();
  const [state, run, pending] = useActionState<AdminActionState, FormData>(action, IDLE);
  const value = `${id}-value`;
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="path" value={row.path} />
      <input type="hidden" name="kind" value={row.kind} />
      {row.share && <input type="hidden" name="share" value="1" />}
      <div className={cn("grid gap-2", row.kind === "json" && row.shape ? "lg:grid-cols-2" : "")}>
        <div className="min-w-0">
          <label className="sr-only" htmlFor={value}>
            New value for {row.label}
          </label>
          <ValueInput id={value} row={row} />
          {row.hint && <p className="mt-1 text-xs text-muted-foreground">{row.hint}</p>}
        </div>
        {row.kind === "json" && row.shape && (
          <p className="min-w-0 rounded-xl bg-muted px-3 py-2 font-mono text-xs break-all text-muted-foreground">
            <span className="font-sans font-semibold">Another college: </span>
            {row.shape}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input name="note" maxLength={500} autoComplete="off" placeholder="Note (optional)" aria-label={`Note for ${row.label}`} className={`${inputCls} sm:max-w-md`} />
        {row.kind !== "boolean" && (
          <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm">
            <input type="checkbox" name="clear" className="size-5 accent-primary" />
            Clear this value
          </label>
        )}
        <button type="submit" disabled={pending} className={cn(buttonCls, "bg-primary text-primary-foreground hover:bg-primary/90")}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "done" && state.message && (
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

function ValueInput({ id, row }: { id: string; row: EditRow }) {
  if (row.kind === "boolean") {
    return (
      <select id={id} name="value" defaultValue={row.input} className={`${inputCls} sm:max-w-xs`}>
        <option value="true">true</option>
        <option value="false">false</option>
        <option value="none">none</option>
      </select>
    );
  }
  if (row.kind === "enum" && row.options) {
    return (
      <select id={id} name="value" defaultValue={row.input} className={`${inputCls} sm:max-w-md`}>
        {row.input === "" && <option value="">Pick a value</option>}
        {row.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (row.kind === "json") {
    return <textarea id={id} name="value" defaultValue={row.input} rows={Math.min(12, Math.max(3, row.input.split("\n").length))} spellCheck={false} className={`${inputCls} h-auto py-2.5 font-mono text-sm`} />;
  }
  return (
    <input
      id={id}
      name="value"
      type={row.kind === "date" ? "date" : "text"}
      inputMode={row.kind === "number" ? "decimal" : undefined}
      defaultValue={row.input}
      autoComplete="off"
      className={`${inputCls} sm:max-w-md`}
    />
  );
}
