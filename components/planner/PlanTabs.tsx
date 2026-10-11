import Link from "next/link";
import { CalendarDays, FileCheck2, ListChecks, Target } from "lucide-react";
import FamilyCalendar from "@/components/planner/FamilyCalendar";
import { PlanOpened } from "@/components/planner/PlanOpened";
import PlanList from "@/components/planner/PlanList";
import ScoresTab from "@/components/planner/ScoresTab";
import OffersStage from "@/components/planner/stages/OffersStage";
import type { CalendarChild } from "@/components/planner/tabs/types";
import { planHref, TAB_LABELS, type PlanTab } from "@/lib/planner/plan-tabs";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

const ICONS: Record<PlanTab, typeof ListChecks> = { colleges: ListChecks, scores: Target, calendar: CalendarDays, offers: FileCheck2 };

/**
 * The open tabs and the one currently shown (specs/planner/redesign/page.md "The page"): links, so back and
 * forward work; a dot on Scores when a retake suggestion is live; Colleges, Scores, Calendar, and Offers once any
 * college has a decision, each handed the same `ctx`/`view` every tab reads.
 */
export function PlanTabs({
  ctx,
  view,
  tabs,
  tab,
  person,
  hasRetake,
  calendarChild,
  viewer,
}: {
  ctx: PlanContext;
  view: PlanView;
  tabs: readonly PlanTab[];
  tab: PlanTab;
  person: string | null;
  hasRetake: boolean;
  calendarChild: CalendarChild;
  viewer: "student" | "guardian";
}) {
  return (
    <div className="space-y-4">
      <PlanOpened tab={tab} viewer={viewer} everyone={false} />
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Plan views">
        {tabs.map((t) => {
          const Icon = ICONS[t];
          const active = t === tab;
          return (
            <Link
              key={t}
              href={planHref({ person, tab: t })}
              role="tab"
              aria-selected={active}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
                active ? "bg-foreground text-background" : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {TAB_LABELS[t]}
              {t === "scores" && hasRetake && <span className="size-2 rounded-full bg-pop" aria-label="A retake suggestion is ready" />}
            </Link>
          );
        })}
      </div>
      {tab === "colleges" && <PlanList ctx={ctx} view={view} />}
      {tab === "scores" && <ScoresTab ctx={ctx} view={view} />}
      {
        // eslint-disable-next-line react/no-children-prop -- CalendarTabProps.children is the list of child lanes, by contract
        tab === "calendar" && <FamilyCalendar children={[calendarChild]} viewer={viewer} everyone={false} />
      }
      {tab === "offers" && <OffersStage ctx={ctx} />}
    </div>
  );
}
