"use client";
/**
 * "All N events" (specs/product/visit-events.md "Display"): expands the full, filterable list in place under the
 * college page's Upcoming visits block — no new route needed. Fires `visit_events_viewed` on mount and whenever the
 * kind filter changes.
 */
import { useEffect, useMemo, useState } from "react";
import { track } from "@/lib/analytics";
import { matchesChip, type VisitChipKey } from "@/lib/visit-events/view";
import { isShownKind } from "@/lib/visit-events/types";
import { VisitFilters } from "@/components/visits/VisitFilters";
import { VisitEventList, type VisitListItem } from "@/components/visits/VisitEventList";

const CHIP_KEYS: VisitChipKey[] = ["tour", "info_session", "travel", "online", "all"];

export function VisitEventsExpand({
  events,
  schoolName,
  surface = "profile",
  alwaysOpen = false,
}: {
  events: readonly VisitListItem[];
  schoolName: string;
  surface?: "profile" | "me" | "planner";
  /** The event calendar view: the full list is open from the start and there is no toggle. */
  alwaysOpen?: boolean;
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
  const filtered = useMemo(
    () => nonStaff.filter((e) => matchesChip(e.kind, chip) && (chip !== "travel" || !stateFilter || e.state === stateFilter)),
    [nonStaff, chip, stateFilter],
  );
  const counts = useMemo(() => {
    const out: Partial<Record<VisitChipKey, number>> = {};
    for (const c of CHIP_KEYS) out[c] = nonStaff.filter((e) => matchesChip(e.kind, c)).length;
    return out;
  }, [nonStaff]);

  if (nonStaff.length === 0) return null;

  return (
    <div className="mt-5">
      {!alwaysOpen && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-bold text-primary hover:underline">
          {expanded ? "Show fewer" : `All ${nonStaff.length} events`}
        </button>
      )}
      {expanded && (
        <div className="mt-3 space-y-3">
          <VisitFilters value={chip} onChange={setChip} states={states} stateValue={stateFilter} onStateChange={setStateFilter} counts={counts} />
          <VisitEventList events={filtered} schoolName={schoolName} emptyMessage="Nothing in this filter yet." />
        </div>
      )}
    </div>
  );
}
