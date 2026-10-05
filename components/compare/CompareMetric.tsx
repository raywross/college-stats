import type { School } from "@/lib/types";
import type { TermKey } from "@/lib/glossary";
import type { Cited } from "@/lib/lineage";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { MetricLabel } from "@/components/ui/info-tip";

/**
 * One metric, one bar per school. Bars wear the school's slot color;
 * text stays in ink. The extreme value gets a neutral label (not a trophy):
 * "higher" isn't automatically "better" for things like selectivity.
 * `variant="row"` drops the card (a compact row inside another card, as the compare topic cards use);
 * `cited` adds the field's source to the label's (i).
 */
export function CompareMetric({
  label,
  term,
  schools,
  get,
  format,
  max,
  flag,
  variant = "card",
  cited,
}: {
  label: string;
  term: TermKey;
  schools: School[];
  get: (s: School) => number | null;
  format: (v: number) => string;
  max?: number;
  flag?: { which: "max" | "min"; text: string };
  variant?: "card" | "row";
  cited?: Cited;
}) {
  const values = schools.map(get);
  const present = values.filter((v): v is number => v !== null);
  const top = max ?? Math.max(1e-9, ...present);
  const target =
    flag && present.length > 1 ? (flag.which === "max" ? Math.max(...present) : Math.min(...present)) : null;
  const row = variant === "row";
  // Per-variant value-column width, capped with `minmax(floor, cap)` rather than a plain length: each school's row
  // is its own grid, so an `auto` third column used to size to that row's own content (a flag pill, or "Not
  // reported") independently of its siblings', leaving the flagged row's bar track (the `1fr` column) narrower
  // than the others in the same metric. A plain fixed length fixes that but reopens a narrower bug: in the
  // tightest real grid (`xl:grid-cols-4`, e.g. the admissions funnel), the label and value columns alone outgrow
  // the ~190px a card gets, so a rigid width pushes the value past the card's edge into its neighbor instead of
  // just shrinking the bar. `minmax` caps the width when there's room (desktop, the 2- and 3-up grids) and lets it
  // shrink toward the floor when there isn't, so the bar never collapses to 0 and the value never overflows the
  // card; the pill wraps onto its own line only when the two don't fit beside the value (`flex-wrap`), rather
  // than widening the row to fit them on one line, so roomy cards keep today's single-line look.
  const gridCols = row
    ? "grid-cols-[minmax(0,4.5rem)_minmax(1.25rem,1fr)_minmax(2.75rem,4.5rem)] sm:grid-cols-[minmax(0,6rem)_minmax(1.5rem,1fr)_minmax(3rem,6rem)]"
    : "grid-cols-[minmax(0,4rem)_minmax(1.25rem,1fr)_minmax(2.75rem,4rem)] sm:grid-cols-[minmax(0,5rem)_minmax(1.5rem,1fr)_minmax(3rem,4.5rem)]";

  return (
    <div className={row ? undefined : "rounded-3xl border bg-card p-4 sm:p-5"}>
      <MetricLabel term={term} cited={cited} className={row ? "mb-2 text-xs font-semibold text-muted-foreground" : "mb-4 font-display text-base font-bold"}>
        {label}
      </MetricLabel>
      <div className="space-y-2.5">
        {schools.map((s, i) => {
          const v = values[i];
          const isFlag = target !== null && v === target && new Set(present).size > 1;
          return (
            <div key={s.unit_id} className={`grid items-center gap-3 ${gridCols}`}>
              <span className="min-w-0 truncate text-xs font-semibold">{shortName(s)}</span>
              <span className={`min-w-0 ${row ? "h-2.5" : "h-3"} overflow-hidden rounded-full bg-muted`}>
                {v !== null && (
                  <span
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{ width: `${Math.max(2, Math.min(100, (v / top) * 100))}%`, backgroundColor: SLOT_COLORS[i], animationDelay: `${i * 80}ms` }}
                  />
                )}
              </span>
              {/* min-w-0 + overflow-hidden: a grid item's automatic minimum size otherwise matches its unbreakable
                  content (a long value with no spaces to wrap at), which would force this column past its minmax
                  cap and overflow the card in the tightest grids; clipping here is a last resort none of today's
                  real values should ever hit. flex-wrap (not flex-col): value and pill share one line when the
                  column is wide enough to fit both (every roomy card), and only the tightest grids force the pill
                  onto its own line. */}
              <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 overflow-hidden text-right text-sm font-bold tabular-nums">
                {v === null ? <span className="font-normal text-muted-foreground">Not reported</span> : format(v)}
                {isFlag && flag && (
                  <span className="hidden rounded-full bg-pop px-1.5 py-0.5 text-center text-[10px] font-bold leading-tight text-pop-foreground sm:inline-block">
                    {flag.text}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
