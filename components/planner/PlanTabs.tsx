import Link from "next/link";
import { CalendarDays, FileCheck2, Footprints, ListChecks, PenLine } from "lucide-react";
import FamilyCalendar from "@/components/planner/FamilyCalendar";
import { EssaysTab } from "@/components/planner/EssaysTab";
import { NextSteps } from "@/components/planner/NextSteps";
import { PlanOpened } from "@/components/planner/PlanOpened";
import PlanList from "@/components/planner/PlanList";
import OffersStage from "@/components/planner/stages/OffersStage";
import type { CalendarChild } from "@/components/planner/tabs/types";
import type { EssaysTabData } from "@/lib/essays/tab-view";
import { planHref, TAB_LABELS, type PlanTab } from "@/lib/planner/plan-tabs";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const ICONS: Record<PlanTab, typeof ListChecks> = { next: Footprints, colleges: ListChecks, essays: PenLine, calendar: CalendarDays, offers: FileCheck2 };

/**
 * The strip's classes, by width (specs/product/essays/tab.md "The tab strip": one row, always, with four or five tabs).
 * Below `sm` a segmented control that fills the width: equal cells (`grid-flow-col auto-cols-fr`, `gap-1`), each a
 * 44 px link with a 12 px semibold label, no icon, no side padding (the five cells are 68 px at 390; "Next steps" is
 * 62 px in Geist, so `px-1` would leave it 60), nothing wraps, nothing scrolls sideways. From `sm` up the pills as
 * built: icon, 14 px label, `px-4`, one line. Exported for the strip's tests (tests/planner-tab-strip.test.mts).
 */
export const STRIP_RAIL = "grid grid-flow-col auto-cols-fr gap-1 rounded-full bg-card ring-1 ring-border sm:flex sm:flex-nowrap sm:items-center sm:gap-2 sm:bg-transparent sm:ring-0";
export const STRIP_CELL = "inline-flex min-h-11 min-w-0 items-center justify-center rounded-full px-0 text-xs font-semibold whitespace-nowrap transition-colors sm:shrink-0 sm:gap-2 sm:px-4 sm:text-sm";
const CELL_ACTIVE = "bg-foreground text-background";
const CELL_IDLE = "text-muted-foreground hover:text-foreground sm:bg-card sm:ring-1 sm:ring-border";

/**
 * The tab pills alone (specs/planner/redesign/page.md "The page"; essays tab.md "The tab strip"): a segmented control,
 * ink fill on the active tab. Split from the tab body so the desktop frame (`PlanFrame.tsx`) can place it beside the
 * title while a phone keeps it below Next up, above the list.
 */
export function PlanTabPills({ tabs, tab, person }: { tabs: readonly PlanTab[]; tab: PlanTab; person: string | null }) {
  return (
    <div className={STRIP_RAIL} role="tablist" aria-label="Advisor views" data-tab-strip>
      {tabs.map((t) => {
        const Icon = ICONS[t];
        const active = t === tab;
        return (
          <Link key={t} href={planHref({ person, tab: t })} role="tab" aria-selected={active} className={cn(STRIP_CELL, active ? CELL_ACTIVE : CELL_IDLE)}>
            <Icon className="hidden size-4 sm:block" aria-hidden />
            {TAB_LABELS[t]}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The open tab's content (specs/planner/redesign/page.md "The page"): every tab reads the same `ctx`/`view`; the
 * pills that choose among them are `PlanTabPills`, rendered separately by `PlanFrame.tsx`.
 */
export function PlanTabs({
  ctx,
  view,
  tab,
  calendarChild,
  viewer,
  essays = null,
  person = null,
}: {
  ctx: PlanContext;
  view: PlanView;
  tab: PlanTab;
  calendarChild: CalendarChild;
  viewer: "student" | "guardian";
  /** The Essays tab's read (lib/essays/tab-data.ts), present only when that tab is open. */
  essays?: EssaysTabData | null;
  /** The `?for=` links keep (null for a student's own plan). */
  person?: string | null;
}) {
  return (
    <div className="space-y-4">
      <PlanOpened tab={tab} viewer={viewer} everyone={false} studentId={ctx.student?.id ?? null} />
      {tab === "next" && <NextSteps ctx={ctx} view={view} />}
      {tab === "colleges" && <PlanList ctx={ctx} view={view} />}
      {/* Only the student writes a draft (workspace.md "The model": "student drafts only"); a guardian reads. */}
      {tab === "essays" && <EssaysTab ctx={ctx} essays={essays} person={person} canWrite={viewer === "student"} />}
      {
        // eslint-disable-next-line react/no-children-prop -- CalendarTabProps.children is the list of child lanes, by contract
        tab === "calendar" && <FamilyCalendar children={[calendarChild]} viewer={viewer} everyone={false} />
      }
      {tab === "offers" && <OffersStage ctx={ctx} />}
    </div>
  );
}
