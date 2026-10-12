"use client";

import { useActionState, useState } from "react";
import type { OpsState } from "@/lib/admin/ops-actions";

type ServerAction = (previous: OpsState, form: FormData) => Promise<OpsState>;

const TONES = {
  primary: "bg-primary text-primary-foreground",
  neutral: "border border-border bg-background text-foreground hover:bg-muted",
  danger: "border border-destructive/60 bg-background text-destructive hover:bg-destructive/10",
} as const;

export const buttonClass = (tone: keyof typeof TONES) =>
  `inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${TONES[tone]}`;

/**
 * One Operations button: a form with hidden fields, the Server Action it calls, and the result under it. With
 * `confirm`, the first press asks (one line and a second button) and only the second sends. The server action
 * checks the admin and logs the action before it sends anything; nothing here is a guard.
 */
export function OpsActionForm({
  action,
  fields,
  label,
  pendingLabel = "Working…",
  tone = "primary",
  confirm,
}: {
  action: ServerAction;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  tone?: keyof typeof TONES;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<OpsState, FormData>(action, { status: "idle" });
  const [armed, setArmed] = useState(false);
  const asking = Boolean(confirm) && !armed;
  return (
    <form action={formAction} className="min-w-0">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {asking ? (
          <button type="button" className={buttonClass(tone)} onClick={() => setArmed(true)}>
            {label}
          </button>
        ) : (
          <>
            {confirm && <span className="text-sm text-muted-foreground">{confirm}</span>}
            <button type="submit" disabled={pending} className={buttonClass(tone)}>
              {pending ? pendingLabel : confirm ? `Yes, ${label.toLowerCase()}` : label}
            </button>
            {confirm && !pending && (
              <button type="button" className={buttonClass("neutral")} onClick={() => setArmed(false)}>
                Cancel
              </button>
            )}
          </>
        )}
      </div>
      <ActionResult state={state} />
    </form>
  );
}

/** The result line under a button: what happened, with a link to GitHub when there is one. */
export function ActionResult({ state }: { state: OpsState }) {
  if (state.status === "idle") return null;
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-2 text-sm font-medium text-destructive">
        {state.message}
      </p>
    );
  }
  return (
    <p role="status" className="mt-2 text-sm font-medium">
      {state.message}{" "}
      {state.link && (
        <a href={state.link.href} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
          {state.link.label}
        </a>
      )}
    </p>
  );
}
