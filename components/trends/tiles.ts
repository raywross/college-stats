/**
 * Plain-data helpers that turn a study file's groups into SmallMultiples props (server side; no "use client", no
 * functions cross to the client). See components/trends/SmallMultiples.tsx.
 */
import type { TrendSeries } from "@/components/charts/TrendLine";
import type { SmallMultipleGrouping } from "@/components/trends/SmallMultiples";
import type { GroupingResult } from "@/lib/trends";

/**
 * Each grouping's groups as tiles: `tile(values)` gives a group's series and summary line; groups under the floor
 * become "too few colleges to say" tiles with their count.
 */
export function groupingTiles<V>(
  groupings: readonly GroupingResult<V>[],
  tile: (values: V) => { series: TrendSeries[]; summary?: string }
): SmallMultipleGrouping[] {
  return groupings.map((g) => ({
    key: g.grouping,
    label: g.label,
    floor: g.floor,
    tiles: g.groups.map((r) =>
      r.tooFew || !r.values ? { key: r.key, label: r.label, n: r.n, tooFew: true } : { key: r.key, label: r.label, n: r.n, ...tile(r.values) }
    ),
  }));
}

/** "rose", "fell", or "held steady", for takeaway sentences whose numbers come from the file. */
export function direction(from: number, to: number, epsilon = 0.005): "rose" | "fell" | "held steady" {
  return to - from > epsilon ? "rose" : from - to > epsilon ? "fell" : "held steady";
}
