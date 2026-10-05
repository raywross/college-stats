import Link from "next/link";
import { cn } from "@/lib/utils";

/** NPR-style tile grid: [col, row] for each state + DC. */
export const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [10, 0],
  VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], WI: [6, 2], MI: [7, 2], NY: [8, 2], RI: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
};

export interface TileLevel {
  min: number;
  label: string;
  bg: string;
  ink: string;
}

const LEVELS: readonly TileLevel[] = [
  { min: 1, label: "1–14", bg: "var(--seq-1)", ink: "text-foreground" },
  { min: 15, label: "15–29", bg: "var(--seq-2)", ink: "text-foreground" },
  { min: 30, label: "30–59", bg: "var(--seq-3)", ink: "text-foreground" },
  { min: 60, label: "60–99", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { min: 100, label: "100+", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];

function level(count: number, levels: readonly TileLevel[]) {
  return [...levels].reverse().find((l) => count >= l.min);
}

/** A diverging or sequential range: `lo <= value < hi` (the last range's `hi` is inclusive). */
export interface TileRange {
  lo: number;
  hi: number;
  label: string;
  bg: string;
  ink: string;
}

function rangeOf(value: number, ranges: readonly TileRange[]): TileRange | undefined {
  return ranges.find((r, i) => value >= r.lo && (value < r.hi || i === ranges.length - 1));
}

/**
 * Where the schools are: a clickable cartogram that filters Explore. `counts` stays the default (college counts, the
 * built-in scale); a caller with a different kind of value (a trend study's sending-state totals, a share) passes
 * `levels` for its own scale and `legendLabel`/`format`/`unit`/`href` to relabel, additively (existing callers are
 * unaffected). Added for Study 5 (specs/trends/out-of-state.md).
 *
 * `values` + `ranges` is an additional, independent mode for a signed or null-able measure (undergraduate % change,
 * which can be negative, or a state under the floor, which has no value at all): `null` renders as the muted
 * "no data" tile `counts`/`levels` never produce for a present state, and `ranges` can include values below zero
 * (a diverging scale), which the ascending `min`-only `levels` can't. Added for the States unit
 * (specs/trends/states.md); `counts`/`levels` callers are unaffected.
 */
export function StateTileMap({
  counts,
  values,
  levels = LEVELS,
  ranges,
  legendLabel = "Colleges per state",
  format = (n: number) => n.toLocaleString("en-US"),
  unit = "college",
  href = (state: string) => `/explore?states=${state}`,
  emptyTitle = (state: string) => `${state}: no 4-year colleges in our data`,
  valueTitle,
}: {
  counts?: Record<string, number>;
  /** A signed or null-able measure, keyed by state; use with `ranges` instead of `counts`/`levels`. */
  values?: Record<string, number | null>;
  /** A custom color scale (ascending by `min`); defaults to the built-in college-count scale. */
  levels?: readonly TileLevel[];
  /** Ranges for `values` (diverging or sequential, can include negatives), in ascending order. */
  ranges?: readonly TileRange[];
  /** The legend's leading label ("Colleges per state", "Out-of-state first-years from each state"). */
  legendLabel?: string;
  /** How a state's value is printed in its tile and tooltip. */
  format?: (n: number) => string;
  /** Singular noun for the tooltip ("college", "first-year"); pluralized with a trailing "s" (`counts` mode only). */
  unit?: string;
  /** Where a tile links; null to render plain (non-interactive) tiles. */
  href?: ((state: string) => string) | null;
  /** Tooltip for a state with no value. */
  emptyTitle?: (state: string) => string;
  /** Tooltip for a state with a value (`values` mode); defaults to `"{state}: {format(value)}"`. */
  valueTitle?: (state: string, value: number) => string;
}) {
  const usingValues = values !== undefined;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-11 gap-1 sm:gap-1.5" role="list" aria-label="Schools by state">
        {Object.entries(TILES).map(([state, [col, row]]) => {
          const style = { gridColumnStart: col + 1, gridRowStart: row + 1 } as const;
          const base =
            "flex aspect-square flex-col items-center justify-center rounded-md text-[9px] font-bold leading-none sm:rounded-lg sm:text-[11px]";

          if (usingValues) {
            const v = values[state];
            const rg = v === null || v === undefined ? undefined : rangeOf(v, ranges ?? []);
            if (v === null || v === undefined || !rg) {
              return (
                <span key={state} role="listitem" className={cn(base, "bg-muted text-muted-foreground/60")} style={style} title={emptyTitle(state)}>
                  {state}
                </span>
              );
            }
            const title = valueTitle ? valueTitle(state, v) : `${state}: ${format(v)}${href ? ". Click to explore" : ""}`;
            const inner = (
              <>
                {state}
                <span className="mt-0.5 hidden text-[9px] font-semibold opacity-80 sm:block">{format(v)}</span>
              </>
            );
            return href ? (
              <Link
                key={state}
                role="listitem"
                href={href(state)}
                title={title}
                className={cn(base, rg.ink, "transition-transform hover:z-10 hover:scale-110 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring")}
                style={{ ...style, backgroundColor: rg.bg }}
              >
                {inner}
              </Link>
            ) : (
              <span key={state} role="listitem" title={title} className={cn(base, rg.ink)} style={{ ...style, backgroundColor: rg.bg }}>
                {inner}
              </span>
            );
          }

          const count = counts?.[state] ?? 0;
          const lv = level(count, levels);
          if (!(count > 0 && lv)) {
            return (
              <span key={state} role="listitem" className={cn(base, "bg-muted text-muted-foreground/60")} style={style} title={emptyTitle(state)}>
                {state}
              </span>
            );
          }
          const title = `${state}: ${format(count)} ${unit}${count === 1 ? "" : "s"}${href ? ". Click to explore" : ""}`;
          const inner = (
            <>
              {state}
              <span className="mt-0.5 hidden text-[9px] font-semibold opacity-80 sm:block">{format(count)}</span>
            </>
          );
          return href ? (
            <Link
              key={state}
              role="listitem"
              href={href(state)}
              title={title}
              className={cn(base, lv.ink, "transition-transform hover:z-10 hover:scale-110 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring")}
              style={{ ...style, backgroundColor: lv.bg }}
            >
              {inner}
            </Link>
          ) : (
            <span key={state} role="listitem" title={title} className={cn(base, lv.ink)} style={{ ...style, backgroundColor: lv.bg }}>
              {inner}
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <span>{legendLabel}</span>
        <div className="flex flex-wrap items-center gap-1">
          {!usingValues && (
            <>
              <span className="size-3 rounded-sm bg-muted" />
              <span>0</span>
            </>
          )}
          {(usingValues ? ranges ?? [] : levels).map((l) => (
            <span key={usingValues ? (l as TileRange).lo : (l as TileLevel).min} className="ml-1.5 inline-flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ backgroundColor: l.bg }} />
              {l.label}
            </span>
          ))}
          {usingValues && (
            <span className="ml-1.5 inline-flex items-center gap-1">
              <span className="size-3 rounded-sm bg-muted" />
              too few colleges
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
