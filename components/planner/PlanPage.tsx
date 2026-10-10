import type { PersonPage } from "@/lib/households";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadPlanFor } from "@/lib/planner/load";
import { tabForStage } from "@/lib/planner/plan-tabs";
import { addDays } from "@/lib/planner/stage";
import { NO_MONEY, stuckSignals, summaryLine } from "@/lib/planner/summary";
import type { PlanContext, Stage } from "@/lib/planner/types";
import { GradYearPrompt } from "@/components/planner/GradYearPrompt";
import { PlanOpened } from "@/components/planner/PlanOpened";
import { StageStrip } from "@/components/planner/StageStrip";
import { ThisWeek } from "@/components/planner/ThisWeek";
import { StuckSignals } from "@/components/planner/parents/StuckSignals";
import { WhatParentsSee } from "@/components/planner/parents/WhatParentsSee";
import { Term } from "@/components/ui/info-tip";
import ListStage from "@/components/planner/stages/ListStage";
import RoundsStage from "@/components/planner/stages/RoundsStage";
import ActionsStage from "@/components/planner/stages/ActionsStage";
import TimelineStage from "@/components/planner/stages/TimelineStage";
import ApplyStage from "@/components/planner/stages/ApplyStage";
import OffersStage from "@/components/planner/stages/OffersStage";

const PANELS: Record<Stage, (props: { ctx: PlanContext }) => React.ReactNode> = {
  1: ListStage,
  2: RoundsStage,
  3: ActionsStage,
  4: TimelineStage,
  5: ApplyStage,
  6: OffersStage,
};

type StudentPerson = Extract<PersonPage, { kind: "student" }>;

/**
 * The Plan tab's frame (specs/planner/model.md "Where it lives"), under the person area on a student's page:
 *
 *   [class year prompt, when the student has none]
 *   stage strip: six pills with a count each (?stage=N opens another)
 *   the open stage's panel (components/planner/stages/*)
 *   This week
 *   the timeline's month view (TimelineStage), unless the timeline is the open panel
 *
 * A server component. It reads the plan once with the viewer's session, regenerates the tasks (cheap and idempotent:
 * a data publish moves dates; only someone who can edit writes), builds the PlanContext, and hands it to the panels.
 * A guardian's view is logged for the student, like their list and numbers.
 */
export async function PlanPage({ personId, person, stage }: { personId: string; person: StudentPerson; stage: Stage | null }) {
  const { student, relation } = person.access;
  const first = student.display_name?.trim().split(/\s+/)[0] || null;

  // The read, the suggested groups and rounds, the task regeneration, and the context (lib/planner/load.ts).
  const loaded = await loadPlanFor(student.id, person.access);
  if (loaded.kind === "not-found") return null;
  if (loaded.kind === "empty") {
    return (
      <section className="rounded-3xl border bg-card p-5 sm:p-6">
        <h2 className="font-display text-xl font-bold">No list yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">The plan starts from {first ? `${first}'s` : "the"} list. Colleges added from a college&apos;s page, Explore, or Compare show up there.</p>
      </section>
    );
  }
  if (loaded.kind === "setup-missing") {
    return (
      <section className="rounded-3xl border bg-card p-5 sm:p-6">
        <h2 className="font-display text-xl font-bold">The plan isn&apos;t set up yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">The planner&apos;s tables haven&apos;t been added to the database. The list still works.</p>
      </section>
    );
  }
  const { ctx } = loaded;
  const { canEdit } = ctx.viewer;
  const gradYear = ctx.student?.grad_year ?? null;
  const today = ctx.today;
  const supabase = await createServerSupabase();
  const open = stage ?? ctx.current;
  const Panel = PANELS[open];
  const thisYear = Number(today.slice(0, 4));

  // The summary line and stuck signals (specs/planner/parents.md): computed, never stored, same for the guardian
  // and the student. No net-price estimate exists yet (NO_MONEY), so the ED-with-no-estimate signal always reads
  // that way until the estimator fills `rounds.ts`'s MoneyInput seam.
  const summary = summaryLine({ current: ctx.current, stages: ctx.stages, tasks: ctx.tasks, items: ctx.items, schools: ctx.schools, visits: ctx.visits, today });
  const signals = stuckSignals({ items: ctx.items, tasks: ctx.tasks, visits: ctx.visits, schools: ctx.schools, money: NO_MONEY, cycle: ctx.cycle, grade: ctx.grade, today });
  const weekAgo = addDays(today, -7);
  const tickedThisWeek = ctx.tasks.filter((t) => t.done_at !== null && t.done_at.slice(0, 10) >= weekAgo).map((t) => t.title);

  // Whether the student has turned off nudge emails (specs/planner/parents.md's "Alex reads nudges in the plan"),
  // read through the security-definer function so a guardian never reads the student's own preferences row.
  let nudgeEmailsOff = false;
  if (relation === "guardian") {
    try {
      const { data } = await supabase.rpc("student_nudge_emails_off", { p_student: student.id });
      nudgeEmailsOff = data === true;
    } catch {
      nudgeEmailsOff = false;
    }
  }

  return (
    <div className="space-y-6">
      <PlanOpened tab={tabForStage(open)} viewer={relation === "self" ? "student" : "guardian"} everyone={false} />
      {gradYear === null && (
        <GradYearPrompt studentId={student.id} years={[0, 1, 2, 3, 4, 5].map((n) => thisYear + n)} canEdit={canEdit} firstName={relation === "self" ? null : first} />
      )}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {relation === "self" ? "Your" : first ? `${first}'s` : "The"} <Term term="plan">plan</Term>, in six <Term term="stage">stages</Term>. Open any of
          them; they&apos;re a map, not a gate.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{summary}</p>
          {relation === "self" && <WhatParentsSee summary={summary} stuckSignals={signals.map((s) => s.text)} tickedThisWeek={tickedThisWeek} />}
        </div>
        <StageStrip ctx={ctx} open={open} basePath={`/household/${personId}/plan`} />
      </div>
      <StuckSignals signals={signals} />
      <Panel ctx={ctx} />
      <ThisWeek ctx={ctx} nudgeEmailsOff={nudgeEmailsOff} />
      {open !== 4 && <TimelineStage ctx={ctx} />}
    </div>
  );
}
