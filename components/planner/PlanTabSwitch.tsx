"use client";

import { createContext, useContext, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, FileCheck2, Footprints, ListChecks, PenLine } from "lucide-react";
import { PlanOpened } from "@/components/planner/PlanOpened";
import { openTabFor, panelOnceKey, planHref, TAB_LABELS, type PlanTab } from "@/lib/planner/plan-tabs";
import { cn } from "@/lib/utils";
import type { ViewerRole } from "@/lib/viewer-relation";

/**
 * The advisor's tab switch in the browser (specs/planner/redesign/page.md "Tabs switch in place"; round 4, U3). The
 * server renders every panel it can from the plan it already loaded (components/planner/PlanTabs.tsx) and this shows
 * the one the URL's `?tab=` names. A pill is still a real link (`?tab=…`), so a full load, a new window, the back
 * button, and a browser without JavaScript work as before; a plain click on a tab whose panel is here writes the URL
 * with `window.history.pushState` instead of navigating, and `useSearchParams` (which Next keeps in step with
 * `pushState` and the back button) moves every reader of the tab at once: both pill strips and the panels. A tab
 * whose panel needs its own server reads (`switchableTabs`, lib/planner/plan-tabs.ts) keeps its pill a navigation.
 */

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

interface TabState {
  tabs: readonly PlanTab[];
  /** The tab the server rendered this page for (its panel is always here). */
  opened: PlanTab;
  /** What an unrecognized or missing `?tab=` opens (`defaultTab`). */
  fallback: PlanTab;
  /** The tabs whose panels are on the page (`switchableTabs`). */
  local: readonly PlanTab[];
}

const TabContext = createContext<TabState | null>(null);

/** Holds what the pills and the panels both need; wraps the frame (components/planner/PlanFrame.tsx). */
export function PlanTabProvider({ children, ...state }: TabState & { children: ReactNode }) {
  return <TabContext.Provider value={state}>{children}</TabContext.Provider>;
}

/**
 * The open tab: the URL's, when its panel is here; otherwise the one the server opened (a URL naming a tab this page
 * didn't render can only come from history the router restores with its own page, so this is a fallback, not a path).
 */
function useOpenTab(state: TabState | null, fallbackTab: PlanTab): PlanTab {
  const params = useSearchParams();
  if (!state) return fallbackTab;
  const t = openTabFor(params?.get("tab") ?? null, state.tabs, state.fallback);
  return state.local.includes(t) ? t : state.opened;
}

/** A left click with no modifier on a link: the one a page may take over (a new tab or window stays the browser's). */
function plainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/**
 * Switches to `tab` in place when its panel is here: the URL first (`pushState`), which every reader follows. A click
 * on the address already showing adds no history entry.
 */
function switchTo(e: MouseEvent<HTMLAnchorElement>, href: string, tab: PlanTab, state: TabState | null): void {
  if (!state || !state.local.includes(tab) || !plainClick(e)) return;
  e.preventDefault();
  const to = new URL(href, window.location.href);
  if (to.pathname === window.location.pathname && to.search === window.location.search) return;
  window.history.pushState(null, "", href);
}

/**
 * The tab pills alone (specs/planner/redesign/page.md "The page"; essays tab.md "The tab strip"): a segmented control,
 * ink fill on the open tab. Rendered twice by `PlanFrame.tsx` (beside the title on a desktop, below Next up on a
 * phone); both read the open tab from the URL. `tab` is the server's choice, used when there is no provider (tests).
 */
export function PlanTabPills({ tabs, tab, person }: { tabs: readonly PlanTab[]; tab: PlanTab; person: string | null }) {
  const state = useContext(TabContext);
  const open = useOpenTab(state, tab);
  return (
    <div className={STRIP_RAIL} role="tablist" aria-label="Advisor views" data-tab-strip>
      {tabs.map((t) => {
        const Icon = ICONS[t];
        const active = t === open;
        const href = planHref({ person, tab: t });
        const local = state?.local.includes(t) ?? false;
        return (
          <Link
            key={t}
            href={href}
            // A tab switched in place needs nothing from the server; one that navigates keeps the default prefetch.
            prefetch={local ? false : undefined}
            onClick={(e) => switchTo(e, href, t, state)}
            role="tab"
            aria-selected={active}
            data-switch={local ? "client" : "server"}
            className={cn(STRIP_CELL, active ? CELL_ACTIVE : CELL_IDLE)}
          >
            <Icon className="hidden size-4 sm:block" aria-hidden />
            {TAB_LABELS[t]}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Any other link to a tab of this plan (the essay count, in the aside and above the list): switches in place like a
 * pill when it can; outside the frame (no provider) a plain link.
 */
export function PlanTabLink({ tab, person, className, children }: { tab: PlanTab; person: string | null; className?: string; children: ReactNode }) {
  const state = useContext(TabContext);
  const href = planHref({ person, tab });
  const local = state?.local.includes(tab) ?? false;
  return (
    <Link href={href} prefetch={local ? false : undefined} onClick={(e) => switchTo(e, href, tab, state)} className={className}>
      {children}
    </Link>
  );
}

/**
 * The panels: the open one shown, the others `hidden`. A panel mounts the first time it is shown and then stays
 * (hidden, never unmounted and mounted again on a switch), so a page that opens on one tab hydrates only that one and
 * the hidden ones run no effects (the Colleges list's, the calendar's "opened" event) until they are opened. When a
 * navigation brings parameters a panel reads once on mount (`panelOnceKey`: a move to scroll to, a row's ED sheet,
 * the calendar's range), the panels mount again so they act on them; a switch (whose URL drops them) doesn't.
 * Reports `plan_opened` for each tab shown (PlanOpened).
 */
export function PlanTabPanels({ panels, viewer, studentId }: { panels: Partial<Record<PlanTab, ReactNode>>; viewer: ViewerRole; studentId: string | null }) {
  const state = useContext(TabContext);
  const params = useSearchParams();
  const fallback = (Object.keys(panels)[0] as PlanTab | undefined) ?? "next";
  const open = useOpenTab(state, state?.opened ?? fallback);
  // A new server render (navigation or refresh) brings new panel elements: read the once-parameters then, not on a switch.
  const [seen, setSeen] = useState(() => ({ panels, key: panelOnceKey((k) => params?.get(k) ?? null) }));
  if (seen.panels !== panels) setSeen({ panels, key: panelOnceKey((k) => params?.get(k) ?? null) });
  return (
    <>
      <PlanOpened tab={open} viewer={viewer} everyone={false} studentId={studentId} />
      <Panels key={seen.key} panels={panels} open={open} />
    </>
  );
}

function Panels({ panels, open }: { panels: Partial<Record<PlanTab, ReactNode>>; open: PlanTab }) {
  const [shown, setShown] = useState<ReadonlySet<PlanTab>>(() => new Set([open]));
  if (!shown.has(open)) setShown(new Set([...shown, open]));
  return (
    <>
      {(Object.keys(panels) as PlanTab[])
        .filter((t) => shown.has(t) || t === open)
        .map((t) => (
          <div key={t} id={`plan-panel-${t}`} role="tabpanel" data-tab-panel={t} hidden={t !== open} className="space-y-4">
            {panels[t]}
          </div>
        ))}
    </>
  );
}
