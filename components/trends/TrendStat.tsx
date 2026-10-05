import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { formatBy, type FormatKind } from "@/lib/format";
import { historyYearLabel, type YearKind } from "@/lib/history";
import type { ThenNow } from "@/lib/trends";

/**
 * A study's headline figure as "then → now": the label (with its glossary term), both values, and the years and
 * what is counted ("share of colleges", "median college"), all from the trend file.
 */
export function TrendStat({
  label,
  values,
  format,
  from,
  to,
  kind,
  counts,
  color,
}: {
  label: ReactNode;
  values: ThenNow;
  format: FormatKind;
  from: number;
  to: number;
  kind: YearKind;
  /** What the figure counts: "Share of colleges", "Median college", "Weighted by applicants". */
  counts: string;
  /** Domain color for the "now" value's marker. */
  color?: string;
}) {
  return (
    <div className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 font-display tabular-nums">
        <span className="text-2xl font-bold text-muted-foreground sm:text-3xl">{formatBy(format, values[0])}</span>
        <ArrowRight className="size-5 self-center text-muted-foreground" aria-label="to" />
        <span className="text-4xl font-extrabold tracking-tight sm:text-5xl">{formatBy(format, values[1])}</span>
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        {color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
        {historyYearLabel(from, kind)} → {historyYearLabel(to, kind).toLowerCase()} · {counts}
      </p>
    </div>
  );
}
