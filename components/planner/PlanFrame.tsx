import type { CalendarChild } from "@/components/planner/tabs/types";
import FirstTimeSetup from "@/components/planner/FirstTimeSetup";
import { GradYearPrompt } from "@/components/planner/GradYearPrompt";
import { ImportLocalPlan } from "@/components/planner/ImportLocalPlan";
import { NextUp } from "@/components/planner/NextUp";
import { PlanHeaderCard } from "@/components/planner/PlanHeaderCard";
import { PlanTabs } from "@/components/planner/PlanTabs";
import { StuckSignals } from "@/components/planner/parents/StuckSignals";
import { WhatParentsSee } from "@/components/planner/parents/WhatParentsSee";
import { firstTimeNeeded, seasonWords } from "@/lib/planner/plan-frame";
import { defaultTab, tabsFor, type PlanTab } from "@/lib/planner/plan-tabs";
import type { PlanView } from "@/lib/planner/plan-view";
import { addDays } from "@/lib/planner/stage";
import { NO_MONEY, stuckSignals, summaryLine } from "@/lib/planner/summary";
import type { PlanContext } from "@/lib/planner/types";

/**
 * One student's plan frame (specs/planner/redesign/page.md "The page"): the header card and Next up side by side,
 * the stuck signals, "What your parents see" for the student's own view, then either the first-time setup or the
 * open tab. Used for a student's own `/plan` and for a guardian's selected child; "Everyone" (page.md "The child
 * switcher") has no single student to show a header card for, so it renders the calendar directly instead.
 */
export function PlanFrame({
  ctx,
  view,
  relation,
  firstName,
  color,
  colorSlot,
  personId,
  tab,
}: {
  ctx: PlanContext;
  view: PlanView;
  relation: "self" | "guardian";
  firstName: string | null;
  /** The household color for the header card's initial and the calendar lane (lib/planner/colors.ts KID_VARS). */
  color: string;
  colorSlot: 0 | 1 | 2;
  /** The student id for `?for=` links; null when a student is looking at their own plan. */
  personId: string | null;
  tab: PlanTab;
}) {
  const today = ctx.today;
  const studentId = ctx.student?.id ?? personId ?? "";
  const gradYear = ctx.student?.grad_year ?? null;

  const anyOpenDeadline = view.rows.some(
    (r) => (r.item.status === "considering" || r.item.status === "applying") && !r.item.withdrawn_on && r.deadline !== null && r.deadline.iso >= today,
  );
  const anyApplied = ctx.items.some((i) => i.status === "applied" || i.status === "decided");
  const season = seasonWords({ today, cycleStartYear: ctx.cycle.startYear, anyOpenDeadline, anyApplied });

  // The summary line and stuck signals (specs/planner/parents.md): computed, never stored, same for the guardian
  // and the student. No net-price estimate exists yet (NO_MONEY), so the ED-with-no-estimate signal always reads
  // that way until the estimator fills rounds.ts's MoneyInput seam.
  const signals = stuckSignals({ items: ctx.items, tasks: ctx.tasks, visits: ctx.visits, schools: ctx.schools, money: NO_MONEY, cycle: ctx.cycle, grade: ctx.grade, today });
  const summary = summaryLine({ current: ctx.current, stages: ctx.stages, tasks: ctx.tasks, items: ctx.items, schools: ctx.schools, visits: ctx.visits, today });
  const weekAgo = addDays(today, -7);
  const tickedThisWeek = ctx.tasks.filter((t) => t.done_at !== null && t.done_at.slice(0, 10) >= weekAgo).map((t) => t.title);

  const hasDecision = ctx.items.some((i) => i.status === "decided" || i.decision_date !== null);
  const tabs = tabsFor({ everyone: false, hasDecision });
  const viewer = relation === "self" ? "student" : "guardian";
  const openTab = tabs.includes(tab) ? tab : defaultTab(viewer, false);

  const calendarChild: CalendarChild = { studentId, name: firstName ?? "Student", colorSlot, ring: true, gradYear, ctx, view };

  return (
    <div className="space-y-6">
      {gradYear === null && (
        <GradYearPrompt
          studentId={studentId}
          years={[0, 1, 2, 3, 4, 5].map((n) => Number(today.slice(0, 4)) + n)}
          canEdit={ctx.viewer.canEdit}
          firstName={relation === "self" ? null : firstName}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <PlanHeaderCard ctx={ctx} view={view} relation={relation} firstName={firstName} season={season} color={color} />
        <NextUp view={view} today={today} cycleStartYear={ctx.cycle.startYear} />
      </div>
      <StuckSignals signals={signals} />
      {relation === "self" && <ImportLocalPlan studentId={studentId} canEdit={ctx.viewer.canEdit} />}
      {relation === "self" && <WhatParentsSee summary={summary} stuckSignals={signals.map((s) => s.text)} tickedThisWeek={tickedThisWeek} />}
      {firstTimeNeeded(view) ? (
        <FirstTimeSetup ctx={ctx} view={view} />
      ) : (
        <PlanTabs ctx={ctx} view={view} tabs={tabs} tab={openTab} person={personId} hasRetake={view.retake !== null} calendarChild={calendarChild} viewer={viewer} />
      )}
    </div>
  );
}
