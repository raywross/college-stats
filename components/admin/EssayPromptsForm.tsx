"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { IDLE, type AdminActionState } from "@/lib/admin/console";
import { splitPastedPrompts } from "@/lib/essay-prompts/confirmed";
import {
  FORM_OPTIONS,
  KIND_OPTIONS,
  LIMIT_OPTIONS,
  draftProblems,
  emptyRow,
  rowsWithProblems,
  type DraftRow,
  type EssayDraft,
} from "@/lib/admin/essays-form";

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const labelCls = "block text-sm font-semibold";
const buttonCls =
  "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const iconButtonCls = "inline-flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

export interface EssayPromptsFormProps {
  action: (prev: AdminActionState, form: FormData) => Promise<AdminActionState>;
  unitId: string;
  name: string;
  initial: EssayDraft;
  /** The open cycle and today (the server's), for the checks shown before any call. */
  openCycle: string;
  today: string;
}

/**
 * The hand-read form (specs/product/essays/sources.md "The hand read"): a person reading a college's application types
 * or pastes its questions here, and Save writes them to the database (lib/admin/essays-actions.ts), live on the advisor
 * at once. The problems `validateConfirmed` finds are shown inline before any call; the action checks everything
 * again. Phone-first: one
 * column of cards, 44px targets, nothing wider than the screen at 390px.
 */
export function EssayPromptsForm({ action, unitId, name, initial, openCycle, today }: EssayPromptsFormProps) {
  const id = useId();
  const [draft, setDraft] = useState<EssayDraft>(initial);
  const [paste, setPaste] = useState("");
  const [tried, setTried] = useState(false);
  const college = useMemo(() => ({ unit_id: unitId, name }), [unitId, name]);
  const checks = useMemo(() => ({ openCycle, today }), [openCycle, today]);
  const problems = useMemo(() => draftProblems(draft, college, checks), [draft, college, checks]);
  const badRows = useMemo(() => rowsWithProblems(problems), [problems]);
  const [state, run, pending] = useActionState<AdminActionState, FormData>(async (prev, form) => {
    setTried(true);
    if (draftProblems(draft, college, checks).length) return IDLE;
    return action(prev, form);
  }, IDLE);

  const set = (patch: Partial<EssayDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setRow = (i: number, patch: Partial<DraftRow>) => setDraft((d) => ({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const move = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const rows = [...d.rows];
      const j = i + by;
      if (j < 0 || j >= rows.length) return d;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      return { ...d, rows };
    });
  const remove = (i: number) => setDraft((d) => ({ ...d, rows: d.rows.filter((_, j) => j !== i) }));
  const add = () => setDraft((d) => ({ ...d, rows: [...d.rows, emptyRow()] }));
  function fillFromPaste() {
    const texts = splitPastedPrompts(paste);
    if (!texts.length) return;
    setDraft((d) => {
      const kept = d.rows.filter((r) => r.text.trim());
      return { ...d, status: "published", rows: [...kept, ...texts.map((t) => emptyRow(t))] };
    });
    setPaste("");
  }
  const unrequired = draft.rows.filter((r) => !r.required).length;
  const published = draft.status === "published";

  return (
    <form action={run} className="space-y-5" noValidate>
      <input type="hidden" name="unit" value={unitId} />
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">The read</legend>
        <div>
          <label className={labelCls} htmlFor={`${id}-cycle`}>
            Cycle
          </label>
          <input id={`${id}-cycle`} value={draft.cycle} onChange={(e) => set({ cycle: e.target.value })} placeholder="2026-27" autoComplete="off" className={cn(inputCls, "mt-1.5")} />
        </div>
        <div>
          <label className={labelCls} htmlFor={`${id}-form`}>
            Form
          </label>
          <select id={`${id}-form`} value={draft.form} onChange={(e) => set({ form: e.target.value as EssayDraft["form"] })} className={cn(inputCls, "mt-1.5")}>
            {FORM_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor={`${id}-read-on`}>
            Read on
          </label>
          <input id={`${id}-read-on`} type="date" value={draft.readOn} onChange={(e) => set({ readOn: e.target.value })} className={cn(inputCls, "mt-1.5")} />
        </div>
        <div>
          <label className={labelCls} htmlFor={`${id}-reader`}>
            Reader&apos;s initials
          </label>
          <input
            id={`${id}-reader`}
            value={draft.reader}
            maxLength={4}
            onChange={(e) => set({ reader: e.target.value.toUpperCase() })}
            placeholder="RR"
            autoComplete="off"
            autoCapitalize="characters"
            className={cn(inputCls, "mt-1.5")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className={labelCls}>What the form shows</legend>
        {(
          [
            ["published", "The form asks these questions"],
            ["none", "No college questions beyond the platform's"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
            <input type="radio" name={`${id}-status`} checked={draft.status === value} onChange={() => set({ status: value })} className="size-5 accent-primary" />
            {label}
          </label>
        ))}
      </fieldset>

      {published && (
        <>
          <div className="rounded-2xl border border-dashed p-3 sm:p-4">
            <label className={labelCls} htmlFor={`${id}-paste`}>
              Paste the questions, one per paragraph
            </label>
            <textarea id={`${id}-paste`} value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} className={cn(inputCls, "mt-1.5 h-auto py-2.5")} />
            <p className="mt-1 text-xs text-muted-foreground">Leave a blank line between questions. Numbers and bullets at the start are dropped; set each one&apos;s limit below.</p>
            <button type="button" onClick={fillFromPaste} disabled={!paste.trim()} className={cn(buttonCls, "mt-2 border hover:bg-muted")}>
              Fill the rows
            </button>
          </div>

          <ol className="space-y-3">
            {draft.rows.map((row, i) => (
              <li key={i} className={cn("rounded-2xl border bg-background p-3 sm:p-4", tried && badRows.has(i) && "border-destructive")} data-row={i + 1}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Question {i + 1}</span>
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`} className={iconButtonCls}>
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === draft.rows.length - 1} aria-label={`Move question ${i + 1} down`} className={iconButtonCls}>
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => remove(i)} aria-label={`Remove question ${i + 1}`} className={cn(iconButtonCls, "text-destructive")}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </span>
                </div>
                <label className="sr-only" htmlFor={`${id}-text-${i}`}>
                  Question {i + 1} text
                </label>
                <textarea id={`${id}-text-${i}`} value={row.text} onChange={(e) => setRow(i, { text: e.target.value })} rows={3} className={cn(inputCls, "mt-2 h-auto py-2.5")} />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-semibold" htmlFor={`${id}-kind-${i}`}>
                      Kind
                    </label>
                    <select id={`${id}-kind-${i}`} value={row.kind} onChange={(e) => setRow(i, { kind: e.target.value as DraftRow["kind"] })} className={cn(inputCls, "mt-1")}>
                      {KIND_OPTIONS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-semibold" htmlFor={`${id}-limit-${i}`}>
                      Limit
                    </label>
                    <select id={`${id}-limit-${i}`} value={row.limitKind} onChange={(e) => setRow(i, { limitKind: e.target.value as DraftRow["limitKind"] })} className={cn(inputCls, "mt-1")}>
                      {LIMIT_OPTIONS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {row.limitKind !== "none" && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold" htmlFor={`${id}-max-${i}`}>
                          Max
                        </label>
                        <input id={`${id}-max-${i}`} inputMode="numeric" value={row.max} onChange={(e) => setRow(i, { max: e.target.value })} className={cn(inputCls, "mt-1")} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold" htmlFor={`${id}-min-${i}`}>
                          Min (optional)
                        </label>
                        <input id={`${id}-min-${i}`} inputMode="numeric" value={row.min} onChange={(e) => setRow(i, { min: e.target.value })} className={cn(inputCls, "mt-1")} />
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
                  <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
                    <input type="checkbox" checked={row.required} onChange={(e) => setRow(i, { required: e.target.checked })} className="size-5 accent-primary" />
                    Required
                  </label>
                  <div>
                    <label className="block text-xs font-semibold" htmlFor={`${id}-applies-${i}`}>
                      Applies to
                    </label>
                    <select id={`${id}-applies-${i}`} value={row.appliesTo} onChange={(e) => setRow(i, { appliesTo: e.target.value as DraftRow["appliesTo"] })} className={cn(inputCls, "mt-1")}>
                      <option value="all">Everyone</option>
                      <option value="program">A program</option>
                    </select>
                  </div>
                  {row.appliesTo === "program" && (
                    <div>
                      <label className="block text-xs font-semibold" htmlFor={`${id}-program-${i}`}>
                        Program
                      </label>
                      <input id={`${id}-program-${i}`} value={row.program} onChange={(e) => setRow(i, { program: e.target.value })} placeholder="Honors College" className={cn(inputCls, "mt-1")} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <button type="button" onClick={add} className={cn(buttonCls, "border hover:bg-muted")}>
            <Plus className="size-4" aria-hidden />
            Add a question
          </button>

          <div className="space-y-2 rounded-2xl border p-3 sm:p-4">
            <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
              <input type="checkbox" checked={draft.choose.on} onChange={(e) => set({ choose: { ...draft.choose, on: e.target.checked } })} className="size-5 accent-primary" />
              Choose n of these (the questions that aren&apos;t required)
            </label>
            {draft.choose.on && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor={`${id}-choose-n`}>Choose</label>
                <input id={`${id}-choose-n`} inputMode="numeric" value={draft.choose.n} onChange={(e) => set({ choose: { ...draft.choose, n: e.target.value } })} className={cn(inputCls, "w-20")} />
                <span>
                  of the {unrequired} {unrequired === 1 ? "question" : "questions"} not marked required
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <div>
        <label className={labelCls} htmlFor={`${id}-note`}>
          A note (optional, kept with the record)
        </label>
        <textarea id={`${id}-note`} value={draft.note} onChange={(e) => set({ note: e.target.value })} rows={2} placeholder="The Honors prompt is separate" className={cn(inputCls, "mt-1.5 h-auto py-2.5")} />
      </div>

      {tried && problems.length > 0 && (
        <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-semibold text-destructive">Fix these before saving:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((p) => (
              <li key={p} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col items-start gap-2">
        <button type="submit" disabled={pending} className={cn(buttonCls, "bg-primary text-primary-foreground hover:bg-primary/90")}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.status === "error" && (
          <p role="alert" className="max-w-prose text-sm font-medium break-words text-destructive">
            {state.message}
          </p>
        )}
        {state.status === "done" && (
          <p role="status" className="max-w-prose text-sm font-medium break-words text-emerald-800 dark:text-emerald-300">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
