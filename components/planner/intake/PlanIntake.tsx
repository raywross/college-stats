"use client";
/**
 * The Plan's intake guide (specs/planner/redesign/intake.md): grades, test, AP courses, four optional activity steps
 * (sports, clubs, work, other), review, then Done; one save
 * at the end through `saveIntake` (lib/planner/store-plan.ts), every rule from lib/planner/intake.ts. Screens 1a
 * (phone) and 2a (desktop) of the design handoff.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActivitiesStep } from "@/components/planner/intake/ActivitiesStep";
import { ApStep } from "@/components/planner/intake/ApStep";
import { DoneStep } from "@/components/planner/intake/DoneStep";
import { GradesStep } from "@/components/planner/intake/GradesStep";
import { ReviewStep } from "@/components/planner/intake/ReviewStep";
import { TestStep } from "@/components/planner/intake/TestStep";
import { track } from "@/lib/analytics";
import {
  activityStepAt,
  draftFromProfile,
  INTAKE_DONE,
  INTAKE_REVIEW,
  intakeStepParam,
  intakeToSave,
  stepValid,
  type IntakeDraft,
  type IntakeStep,
} from "@/lib/planner/intake";
import { stepRailSummary } from "@/lib/planner/activity-steps";
import { entryCount, intakeScrollFor, scrollBehavior } from "@/lib/planner/intake-scroll";
import { planHref } from "@/lib/planner/plan-tabs";
import { saveIntake } from "@/lib/planner/store-plan";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const RAIL_LABELS = ["Grades", "Test score", "AP courses", "Sports", "Clubs", "Work", "Other", "Review"] as const;
/** Steps on the progress bar and rail (Done isn't one). */
const STEP_COUNT = RAIL_LABELS.length;

function railSummary(draft: IntakeDraft, step: IntakeStep): string | null {
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
  const activity = activityStepAt(step);
  if (activity) return stepRailSummary(activity, draft.activities, draft.awards, draft.activitiesNone[activity] === true);
  return null;
}

/**
 * The guide's scrolling (lib/planner/intake-scroll.ts; owner, 2026-10-12): a step change goes to the page top and moves
 * focus to the step's heading; an added entry brings the step's top (its search box) back into view. Returns the ref
 * for the step's container. Scroll only; it never touches the draft or the save.
 */
function useIntakeScroll(step: number, count: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const prev = useRef<{ step: number; count: number } | null>(null);
  useEffect(() => {
    const action = intakeScrollFor(prev.current, { step, count });
    prev.current = { step, count };
    if (!action) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = scrollBehavior(reduced);
    if (action === "page-top") {
      window.scrollTo({ top: 0, behavior });
      const heading = ref.current?.querySelector<HTMLElement>("h1, h2");
      if (heading) {
        heading.tabIndex = -1;
        heading.classList.add("outline-none");
        heading.focus({ preventScroll: true });
      }
    } else {
      ref.current?.scrollIntoView({ block: "start", behavior });
    }
  }, [step, count]);
  return ref;
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
  const params = useSearchParams();
  const done = params.get("done") === "1";
  // `&step=N` (the people line's "Next: add clubs", owner 2026-10-12) opens edit mode on that step instead of Review.
  const linkedStep = intakeStepParam(params.get("step"));
  const today = ctx.today;
  const studentId = ctx.student?.id ?? null;
  const storedGradYear = ctx.student?.grad_year ?? null;
  const person = relation === "guardian" ? studentId : null;

  const [draft, setDraft] = useState<IntakeDraft>(() => draftFromProfile(ctx.profile, storedGradYear, today));
  const [step, setStep] = useState<IntakeStep>(done ? INTAKE_DONE : mode === "edit" ? (linkedStep ?? INTAKE_REVIEW) : 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const stepTop = useIntakeScroll(step, entryCount(draft));

  const go = (from: IntakeStep, to: IntakeStep) => {
    if (from !== INTAKE_DONE) track("plan_intake_step", { step: from, mode });
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
      track("plan_intake_step", { step: INTAKE_REVIEW, mode });
      if (toSave.focus) track("plan_numbers_set", { test: toSave.focus, practice: toSave.practice });
      after();
    });
  };

  if (step === INTAKE_DONE) {
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
  const canSave = stepValid(draft, INTAKE_REVIEW);
  const activityStep = activityStepAt(step);
  // AP courses and the four activity steps can be skipped (they never block Continue either).
  const skippable = step === 2 || activityStep !== null;

  const primaryLabel = step === INTAKE_REVIEW ? "Save and show my plan" : "Continue";
  const primaryDisabled = pending || (step === 0 ? !canContinue0 : step === 1 ? !canContinue1 : step === INTAKE_REVIEW ? !canSave : false);

  const onPrimary = () => {
    if (step === 0) return canContinue0 && go(0, 1);
    if (step === 1) return canContinue1 && go(1, 2);
    if (step < INTAKE_REVIEW) return go(step, (step + 1) as IntakeStep);
    if (step === INTAKE_REVIEW) {
      // One navigation after the save, nothing more (U20 "real speed"): it fetches the page fresh (a plan page is never
      // served from the browser's cache), so a router.refresh() on top only rendered the same page a second time.
      save(() => {
        if (mode === "edit") {
          router.push(planHref({ person, tab: null }));
        } else {
          setStep(INTAKE_DONE);
          // Numbers are set now, so the next server render stops treating this as "first" (intakeNeeded turns
          // false); `setup=1` keeps it showing the guide anyway, and `done=1` tells that next mount to open on Done.
          const href = planHref({ person, setup: true });
          router.replace(`${href}${href.includes("?") ? "&" : "?"}done=1`);
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
              const idx = i as IntakeStep;
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
            <p className="text-sm font-semibold text-muted-foreground">
              Step {step + 1} of {STEP_COUNT}
            </p>
            {skippable ? (
              <button type="button" onClick={() => go(step, (step + 1) as IntakeStep)} className="min-h-11 px-1 text-sm font-semibold text-muted-foreground">
                Skip
              </button>
            ) : (
              <span className="size-11" aria-hidden />
            )}
          </div>
          <ProgressBar step={step} />
        </div>

        <div ref={stepTop} className="px-5 py-6 lg:px-0 lg:py-2">
          {step === 0 && <GradesStep draft={draft} setDraft={setDraft} today={today} storedGradYear={storedGradYear} />}
          {step === 1 && <TestStep draft={draft} setDraft={setDraft} />}
          {step === 2 && <ApStep draft={draft} setDraft={setDraft} today={today} />}
          {activityStep && <ActivitiesStep key={activityStep} step={activityStep} draft={draft} setDraft={setDraft} />}
          {step === INTAKE_REVIEW && <ReviewStep draft={draft} today={today} onEdit={(s) => go(INTAKE_REVIEW, s)} />}

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
            {activityStep && (
              <button type="button" onClick={() => go(step, (step + 1) as IntakeStep)} className="min-h-11 px-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
                I&apos;ll add these later
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
    <div className="flex gap-1.5 px-5 py-3" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEP_COUNT}>
      {Array.from({ length: STEP_COUNT }, (_, i) => i).map((i) => (
        <span key={i} className={cn("h-[5px] flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
      ))}
    </div>
  );
}
