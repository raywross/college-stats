"use client";

import { useActionState } from "react";
import { cn } from "@/lib/utils";
import type { HouseholdActionState } from "@/app/household/actions";

type Action = (prev: HouseholdActionState, form: FormData) => Promise<HouseholdActionState>;

/**
 * One button that runs a household Server Action with a few hidden fields (ids only), optionally after a browser
 * confirm, and shows the refusal message beside it. Used for remove, leave, revoke, and edit-access changes.
 */
export function HouseholdActionButton({
  action,
  fields,
  label,
  pendingLabel,
  confirm,
  tone = "default",
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  tone?: "default" | "danger" | "primary";
  className?: string;
}) {
  const [state, run, pending] = useActionState<HouseholdActionState, FormData>(action, { status: "idle" });
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn("inline-flex flex-col items-end gap-1", className)}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={pending}
        className={cn(
          "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold transition-colors disabled:opacity-60",
          tone === "danger" && "border border-destructive/40 text-destructive hover:bg-destructive/10",
          tone === "default" && "border hover:bg-muted",
          tone === "primary" && "bg-primary text-primary-foreground",
        )}
      >
        {pending ? (pendingLabel ?? "Working…") : label}
      </button>
      {state.status === "error" && (
        <span className="max-w-56 text-right text-xs font-medium text-destructive" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}
