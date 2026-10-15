"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SourceTip } from "@/components/ui/info-tip";
import { saveCourses } from "@/lib/chances/courses-store";
import { newCourse, thirdPerson } from "@/lib/chances/courses";
import { dismissSuggestion, markScheduleDone, saveSchoolOffers } from "@/lib/chances/course-plan-store";
import { endpointFetch, ESTIMATE_MAX_COLLEGES, whatItChanges } from "@/lib/chances/course-plan-estimate";
import type { CoursePlanView, SuggestionView } from "@/lib/chances/course-plan-view";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import { track } from "@/lib/analytics";
import type { PlanContext } from "@/lib/planner/types";
import { cn } from "@/lib/utils";
import MoveCard from "@/components/planner/moves/MoveCard";
import type { MoveCardProps } from "@/components/planner/moves/types";

/**
 * The playbook's course-choice card (specs/planner/next-steps/seasons.md "The playbook"; build-plan.md "As built by
 * U1" 6: the course card matches a task key ending in `:choose_courses`). Restored from the pre-redesign Scores tab
 * (`git show c2866a9d^:components/planner/NextYearCard.tsx`, where it read `ctx.coursePlan` the same way) and
 * re-homed here as the Next steps card for that move: up to two suggestions, each with its reason and evidence, a
 * line on what it changes when the estimate endpoint says so, and "Add to my plan" / "Not for me" per suggestion.
 * The guardrail messages replace the suggestions when they fire; a 9th or 10th grader sees the path to the top
 * course in the subjects tied to the major. Marking the schedule chosen also ticks the move (`onDone`); every other
 * playbook kind, or a `playbook` task whose key isn't a course choice, falls back to the default card.
 *
 * `ctx.coursePlan` is filled by `lib/planner/load.ts` only in the seasons this card shows (freshman/sophomore
 * February–April, junior winter); outside them, or without a profile, it's null and this falls back too.
 */
export function NextYearCard(props: MoveCardProps) {
  const { task, ctx, onDone } = props;
  const isCourseChoice = task.kind === "playbook" && task.key?.endsWith("choose_courses") === true;
  const plan = ctx.coursePlan ?? null;
  const hasContent = plan !== null && (plan.kind !== "none" || plan.askOffering !== null);
  const active = isCourseChoice && hasContent && plan !== null;

  const isGuardian = ctx.viewer.isGuardian;
  const first = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const say = (t: string) => (isGuardian ? thirdPerson(t, first) : t);
  const editable = ctx.viewer.canEdit && !isGuardian;
  const studentId = ctx.student?.id ?? null;
  // Hooks run every render, in the same order, whether or not this card ends up active (the early return below
  // happens after every hook has already been called).
  const shown = useRef(false);
  useEffect(() => {
    if (!active || !plan || shown.current) return;
    shown.current = true;
    track("course_plan_shown", { reasons: plan.telemetry.reasons, guardrail: plan.telemetry.guardrail });
  }, [active, plan]);

  if (!active || !plan) return <MoveCard {...props} />;

  const open = plan.inWindow && !plan.done && plan.kind !== "none";

  return (
    <div className="rounded-3xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <details className="group" open={open}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
          <span>
            {task.title}
            {plan.done && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">done</span>}
          </span>
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
        </summary>

        <div className="mt-3 space-y-3 text-sm">
          {plan.kind === "suggestions" && <Suggestions plan={plan} ctx={ctx} say={say} editable={editable} studentId={studentId} />}

          {plan.kind === "path" && (
            <ul className="space-y-1.5">
              {plan.path.map((t) => (
                <li key={t}>{say(t)}</li>
              ))}
            </ul>
          )}

          {plan.messages.length > 0 && (
            <div className="space-y-1">
              {plan.messages.map((t) => (
                <p key={t} className={plan.kind === "suggestions" ? "text-xs text-muted-foreground" : undefined}>
                  {say(t)}
                </p>
              ))}
            </div>
          )}

          {plan.askOffering && editable && studentId && <SchoolMarks plan={plan} studentId={studentId} />}

          {plan.methodNote && <p className="text-xs text-muted-foreground">{plan.methodNote}</p>}
        </div>
      </details>
      {editable && studentId && (plan.kind === "suggestions" || plan.kind === "set") && (
        <div className="mt-3">
          <DoneButton studentId={studentId} done={plan.done} onDone={() => onDone(task)} />
        </div>
      )}
    </div>
  );
}

function Suggestions({ plan, ctx, say, editable, studentId }: { plan: CoursePlanView; ctx: PlanContext; say: (t: string) => string; editable: boolean; studentId: string | null }) {
  const profile = ctx.profile;
  const colleges = useMemo(
    () =>
      ctx.items
        .filter((i) => !i.withdrawn_on)
        .map((i) => ({ unitId: i.unit_id, name: ctx.schools[i.unit_id]?.name ?? "" }))
        .filter((c) => c.name !== "")
        .slice(0, ESTIMATE_MAX_COLLEGES),
    [ctx.items, ctx.schools],
  );
  // What each suggestion changes at a college on the list: asked of the estimate endpoint once the card is open and
  // quietly dropped when the endpoint isn't there (course-plan-estimate.ts).
  const [changes, setChanges] = useState<Record<string, string>>({});
  const keys = plan.suggestions.map((s) => s.key).filter((k): k is string => k !== null);
  const signature = keys.join("|");
  useEffect(() => {
    if (!profile || colleges.length === 0 || keys.length === 0) return;
    let cancelled = false;
    const fetchEstimate = endpointFetch();
    (async () => {
      const unitIds = colleges.map((c) => c.unitId);
      const base = await fetchEstimate({ student: estimateInputFromProfile(profile, unitIds[0], null).student, unitIds });
      if (!base || cancelled) return;
      for (const s of plan.suggestions) {
        if (!s.key) continue;
        const course = newCourse({ kind: "ap", key: s.key, grade: plan.grade, year: s.year });
        const line = await whatItChanges({ profile, colleges, course, fetchEstimate, base });
        if (cancelled) return;
        if (line) setChanges((prev) => ({ ...prev, [s.id]: line }));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The suggestions' keys are what the question depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, colleges.length, profile?.academics.courses.length]);

  return (
    <ul className="space-y-3">
      {plan.suggestions.map((s) => (
        <SuggestionRow key={s.id} s={s} plan={plan} ctx={ctx} say={say} changeLine={changes[s.id] ?? null} editable={editable} studentId={studentId} />
      ))}
    </ul>
  );
}

function SuggestionRow({ s, plan, ctx, say, changeLine, editable, studentId }: { s: SuggestionView; plan: CoursePlanView; ctx: PlanContext; say: (t: string) => string; changeLine: string | null; editable: boolean; studentId: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const profile = ctx.profile;

  const add = () => {
    if (!studentId || !profile || !s.key) return;
    setError(null);
    startTransition(async () => {
      const row = newCourse({ kind: "ap", key: s.key, grade: plan.grade, year: s.year });
      const result = await saveCourses(studentId, { courses: [...profile.academics.courses, row], coreAtTopLevel: profile.academics.coreAtTopLevel, apExamsPrivate: profile.academics.apExamsPrivate });
      if (!result.ok) setError(result.message);
      else track("course_plan_added", { reason: s.reason });
    });
  };
  const dismiss = () => {
    if (!studentId) return;
    setError(null);
    startTransition(async () => {
      const result = await dismissSuggestion(studentId, s.id);
      if (!result.ok) setError(result.message);
      else track("course_plan_dismissed", { reason: s.reason });
    });
  };

  return (
    <li className="rounded-xl border bg-background p-3">
      <p className="font-semibold">{s.name}</p>
      <p className="mt-0.5">
        {say(s.sentence)}
        {s.evidence
          .filter((e) => e.cite)
          .slice(0, 3)
          .map((e) => (
            <SourceTip key={e.label} cited={e.cite!} className="mx-0.5" />
          ))}
      </p>
      {s.readingLine && <p className="mt-1 text-muted-foreground">{say(s.readingLine)}</p>}
      {changeLine && <p className="mt-1 text-muted-foreground">{say(changeLine)}</p>}
      {s.evidence.some((e) => e.href) && (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {s.evidence
            .filter((e) => e.href)
            .map((e) => (
              <a key={e.href} href={e.href} target="_blank" rel="noreferrer" className="break-words text-primary underline-offset-2 hover:underline">
                {e.label}
              </a>
            ))}
        </p>
      )}
      {editable && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {s.key && (
            <button type="button" onClick={add} disabled={pending} className={cn("h-11 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:h-9")}>
              Add to my plan
            </button>
          )}
          <button type="button" onClick={dismiss} disabled={pending} className="h-11 rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60 sm:h-9">
            Not for me
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/** Marking the schedule chosen also ticks the move (`onDone`, next steps U1b); reopening doesn't untick it. */
function DoneButton({ studentId, done, onDone }: { studentId: string; done: boolean; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markScheduleDone(studentId, !done);
          if (!done) onDone();
        })
      }
      className="h-11 rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60 sm:h-9"
    >
      {done ? "Reopen next year's courses" : "Next year's courses are chosen"}
    </button>
  );
}

/** "Which of these does your school offer?": asked when the school's list isn't on record, kept on the student's profile. */
function SchoolMarks({ plan, studentId }: { plan: CoursePlanView; studentId: string }) {
  const ask = plan.askOffering!;
  const [marks, setMarks] = useState<string[]>(ask.marks);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: string) => setMarks((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));
  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveSchoolOffers(studentId, marks);
      if (!result.ok) setError(result.message);
    });
  };
  return (
    <details className="rounded-xl border bg-background p-3">
      <summary className="cursor-pointer text-sm font-semibold">Which of these does your school offer?</summary>
      <p className="mt-2 text-xs text-muted-foreground">Tap the AP courses your school offers. It stays on your profile and helps the suggestions name real courses.</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {ask.catalog.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              onClick={() => toggle(c.key)}
              aria-pressed={marks.includes(c.key)}
              className={cn("min-h-9 rounded-full border px-3 py-1 text-left text-xs", marks.includes(c.key) ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}
            >
              {c.name.replace(/^AP /, "")}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <button type="button" onClick={save} disabled={pending} className="mt-3 h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:h-9">
        {pending ? "Saving…" : "Save"}
      </button>
    </details>
  );
}

export default NextYearCard;
