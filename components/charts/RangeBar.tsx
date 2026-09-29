import type { TermKey } from "@/lib/glossary";
import { MetricLabel } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * Middle-50% range on a fixed scale. Optional markers for the dataset
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
      {!compact && (
        <div className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
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
          {youStatus === "inside" && "Your score is inside the middle 50%, typical for admitted students."}
          {youStatus === "above" && "Your score is above the 75th percentile, stronger than most admitted students."}
          {youStatus === "below" && "Your score is below the 25th percentile; about a quarter of admitted students are here too."}
        </p>
      )}
    </div>
  );
}
