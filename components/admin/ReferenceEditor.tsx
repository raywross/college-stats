"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import { CONFIRM_REVERT, IDLE, fmtDateTime, type AdminActionState } from "@/lib/admin/console";
import type { EditorKind } from "@/lib/admin/reference-view";
import { saveReferenceAction, revertReferenceAction } from "@/app/admin/data/reference/actions";

const inputCls = "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * `/admin/data/reference/[name]` (specs/data-platform/change-sets.md "Admin edits" → "Reference documents"): the
 * document's current body in a JSON or plain textarea, the validator's current verdict, a note, and Save document.
 */
export function ReferenceEditor({ name, kind, value, problems }: { name: string; kind: EditorKind; value: string; problems: string[] }) {
  const id = useId();
  const [state, run, pending] = useActionState<AdminActionState, FormData>(saveReferenceAction, IDLE);

  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="kind" value={kind} />
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-warning bg-warning/10 p-3 text-sm">
          <p className="font-semibold">
            This document currently has {problems.length} problem{problems.length === 1 ? "" : "s"}:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {problems.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          No problems found.
        </p>
      )}
      <div>
        <label htmlFor={`${id}-body`} className="block text-sm font-semibold">
          {kind === "text" ? "Text" : "JSON"}
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          defaultValue={value}
          rows={22}
          spellCheck={false}
          className="mt-1.5 h-[34rem] w-full rounded-xl border border-input bg-background p-3 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="block text-sm font-semibold">
          Note (optional)
        </label>
        <input id={`${id}-note`} name="note" maxLength={500} autoComplete="off" className={`${inputCls} mt-1.5 max-w-md`} />
      </div>
      {state.status === "error" && (
        <p role="alert" className="max-w-prose text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}
      {state.status === "done" && (
        <p role="status" className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save document"}
      </button>
    </form>
  );
}

export interface ReferenceVersionRow {
  version: number;
  deleted: boolean;
  change_set_id: number;
  created_at: string;
}

/** The Versions panel: newest first, each with who it links to and Revert to version {n} (typed confirmation). */
export function ReferenceVersions({ name, rows }: { name: string; rows: ReferenceVersionRow[] }) {
  if (!rows.length) return <Empty>No versions recorded.</Empty>;
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.version} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div>
            <span className="font-semibold">Version {r.version}</span> <span className="text-muted-foreground">· {fmtDateTime(r.created_at)}</span>
            {r.deleted && <span className="ml-1 text-muted-foreground">(deleted)</span>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/admin/data/change-sets/${r.change_set_id}`} className="underline decoration-dotted underline-offset-2">
              Change set #{r.change_set_id}
            </Link>
            <AdminForm
              action={revertReferenceAction}
              hidden={{ name, version: String(r.version) }}
              trigger={`Revert to version ${r.version}`}
              typed={{ expected: CONFIRM_REVERT }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
