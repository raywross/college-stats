import type { ReactNode } from "react";
import type { CalendarChild } from "@/components/planner/tabs/types";
import { ImportLocalPlan } from "@/components/planner/ImportLocalPlan";
import { NextUp } from "@/components/planner/NextUp";
import PlanIntake from "@/components/planner/intake/PlanIntake";
import { PlanNotice } from "@/components/planner/PlanNotice";
import { PlanTabPills, PlanTabs } from "@/components/planner/PlanTabs";
import { UpcomingList } from "@/components/planner/calendar/UpcomingList";
import { intakeNeeded } from "@/lib/planner/intake";
import type { RecordBack } from "@/lib/planner/record";
import { roundsPicked } from "@/lib/planner/list-row";
import { nextUpInfo } from "@/lib/planner/plan-frame";
import { defaultTab, planHref, tabsFor, type PlanTab } from "@/lib/planner/plan-tabs";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";

/**
 * One student's plan frame (specs/planner/redesign/page.md "The page", specs/planner/redesign/intake.md): the
 * intake guide in place of everything else when it's needed or requested (`?setup=1`), otherwise the people line
 * (`people`: initials, the selected student's chip with numbers and Edit), Next up when something dated is coming,
 * the import banner, and the tabs. Desktop (`lg:`) is two columns: left the people line with the tab pills beside
 * it, then the open tab's body; right (~380px) Next up, the 8-week "Coming up" list, then the one notice. On a phone
 * everything is one column. The big name heading, the status text, "Your part", and the "nothing due" card left
 * the top of the plan (owner, 2026-10-12); their helpers stay. Used for a student's
 * own `/plan` and for a guardian's selected child — a guardian's `/plan` always resolves to one child now (decision
 * 2026-10-11: no Everyone; lib/planner/plan-frame.ts resolveSelectedChild).
 */
export function PlanFrame({
  ctx,
  view,
  relation,
  firstName,
  colorSlot,
  personId,
  tab,
  setup,
  back,
  people,
}: {
  ctx: PlanContext;
  view: PlanView;
  relation: "self" | "guardian";
  firstName: string | null;
  /** The household color slot for the calendar lane (lib/planner/colors.ts KID_VARS); 0 for a student's own view. */
  colorSlot: 0 | 1 | 2;
  /** The student id for `?for=` links; null when a student is looking at their own plan. */
  personId: string | null;
  tab: PlanTab;
  /** `?setup=1` or `?record=1`: the people line's Edit opens the tour in edit mode, prefilled, starting at Review. */
  setup: boolean;
  /** `?back=plan|record|inline` (record/steps.md "Edit mode"): where saving or closing the tour in edit mode returns to. */
  back?: RecordBack;
  /** The plan's one top line (components/planner/PlanPeople.tsx), built by the page. */
  people?: ReactNode;
}) {
  const today = ctx.today;
  const studentId = ctx.student?.id ?? personId ?? "";
  const gradYear = ctx.student?.grad_year ?? null;

  // Before senior year the rows read "Round picked senior year" (list.md), so no deadline counts yet: the starting
  // round's dates are a guess that would otherwise surface as Next up (QA 2026-10-11).
  const roundsOpen = roundsPicked(ctx.grade);

  const hasDecision = ctx.items.some((i) => i.status === "decided" || i.decision_date !== null);
  const tabs = tabsFor({ everyone: false, hasDecision });
  const viewer = relation === "self" ? "student" : "guardian";
  const openTab = tabs.includes(tab) ? tab : defaultTab(viewer, false);

  const calendarChild: CalendarChild = { studentId, name: firstName ?? "Student", colorSlot, ring: true, gradYear, ctx, view };

  const needsIntake = intakeNeeded(ctx);
  // The intake guide shows instead of the whole frame (decision 1): no header, no Next up, no tabs underneath it.
  // Never for a read-only viewer — a guardian without edit rights who opens a child with no numbers just sees the
  // plan, with "No numbers yet" on the people line. A guardian keeps the people line above it to switch children.
  if (ctx.viewer.canEdit && (setup || needsIntake)) {
    const intake = <PlanIntake ctx={ctx} view={view} mode={needsIntake ? "first" : "edit"} relation={relation} firstName={firstName} back={back} />;
    return relation === "guardian" && people ? (
      <div className="space-y-6">
        {people}
        {intake}
      </div>
    ) : (
      intake
    );
  }

  // Next up only when something dated is coming (the "nothing due" card left the top of the plan, owner 2026-10-12).
  const nextKind = nextUpInfo({ view, today, cycleStartYear: ctx.cycle.startYear }).kind;
  const hasNextUp = roundsOpen && (nextKind === "deadline" || nextKind === "decision");

  const calendarHref = planHref({ person: personId, tab: "calendar" });
  const fullYearHref = `${calendarHref}${calendarHref.includes("?") ? "&" : "?"}range=year`;

  const nextUpCard = hasNextUp ? <NextUp view={view} today={today} cycleStartYear={ctx.cycle.startYear} /> : null;

  const pills = <PlanTabPills tabs={tabs} tab={openTab} person={personId} />;

  return (
    <div className="lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">{people}</div>
          <div className="hidden shrink-0 lg:block">{pills}</div>
        </div>
        {nextUpCard && <div className="lg:hidden">{nextUpCard}</div>}
        {relation === "self" && <ImportLocalPlan studentId={studentId} canEdit={ctx.viewer.canEdit} />}
        <div className="space-y-4">
          <div className="lg:hidden">{pills}</div>
          <PlanTabs ctx={ctx} view={view} tab={openTab} calendarChild={calendarChild} viewer={viewer} />
        </div>
      </div>
      <aside className="mt-6 hidden space-y-4 lg:top-6 lg:mt-0 lg:block lg:sticky">
        {nextUpCard}
        <UpcomingList ctx={ctx} view={view} studentId={studentId} variant="aside" fullYearHref={fullYearHref} />
        <PlanNotice ctx={ctx} view={view} />
      </aside>
    </div>
  );
}
