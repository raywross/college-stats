"use client";

import { useState } from "react";
import { StateTileMap, type TileRange } from "@/components/charts/StateTileMap";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type StateMapKey = "undergradChange" | "acceptanceRate" | "avgCost" | "outOfState" | "testOptionalShare";

/** How a measure's value is printed; kept as data (never a function prop) so this stays a plain server→client payload. */
export type StateMapFormat = "signedPct" | "pctWhole" | "moneyK";

export interface StateMapMeasureDef {
  key: StateMapKey;
  label: string;
  legendLabel: string;
  values: Record<string, number | null>;
  ranges: readonly TileRange[];
  format: StateMapFormat;
  /** What the tooltip says the value is ("median college's acceptance rate"). */
  description: string;
}

function formatValue(format: StateMapFormat, v: number): string {
  if (format === "signedPct") return `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
  if (format === "moneyK") return `$${Math.round(v / 1000)}K`;
  return `${Math.round(v * 100)}%`;
}

/**
 * The /trends/states index map (specs/trends/states.md): a segmented control switches which measure colors the
 * tiles. `undergradChange` uses the diverging `--div-1..5` ramp; the other four use the sequential `--seq-1..5` ramp
 * (validated scales, specs/design-system.md). States under STATE_FLOOR have a null value and render as the map's
 * "no data" tile, same as a state with zero colleges. Formatting is done here, from serializable `format`/
 * `description` strings, not function props (client components can't take functions from a server page).
 */
export function StateMeasureMap({ measures }: { measures: readonly StateMapMeasureDef[] }) {
  const [key, setKey] = useState<StateMapKey>(measures[0].key);
  const measure = measures.find((m) => m.key === key) ?? measures[0];
  const format = (v: number) => formatValue(measure.format, v);
  return (
    <div>
      <div className="max-w-full max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4">
        <SegmentedControl label="Color the map by" value={measure.key} options={measures.map((m) => ({ value: m.key, label: m.label }))} onChange={setKey} />
      </div>
      <div className="mt-4">
        <StateTileMap
          values={measure.values}
          ranges={measure.ranges}
          legendLabel={measure.legendLabel}
          format={format}
          href={(state) => `/trends/states/${state.toLowerCase()}`}
          valueTitle={(state, v) => `${state}: ${format(v)} ${measure.description}. Click for the state page`}
          emptyTitle={(state) => `${state}: too few colleges on the site, or no colleges`}
        />
      </div>
    </div>
  );
}
