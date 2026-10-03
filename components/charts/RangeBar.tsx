import type { TermKey } from "@/lib/glossary";
import { MetricLabel } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * Middle-50% range on a given scale (score bars pick one with scoreScale),
 * with the 25th/75th percentile values labeled. Optional markers for the dataset
 * median midpoint and for the student's own score.
 */
export function RangeBar({
  label,
  term,
  low,
  high,
  scale,
  color,
  medianMid,
  median,
  you,
  ticks,
  compact,
  showScale,
}: {
  label?: string;
  term?: TermKey;
  low: number;
  high: number;
  scale: [number, number];
  color: string;
  medianMid?: number;
  /** This college's own median (a true median, not the range's midpoint), drawn as a dot on the bar. */
  median?: number | null;
  you?: number | null;
  ticks?: number[];
  compact?: boolean;
  /** Compact bars only: label the axis ends, for a tile whose scale isn't the full test range. */
  showScale?: boolean;
}) {
  const [min, max] = scale;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const left = pos(low);
  const width = Math.max(pos(high) - left, 1.5);
  const youPos = you != null ? pos(you) : null;
  const youStatus =
    you == null ? null : you < low ? "below" : you > high ? "above" : "inside";

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <MetricLabel term={term} className="text-sm font-medium">
            {label}
          </MetricLabel>
          <span className="text-sm font-semibold tabular-nums">
            {low}
            <span className="mx-0.5 text-muted-foreground">–</span>
            {high}
            {median != null && <span className="ml-1.5 font-normal text-muted-foreground">median {median}</span>}
          </span>
        </div>
      )}
      <div className={cn("relative", compact ? "h-4" : youPos != null ? "mt-6 h-7" : "h-7")}>
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        {/* Middle 50% */}
        <div
          className="absolute inset-y-0 origin-left animate-grow-x rounded-full"
          style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }}
          role="img"
          aria-label={`${label ?? "Range"}: middle 50% from ${low} to ${high}`}
        />
        {/* Dataset median midpoint */}
        {medianMid !== undefined && (
          <div
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${pos(medianMid)}%` }}
            title={`National median: ${Math.round(medianMid)}`}
          />
        )}
        {/* This college's median */}
        {median != null && (
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card"
            style={{ left: `${pos(median)}%`, borderColor: color }}
            role="img"
            aria-label={`Median ${median}`}
            title={`Median: ${median}`}
          />
        )}
        {/* You */}
        {youPos != null && (
          <div className="absolute inset-y-0 -translate-x-1/2" style={{ left: `${youPos}%` }}>
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-pop px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-pop-foreground shadow-sm">
              You {you}
            </div>
            <div className="mx-auto h-full w-1 rounded-full bg-foreground ring-2 ring-card" />
          </div>
        )}
      </div>
      {compact && showScale && (
        <div className="flex justify-between text-[10px] leading-none text-muted-foreground tabular-nums">
          <span>{min}</span>
          <span>{max}</span>
        </div>
      )}
      {!compact && <PercentileLabels left={left} right={left + width} low={low} high={high} />}
      {!compact && (
        <div className="relative h-4 text-[10px] text-muted-foreground/80 tabular-nums">
          {(ticks ?? [min, max]).map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
              style={{ left: `${pos(t)}%` }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {youStatus && !compact && (
        <p className="text-xs text-muted-foreground">
          {youStatus === "inside" && "Your score is inside the middle 50%, typical for enrolled first-years who sent scores."}
          {youStatus === "above" && "Your score is above the 75th percentile, stronger than most enrolled first-years who sent scores."}
          {youStatus === "below" && "Your score is below the 25th percentile; about a quarter of enrolled first-years who sent scores are here too."}
        </p>
      )}
    </div>
  );
}

/**
 * "25th 1500" under the bar's left end and "75th 1570" under its right end,
 * each hanging outward so they never collide. When the bar is too narrow or
 * too close to an edge for that, the two merge into one label under the bar.
 */
function PercentileLabels({ left, right, low, high }: { left: number; right: number; low: number; high: number }) {
  const pct = (p: string, v: number) => (
    <>
      <span className="font-normal text-muted-foreground">{p}</span> {v}
    </>
  );
  const split = left >= 16 && right <= 84;
  if (!split) {
    const mid = (left + right) / 2;
    const align = mid < 25 ? "translate-x-0" : mid > 75 ? "-translate-x-full" : "-translate-x-1/2";
    const at = mid < 25 ? left : mid > 75 ? right : mid;
    return (
      <div className="relative h-4 text-[11px] font-semibold tabular-nums" aria-hidden>
        <span className={cn("absolute whitespace-nowrap", align)} style={{ left: `${at}%` }}>
          {pct("25th", low)} <span className="text-muted-foreground">·</span> {pct("75th", high)}
        </span>
      </div>
    );
  }
  return (
    <div className="relative h-4 text-[11px] font-semibold tabular-nums" aria-hidden>
      <span className="absolute -translate-x-full pr-1 whitespace-nowrap" style={{ left: `${left}%` }}>
        {pct("25th", low)}
      </span>
      <span className="absolute pl-1 whitespace-nowrap" style={{ left: `${right}%` }}>
        {pct("75th", high)}
      </span>
      {/* Hairlines tying each label to its end of the bar. */}
      <span className="absolute -top-1.5 h-2.5 w-px bg-foreground/40" style={{ left: `${left}%` }} />
      <span className="absolute -top-1.5 h-2.5 w-px -translate-x-full bg-foreground/40" style={{ left: `${right}%` }} />
    </div>
  );
}
