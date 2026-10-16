"use client";

import { useState, useTransition } from "react";
import { setParentsCanEdit } from "@/app/household/actions";
import { Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * The student's switch over their parents' edit access (specs/product/household-hub.md "Parents can edit: the
 * student's switch"). On by default when a student is added; off means every guardian in the household can only
 * look. One switch for all guardians: it flips each guardian membership's can_edit (set_member_can_edit). Moved from
 * the Numbers page to `/account` (record/steps.md "Parents can edit"), under its own `AccountSection`; `bare` drops
 * this component's own card chrome (border, heading) so the section's doesn't double up — pass it there and render
 * just the description and the switch.
 */
export function ParentsCanEdit({ on: initial, guardians, bare = false }: { on: boolean; guardians: number; bare?: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const flip = () => {
    const next = !on;
    setOn(next);
    setError(null);
    startTransition(async () => {
      const result = await setParentsCanEdit(next);
      if (result.status === "error") {
        setOn(!next);
        setError(result.message);
      }
    });
  };
  const body = (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {!bare && (
          <h2 id="parents-can-edit" className="font-display text-base font-bold">
            Parents can <Term term="edit-access">edit</Term>
          </h2>
        )}
        <p className={cn("text-sm text-muted-foreground", !bare && "mt-0.5")}>
          {on
            ? `${guardians === 1 ? "Your parent" : "Your parents"} can change your list, plan, and record, not just look. Switch it off and they can only look.`
            : `${guardians === 1 ? "Your parent" : "Your parents"} can see your list, plan, and record but can't change them.`}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Parents can edit"
        disabled={pending}
        onClick={flip}
        className="inline-flex h-11 items-center gap-2.5 text-sm font-semibold disabled:opacity-70"
      >
        <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
          <span className={cn("absolute left-0.5 size-5 rounded-full bg-background shadow transition-transform", on && "translate-x-5")} />
        </span>
        {on ? "On" : "Off"}
      </button>
    </div>
  );
  if (bare) {
    return (
      <>
        {body}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </>
    );
  }
  return (
    <section className="rounded-3xl border bg-card p-4 sm:p-5" aria-labelledby="parents-can-edit">
      {body}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
