"use client";
/**
 * The filterable event list (specs/product/visit-events.md "Display"): the kind chips, then the rows. On the college's
 * event calendar it is open from the start and is the whole page below the title (`alwaysOpen`); elsewhere it opens
 * from an "All N events" link. "Near me" measures the travel calendar from the viewer (`near`): the events within
 * their radius, or one state picked from the select at any distance. Fires `visit_events_viewed` on mount and
 * whenever the kind filter changes.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import { chipEvents, matchesChip, type NearMeScope, type VisitChipKey } from "@/lib/visit-events/view";
import { isShownKind } from "@/lib/visit-events/types";
import { VisitFilters } from "@/components/visits/VisitFilters";
import { VisitEventList, type VisitListItem } from "@/components/visits/VisitEventList";

const CHIP_KEYS: VisitChipKey[] = ["tour", "info_session", "travel", "online", "all"];

export function VisitEventsExpand({
  events,
  schoolName,
  surface = "profile",
  alwaysOpen = false,
  near = null,
}: {
  events: readonly VisitListItem[];
  schoolName: string;
  surface?: "profile" | "me" | "planner";
  /** The event calendar view: the full list is open from the start and there is no toggle. */
  alwaysOpen?: boolean;
  /** The viewer's measuring point and radius for "Near me"; null when they have neither a home nor a located high school. */
  near?: NearMeScope | null;
}) {
  const [expanded, setExpanded] = useState(alwaysOpen);
  const [chip, setChip] = useState<VisitChipKey>("all");
  const [stateFilter, setStateFilter] = useState<string | null>(null);

  const nonStaff = useMemo(() => events.filter((e) => isShownKind(e.kind)), [events]);

  useEffect(() => {
    if (!expanded) return;
    track("visit_events_viewed", { surface, kind: chip });
  }, [expanded, surface, chip]);

  const states = useMemo(() => [...new Set(nonStaff.filter((e) => e.kind === "travel" && e.state).map((e) => e.state as string))].sort(), [nonStaff]);
  const filtered = useMemo(() => chipEvents(nonStaff, chip, { state: stateFilter, near }), [nonStaff, chip, stateFilter, near]);
  const counts = useMemo(() => {
    const out: Partial<Record<VisitChipKey, number>> = {};
    for (const c of CHIP_KEYS) out[c] = nonStaff.filter((e) => matchesChip(e.kind, c)).length;
    return out;
  }, [nonStaff]);

  if (nonStaff.length === 0) return null;

  const nearMe = chip === "travel";
  const withinRadius = nearMe && near && !stateFilter;
  const emptyMessage = withinRadius ? `Nothing within ${near.radiusMiles} miles of ${near.label} yet. Pick a state to see where ${schoolName} is going.` : "Nothing in this filter yet.";

  return (
    <div className={alwaysOpen ? "" : "mt-5"}>
      {!alwaysOpen && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-bold text-primary hover:underline">
          {expanded ? "Show fewer" : `All ${nonStaff.length} events`}
        </button>
      )}
      {expanded && (
        <div className={alwaysOpen ? "space-y-3" : "mt-3 space-y-3"}>
          <VisitFilters
            value={chip}
            onChange={setChip}
            states={states}
            stateValue={stateFilter}
            onStateChange={setStateFilter}
            counts={counts}
            allStatesLabel={near ? `Within ${near.radiusMiles} miles` : "Every state"}
          />
          {nearMe && (
            <p className="text-xs text-muted-foreground">
              {near ? (
                <>
                  Measuring from {near.label}. Change the radius or point on{" "}
                  <Link href="/account#visit-alerts" className="font-semibold text-primary hover:underline">
                    your account page
                  </Link>
                  .
                </>
              ) : (
                <>
                  Add a home or high school on{" "}
                  <Link href="/household" className="font-semibold text-primary hover:underline">
                    your household page
                  </Link>{" "}
                  to measure these from you. Until then, this is everywhere {schoolName} is going.
                </>
              )}
            </p>
          )}
          <VisitEventList events={filtered} schoolName={schoolName} near={nearMe} emptyMessage={emptyMessage} />
        </div>
      )}
    </div>
  );
}
