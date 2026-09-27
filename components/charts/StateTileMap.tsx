import Link from "next/link";
import { cn } from "@/lib/utils";

/** NPR-style tile grid: [col, row] for each state + DC. */
const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [10, 0],
  VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], WI: [6, 2], MI: [7, 2], NY: [8, 2], RI: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
};

const LEVELS = [
  { min: 1, label: "1–14", bg: "var(--seq-1)", ink: "text-foreground" },
  { min: 15, label: "15–29", bg: "var(--seq-2)", ink: "text-foreground" },
  { min: 30, label: "30–59", bg: "var(--seq-3)", ink: "text-foreground" },
  { min: 60, label: "60–99", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { min: 100, label: "100+", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];

function level(count: number) {
  return [...LEVELS].reverse().find((l) => count >= l.min);
}

/** Where the schools are: a clickable cartogram that filters Explore. */
export function StateTileMap({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-11 gap-1 sm:gap-1.5" role="list" aria-label="Schools by state">
        {Object.entries(TILES).map(([state, [col, row]]) => {
          const count = counts[state] ?? 0;
          const lv = level(count);
          const style = { gridColumnStart: col + 1, gridRowStart: row + 1 } as const;
          const base =
            "flex aspect-square flex-col items-center justify-center rounded-md text-[9px] font-bold leading-none sm:rounded-lg sm:text-[11px]";
          return count > 0 && lv ? (
            <Link
              key={state}
              role="listitem"
              href={`/explore?states=${state}`}
              title={`${state}: ${count} college${count > 1 ? "s" : ""}. Click to explore`}
              className={cn(base, lv.ink, "transition-transform hover:z-10 hover:scale-110 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring")}
              style={{ ...style, backgroundColor: lv.bg }}
            >
              {state}
              <span className="mt-0.5 hidden text-[9px] font-semibold opacity-80 sm:block">{count}</span>
            </Link>
          ) : (
            <span key={state} role="listitem" className={cn(base, "bg-muted text-muted-foreground/60")} style={style} title={`${state}: no 4-year colleges in our data`}>
              {state}
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <span>Colleges per state</span>
        <div className="flex flex-wrap items-center gap-1">
          <span className="size-3 rounded-sm bg-muted" />
          <span>0</span>
          {LEVELS.map((l) => (
            <span key={l.min} className="ml-1.5 inline-flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ backgroundColor: l.bg }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
