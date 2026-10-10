"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import type { NumbersFormProps } from "@/components/planner/tabs/types";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { NumbersFields, useNumbersDraft } from "@/components/planner/NumbersForm";
import { track } from "@/lib/analytics";
import { setNumbers, setPlanDream } from "@/lib/planner/store-plan";
import { cn } from "@/lib/utils";

/**
 * First-time setup (specs/planner/redesign/standing.md "First-time setup"): two steps in one card, shown instead
 * of the tabs the first time a student opens Plan, or whenever their numbers are empty. Step 1 is the numbers form
 * (shared with NumbersForm.tsx); step 2 hearts the Dream. A student with no colleges yet skips step 2 straight to
 * `onClose` (the empty list with search).
 */
export default function FirstTimeSetup({ ctx, view, onClose }: NumbersFormProps) {
  const draft = useNumbersDraft(ctx.profile);
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dream, setDream] = useState<string | null>(view.rows.find((r) => r.dream)?.item.id ?? null);
  const canEdit = ctx.viewer.canEdit;
  const studentId = ctx.student?.id ?? null;
  const hasColleges = view.rows.length > 0;

  const saveNumbers = () => {
    if (!studentId || !draft.parsed) {
      setError("Check the numbers: one of them is out of range.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const parsed = draft.parsed!;
      const result = await setNumbers(studentId, parsed);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (parsed.focus) track("plan_numbers_set", { test: parsed.focus, practice: parsed.practice });
      if (hasColleges) setStep(2);
      else onClose?.();
    });
  };

  const toggleDream = (itemId: string) => {
    const on = dream !== itemId;
    setDream(on ? itemId : null);
    track("plan_dream_set", { on });
    startTransition(async () => {
      await setPlanDream(itemId, on);
    });
  };

  if (step === 1) {
    return (
      <section className="space-y-5 rounded-3xl border bg-card p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-bold">Start with your numbers</h2>
          <p className="text-sm text-muted-foreground">
            We use them to sort your colleges into Reach, Target, and Likely. You can change any of it later.
          </p>
        </div>
        <NumbersFields draft={draft} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {canEdit && (
          <button type="button" disabled={pending} onClick={saveNumbers} className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {pending ? "Saving…" : hasColleges ? "Continue" : "Show my plan"}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-3xl border bg-card p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-bold">Is there a Dream school?</h2>
        <p className="text-sm text-muted-foreground">
          The one you&apos;d pick over all the others today. If it has an early decision round, your plan starts it there. Skip it if there isn&apos;t one yet.
        </p>
      </div>
      <ul className="divide-y rounded-2xl border">
        {view.rows.map((r) => (
          <li key={r.item.id} className="flex items-center gap-3 p-3">
            <button
              type="button"
              disabled={!canEdit || pending}
              onClick={() => toggleDream(r.item.id)}
              aria-pressed={dream === r.item.id}
              aria-label={dream === r.item.id ? `${r.school?.name ?? r.item.unit_id} is your Dream; tap to remove it` : `Mark ${r.school?.name ?? r.item.unit_id} as your Dream`}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
            >
              <Heart className={cn("size-5", dream === r.item.id && "fill-rose-500 text-rose-500")} aria-hidden />
            </button>
            <CollegeChip school={r.school ? { unit_id: r.school.unit_id, name: r.school.name, brand: r.school.brand } : null} size="sm" />
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onClose?.()} className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
        Show my plan
      </button>
    </section>
  );
}
