"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import { CONFIRM_REVERT, IDLE, fmtDateTime } from "@/lib/admin/console";
import type { EditorKind } from "@/lib/admin/reference-view";
import type { ReferenceActionState } from "@/lib/admin/reference-actions";
import { fieldList, fieldName, problemsByField, type ReferenceField } from "@/lib/admin/reference-form";
import { saveReferenceAction, revertReferenceAction } from "@/app/admin/data/reference/actions";

const inputCls = "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const boxCls = "mt-1.5 w-full rounded-xl border border-input bg-background p-3 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const switchCls = "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors hover:bg-muted";

/**
 * `/admin/data/reference/[name]` (specs/data-platform/change-sets.md "Admin edits" → "Reference documents";
 * specs/product/admin-redesign.md "Data"): the validator's current verdict, then the document as a form (one field per
 * top-level key, each with the validator's messages that name it; when `fields` is given) or as text (a JSON or plain
 * textarea; "Edit as text" switches a form document to it), a note, and Save document. Both post to the same Server
 * Action; a refusal's messages land beside their fields.
 */
export function ReferenceEditor({
  name,
  kind,
  value,
  problems,
  fields,
}: {
  name: string;
  kind: EditorKind;
  value: string;
  problems: string[];
  /** The document's top-level keys as fields, when it gets a form (lib/admin/reference-form.ts `hasForm`). */
  fields?: ReferenceField[];
}) {
  const id = useId();
  const [state, run, pending] = useActionState<ReferenceActionState, FormData>(saveReferenceAction, IDLE);
  const [asText, setAsText] = useState(!fields);
  const formFields = fields && !asText ? fields : null;
  // After a refused save, the refusal's messages; before one, the document's current verdict.
  const refused = state.status === "error" && state.problems ? state.problems : null;
  const shown = refused ?? problems;
  const placed = formFields ? problemsByField(shown, formFields) : { byKey: {} as Record<string, string[]>, rest: shown };

  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="kind" value={formFields ? "form" : kind} />
      {formFields && <input type="hidden" name="fields" value={fieldList(formFields)} />}
      {shown.length > 0 ? (
        <div role="alert" className="rounded-xl border border-warning bg-warning/10 p-3 text-sm">
          <p className="font-semibold">
            {refused ? "Not saved: " : "This document currently has "}
            {shown.length} problem{shown.length === 1 ? "" : "s"}
            {placed.rest.length < shown.length ? ", each shown beside its field" : ""}
            {placed.rest.length > 0 ? ":" : "."}
          </p>
          {placed.rest.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {placed.rest.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          No problems found.
        </p>
      )}
      {fields && (
        <button type="button" onClick={() => setAsText((t) => !t)} className={switchCls} aria-pressed={asText}>
          {asText ? "Edit as a form" : "Edit as text"}
        </button>
      )}
      {formFields ? (
        <div className="space-y-4">
          {formFields.map((f) => (
            <FormField key={f.key} id={`${id}-${f.key}`} field={f} problems={placed.byKey[f.key] ?? []} />
          ))}
        </div>
      ) : (
        <div>
          <label htmlFor={`${id}-body`} className="block text-sm font-semibold">
            {kind === "text" ? "Text" : "JSON"}
          </label>
          <textarea id={`${id}-body`} name="body" defaultValue={value} rows={22} spellCheck={false} className={`${boxCls} h-[34rem]`} />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-note`} className="block text-sm font-semibold">
          Note (optional)
        </label>
        <input id={`${id}-note`} name="note" maxLength={500} autoComplete="off" className={`${inputCls} mt-1.5 max-w-md`} />
      </div>
      {state.status === "error" && !refused && (
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
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save document"}
      </button>
    </form>
  );
}

/** One top-level key: its words as the label, the input for its kind of value, and the validator's messages that name it. */
function FormField({ id, field, problems }: { id: string; field: ReferenceField; problems: string[] }) {
  const name = fieldName(field.key);
  const invalid = problems.length > 0;
  const aria = { "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${id}-problems` : undefined };
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold">
        {field.label}
        {field.type === "json" && <span className="ml-1 font-normal text-muted-foreground">(as JSON)</span>}
      </label>
      {field.type === "line" ? (
        <input id={id} name={name} defaultValue={field.value} autoComplete="off" {...aria} className={`${inputCls} mt-1.5`} />
      ) : field.type === "number" ? (
        <input id={id} name={name} type="number" step="any" defaultValue={field.value} {...aria} className={`${inputCls} mt-1.5 max-w-xs`} />
      ) : field.type === "boolean" ? (
        <select id={id} name={name} defaultValue={field.value} {...aria} className={`${inputCls} mt-1.5 max-w-xs`}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <textarea
          id={id}
          name={name}
          defaultValue={field.value}
          rows={field.type === "text" ? 4 : 14}
          spellCheck={field.type === "text"}
          {...aria}
          className={`${boxCls} ${field.type === "text" ? "font-sans text-sm" : "h-80"}`}
        />
      )}
      {invalid && (
        <ul id={`${id}-problems`} className="mt-1.5 space-y-1 text-sm text-destructive">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ReferenceVersionRow {
  version: number;
  deleted: boolean;
  change_set_id: number;
  created_at: string;
}

/** The Versions panel: newest first, each with the change that wrote it and Restore version {n} (typed confirmation). */
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
            <Link href={`/admin/data/changes/${r.change_set_id}`} className="underline decoration-dotted underline-offset-2">
              Change #{r.change_set_id}
            </Link>
            <AdminForm
              action={revertReferenceAction}
              hidden={{ name, version: String(r.version) }}
              trigger={`Restore version ${r.version}`}
              typed={{ expected: CONFIRM_REVERT }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
