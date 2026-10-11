import type { CalendarChild } from "@/components/planner/tabs/types";
import { ImportLocalPlan } from "@/components/planner/ImportLocalPlan";
import { NextUp } from "@/components/planner/NextUp";
import { NothingDue } from "@/components/planner/parents/NothingDue";
import { YourPartLine } from "@/components/planner/parents/YourPartLine";
import PlanIntake from "@/components/planner/intake/PlanIntake";
import { PlanHeaderCard } from "@/components/planner/PlanHeaderCard";
import { PlanNotice } from "@/components/planner/PlanNotice";
import { PlanTabPills, PlanTabs } from "@/components/planner/PlanTabs";
import { UpcomingList } from "@/components/planner/calendar/UpcomingList";
import { intakeNeeded } from "@/lib/planner/intake";
import { nextUpInfo, seasonWords } from "@/lib/planner/plan-frame";
import { defaultTab, planHref, tabsFor, type PlanTab } from "@/lib/planner/plan-tabs";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";

/**
 * One student's plan frame (specs/planner/redesign/page.md "The page", specs/planner/redesign/intake.md): the
 * intake guide in place of everything else when it's needed or requested (`?setup=1`), otherwise the header, Next
 * up (or, with no open deadline, NothingDue), the parent's "Your part" line, the import banner, and the tabs.
 * Desktop (`lg:`) is two columns: left the header with the tab pills beside it, then the open tab's body; right
 * (~380px) Next up/NothingDue, the 8-week "Coming up" list, then the one notice. On a phone everything is one
 * column: header, Next up (or NothingDue), Your part, the tab pills, then the open tab's body. Used for a student's
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
  /** `?setup=1`: the ✎ on the numbers line opens the intake guide in edit mode, prefilled, starting at Review. */
  setup: boolean;
}) {
  const today = ctx.today;
  const studentId = ctx.student?.id ?? personId ?? "";
  const gradYear = ctx.student?.grad_year ?? null;

  const anyOpenDeadline = view.rows.some(
    (r) => (r.item.status === "considering" || r.item.status === "applying") && !r.item.withdrawn_on && r.deadline !== null && r.deadline.iso >= today,
  );
  const anyApplied = ctx.items.some((i) => i.status === "applied" || i.status === "decided");
  const season = seasonWords({ today, cycleStartYear: ctx.cycle.startYear, anyOpenDeadline, anyApplied });

  const hasDecision = ctx.items.some((i) => i.status === "decided" || i.decision_date !== null);
  const tabs = tabsFor({ everyone: false, hasDecision });
  const viewer = relation === "self" ? "student" : "guardian";
  const openTab = tabs.includes(tab) ? tab : defaultTab(viewer, false);

  const calendarChild: CalendarChild = { studentId, name: firstName ?? "Student", colorSlot, ring: true, gradYear, ctx, view };

  const needsIntake = intakeNeeded(ctx);
  // The intake guide shows instead of the whole frame (decision 1): no header, no Next up, no tabs underneath it.
  // Never for a read-only viewer — a guardian without edit rights who opens a child with no numbers just sees the
  // plan, with "No numbers yet" in the header (PlanHeaderCard).
  if (ctx.viewer.canEdit && (setup || needsIntake)) {
    return <PlanIntake ctx={ctx} view={view} mode={needsIntake ? "first" : "edit"} relation={relation} firstName={firstName} />;
  }

  // NothingDue instead of Next up (page.md "The page"): nothing dated to meet or hear back on yet.
  const nextKind = nextUpInfo({ view, today, cycleStartYear: ctx.cycle.startYear }).kind;
  const hasNextUp = nextKind === "deadline" || nextKind === "decision";

  const calendarHref = planHref({ person: personId, tab: "calendar" });
  const fullYearHref = `${calendarHref}${calendarHref.includes("?") ? "&" : "?"}range=year`;

  const nextUpCard = hasNextUp ? (
    <NextUp view={view} today={today} cycleStartYear={ctx.cycle.startYear} />
  ) : (
    <NothingDue gradYear={gradYear} season={season} relation={relation} firstName={firstName} />
  );

  const pills = <PlanTabPills tabs={tabs} tab={openTab} person={personId} hasRetake={view.retake !== null} />;

  return (
    <div className="lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-6">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <PlanHeaderCard ctx={ctx} view={view} relation={relation} firstName={firstName} season={season} />
          <div className="hidden lg:block">{pills}</div>
        </div>
        <div className="lg:hidden">{nextUpCard}</div>
        {relation === "guardian" && <YourPartLine ctx={ctx} firstName={firstName} />}
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
