"use client";
/**
 * The Plan's intake guide (specs/planner/redesign/intake.md): grades, test, AP courses, review, then Done; one save
 * at the end through `saveIntake` (lib/planner/store-plan.ts), every rule from lib/planner/intake.ts. Screens 1a
 * (phone) and 2a (desktop) of the design handoff.
 */
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ApStep } from "@/components/planner/intake/ApStep";
import { DoneStep } from "@/components/planner/intake/DoneStep";
import { GradesStep } from "@/components/planner/intake/GradesStep";
import { ReviewStep } from "@/components/planner/intake/ReviewStep";
import { TestStep } from "@/components/planner/intake/TestStep";
import { track } from "@/lib/analytics";
import {
  draftFromProfile,
  intakeToSave,
  stepValid,
  type IntakeDraft,
  type IntakeStep,
} from "@/lib/planner/intake";
import { planHref } from "@/lib/planner/plan-tabs";
import { saveIntake } from "@/lib/planner/store-plan";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const RAIL_LABELS = ["Grades", "Test score", "AP courses", "Review"] as const;

function railSummary(draft: IntakeDraft, step: 0 | 1 | 2 | 3): string | null {
  if (step === 0) {
    const parts = [draft.classYear ? `Class of ${draft.classYear}` : null, draft.gpa.trim() ? `GPA ${draft.gpa.trim()}` : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (step === 1) {
    if (draft.test === "none") return "Not testing";
    if (draft.test === "sat" || draft.test === "act") return `${draft.test.toUpperCase()}${draft.score.trim() ? ` ${draft.score.trim()}` : ""}`;
    return null;
  }
  if (step === 2) return draft.courses.length > 0 ? `${draft.courses.length} course${draft.courses.length === 1 ? "" : "s"}` : null;
  return null;
}

export default function PlanIntake({
  ctx,
  view,
  mode,
  relation,
  firstName,
}: {
  ctx: PlanContext;
  view: PlanView;
  /** "first": no numbers yet, ends on Done. "edit": opened from the ✎ on the numbers line, starts at Review. */
  mode: "first" | "edit";
  relation: "self" | "guardian";
  /** The student's first name, for a guardian's copy. */
  firstName: string | null;
}) {
  void firstName;
  const router = useRouter();
  // After a first-run save (below), the server stops rendering this component once `intakeNeeded` turns false
  // (PlanFrame), so a plain `setStep(4)` never survives the refresh that follows: the whole tree unmounts under it.
  // `&done=1` on the URL (alongside `&setup=1`, which keeps PlanFrame rendering the guide regardless) tells the next
  // mount to open on Done directly, instead of edit mode's usual Review.
  const done = useSearchParams().get("done") === "1";
  const today = ctx.today;
  const studentId = ctx.student?.id ?? null;
  const storedGradYear = ctx.student?.grad_year ?? null;
  const person = relation === "guardian" ? studentId : null;
  const examsHidden = relation === "guardian" && Boolean(ctx.profile?.academics.apExamsPrivate);

  const [draft, setDraft] = useState<IntakeDraft>(() => draftFromProfile(ctx.profile, storedGradYear, today));
  const [step, setStep] = useState<IntakeStep>(done ? 4 : mode === "edit" ? 3 : 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = (from: IntakeStep, to: IntakeStep) => {
    if (from !== 4) track("plan_intake_step", { step: from, mode });
    setError(null);
    setStep(to);
  };

  const save = (after: () => void) => {
    if (!studentId) {
      setError("Check your answers: one of them is out of range.");
      return;
    }
    const toSave = intakeToSave(draft);
    if (!toSave) {
      setError("Check your answers: one of them is out of range.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveIntake(studentId, toSave);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      track("plan_intake_step", { step: 3, mode });
      if (toSave.focus) track("plan_numbers_set", { test: toSave.focus, practice: toSave.practice });
      after();
    });
  };

  if (step === 4) {
    const hasColleges = view.rows.length > 0;
    return (
      <DoneStep
        onRunAgain={() => setStep(0)}
        onAddCollege={() => {
          router.push(planHref({ person, tab: "colleges" }) + (hasColleges ? "" : "#add-college"));
          router.refresh();
        }}
      />
    );
  }

  const canContinue0 = stepValid(draft, 0);
  const canContinue1 = stepValid(draft, 1);
  const canSave = stepValid(draft, 3);

  const primaryLabel = step === 3 ? "Save and show my plan" : "Continue";
  const primaryDisabled = pending || (step === 0 ? !canContinue0 : step === 1 ? !canContinue1 : step === 3 ? !canSave : false);

  const onPrimary = () => {
    if (step === 0) return canContinue0 && go(0, 1);
    if (step === 1) return canContinue1 && go(1, 2);
    if (step === 2) return go(2, 3);
    if (step === 3) {
      save(() => {
        if (mode === "edit") {
          router.push(planHref({ person, tab: null }));
          router.refresh();
        } else {
          setStep(4);
          // Numbers are set now, so the next server render stops treating this as "first" (intakeNeeded turns
          // false); `setup=1` keeps it showing the guide anyway, and `done=1` tells that next mount to open on Done.
          const href = planHref({ person, setup: true });
          router.replace(`${href}${href.includes("?") ? "&" : "?"}done=1`);
          router.refresh();
        }
      });
    }
  };

  return (
    <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-14 lg:px-2">
      {/* Desktop rail */}
      <aside className="hidden lg:flex lg:flex-col lg:justify-between lg:py-2">
        <div className="space-y-6">
          <h1 className="font-display text-xl font-extrabold">Set up your plan</h1>
          <nav className="space-y-2">
            {RAIL_LABELS.map((label, i) => {
              const idx = i as 0 | 1 | 2 | 3;
              const state = idx < step ? "done" : idx === step ? "active" : "upcoming";
              const sub = railSummary(draft, idx);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(idx)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left",
                    state === "active" ? "border-foreground bg-card" : "border-transparent hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                      state === "done" && "bg-pop text-pop-foreground",
                      state === "active" && "bg-primary text-primary-foreground",
                      state === "upcoming" && "border text-muted-foreground",
                    )}
                  >
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{label}</span>
                    {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
        <p className="text-xs text-muted-foreground">About two minutes. You can change anything later.</p>
      </aside>

      <div className="lg:flex lg:flex-col">
        {/* Phone header + progress */}
        <div className="lg:hidden">
          <div className="flex min-h-11 items-center justify-between px-5 pt-4">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => go(step, (step - 1) as IntakeStep)}
                aria-label="Back"
                className="flex size-11 items-center justify-center rounded-full border"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            ) : (
              <span className="size-11" aria-hidden />
            )}
            <p className="text-sm font-semibold text-muted-foreground">Step {step + 1} of 4</p>
            {step === 2 ? (
              <button type="button" onClick={() => go(2, 3)} className="min-h-11 px-1 text-sm font-semibold text-muted-foreground">
                Skip
              </button>
            ) : (
              <span className="size-11" aria-hidden />
            )}
          </div>
          <ProgressBar step={step} />
        </div>

        <div className="px-5 py-6 lg:px-0 lg:py-2">
          {step === 0 && <GradesStep draft={draft} setDraft={setDraft} today={today} storedGradYear={storedGradYear} />}
          {step === 1 && <TestStep draft={draft} setDraft={setDraft} />}
          {step === 2 && <ApStep draft={draft} setDraft={setDraft} today={today} examsHidden={examsHidden} />}
          {step === 3 && <ReviewStep draft={draft} today={today} onEdit={(s) => go(3, s)} />}

          {error && <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        </div>

        {/* Phone footer */}
        <div className="sticky bottom-0 mt-auto border-t bg-background px-5 py-4 lg:hidden">
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={onPrimary}
            className="h-[52px] w-full rounded-full bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : primaryLabel}
          </button>
        </div>

        {/* Desktop footer */}
        <div className="mt-10 hidden items-center justify-between border-t pt-6 lg:flex">
          {step > 0 ? (
            <button type="button" onClick={() => go(step, (step - 1) as IntakeStep)} className="min-h-11 rounded-full border px-5 text-sm font-semibold hover:bg-muted">
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-4">
            {step === 2 && (
              <button type="button" onClick={() => go(2, 3)} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
                I&apos;m not taking any AP courses
              </button>
            )}
            <button
              type="button"
              disabled={primaryDisabled}
              onClick={onPrimary}
              className="h-12 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Saving…" : primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ step }: { step: IntakeStep }) {
  return (
    <div className="flex gap-1.5 px-5 py-3" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={4}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={cn("h-[5px] flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
      ))}
    </div>
  );
}
