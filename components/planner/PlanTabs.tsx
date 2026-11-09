import type { ReactNode } from "react";
import FamilyCalendar from "@/components/planner/FamilyCalendar";
import { EssaysTab } from "@/components/planner/EssaysTab";
import { NextSteps } from "@/components/planner/NextSteps";
import { AskNotice } from "@/components/org/AskNotice";
import PlanList from "@/components/planner/PlanList";
import OffersStage from "@/components/planner/stages/OffersStage";
import { PlanTabPanels } from "@/components/planner/PlanTabSwitch";
import type { CalendarChild } from "@/components/planner/tabs/types";
import type { EssaysTabData } from "@/lib/essays/tab-view";
import type { PlanTab } from "@/lib/planner/plan-tabs";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanTabsRead } from "@/lib/planner/load";
import type { ViewerRole } from "@/lib/viewer-relation";

// The pills and the strip's classes live with the client-side switch; re-exported for the frame and the tests.
export { PlanTabPills, STRIP_CELL, STRIP_RAIL } from "@/components/planner/PlanTabSwitch";

/**
 * The tabs' content (specs/planner/redesign/page.md "The page", "Tabs switch in place"): every tab reads the same
 * `ctx`/`view`, so the server renders each panel in `local` (lib/planner/plan-tabs.ts `switchableTabs`: every tab
 * whose content needs nothing beyond the plan already loaded) plus the open one, once, and `PlanTabPanels` shows the one
 * the URL names. The pills that choose among them are `PlanTabPills`, rendered separately by `PlanFrame.tsx`.
 */
export function PlanTabs({
  ctx,
  view,
  tab,
  local,
  calendarChild,
  viewer,
  essays = null,
  person = null,
  tabsRead = null,
}: {
  ctx: PlanContext;
  view: PlanView;
  /** The tab the page opens on. */
  tab: PlanTab;
  /** The tabs whose panels are rendered here (the open one among them). */
  local: readonly PlanTab[];
  calendarChild: CalendarChild;
  viewer: ViewerRole;
  /** The Essays tab's read (lib/essays/tab-data.ts), made with the plan whenever the page renders. */
  essays?: EssaysTabData | null;
  /** The `?for=` links keep (null for a student's own plan). */
  person?: string | null;
  /** The asks and the Offers stage's data, read with the plan (round 5, lib/planner/load.ts PlanTabsRead). */
  tabsRead?: PlanTabsRead | null;
}) {
  const panel: Record<PlanTab, () => ReactNode> = {
    next: () => (
      <>
        {/* A counselor's asks (specs/product/counselor-portal.md "Asking a student for something"), above the cards. */}
        <AskNotice asks={tabsRead?.asks ?? null} ctx={ctx} />
        <NextSteps ctx={ctx} view={view} />
      </>
    ),
    colleges: () => <PlanList ctx={ctx} view={view} />,
    // Only the student writes a draft (workspace.md "The model": "student drafts only"); a guardian reads.
    essays: () => <EssaysTab ctx={ctx} essays={essays} person={person} canWrite={viewer === "student"} />,
    // eslint-disable-next-line react/no-children-prop -- CalendarTabProps.children is the list of child lanes, by contract
    calendar: () => <FamilyCalendar children={[calendarChild]} viewer={viewer} everyone={false} />,
    offers: () => <OffersStage ctx={ctx} read={tabsRead?.offers ?? null} />,
  };
  const panels: Partial<Record<PlanTab, ReactNode>> = {};
  for (const t of [tab, ...local]) if (!(t in panels)) panels[t] = panel[t]();
  return <PlanTabPanels panels={panels} viewer={viewer} studentId={ctx.student?.id ?? null} />;
}
