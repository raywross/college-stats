import type { ReactNode } from "react";
import { formatBy, type FormatKind } from "@/lib/format";

export interface DotRangeRow {
  key: string;
  label: ReactNode;
  /** Small print under the label (year, members reporting). */
  sub?: ReactNode;
  /** The group's median (the dot). */
  value: number;
  /** The group's lowest and highest member (the bar). */
  min: number;
  max: number;
  /** The comparison median (a tick), e.g. every four-year college. */
  reference: number | null;
  format: FormatKind;
  /** Domain color token for the dot. */
  color: string;
  /** Scale 0–100% (shares); otherwise 0 to the largest value shown. */
  share?: boolean;
}

/** Where a value sits on a row's scale, in percent of the track. */
function position(v: number, hi: number): number {
  return hi > 0 ? Math.max(0, Math.min(100, (v / hi) * 100)) : 0;
}

/**
 * Dot-and-range strip (specs/charts.md, specs/trends/conferences.md "At a glance"): one row per measure, each on its
 * own zero-based scale. The group's range (lowest to highest member) is a neutral bar, its median a dot in the
 * measure's domain color with a surface ring, and the comparison median a thin ink tick. Every value is printed beside
 * the row (median, range, comparison), so the chart needs no hover and is its own table. CSS-positioned in percent,
 * so it fits a phone without measuring.
 */
export function DotRange({ rows, referenceLabel, valueLabel }: { rows: DotRangeRow[]; referenceLabel: string; valueLabel: string }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground/70 ring-2 ring-card" /> {valueLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-foreground/15" /> Lowest to highest member
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-foreground" /> {referenceLabel}
        </span>
      </div>
      <ul className="divide-y">
        {rows.map((r) => {
          const hi = r.share ? 1 : Math.max(r.max, r.reference ?? 0) * 1.04;
          const f = (v: number) => formatBy(r.format, v);
          const desc = `${f(r.value)}; members range from ${f(r.min)} to ${f(r.max)}${r.reference !== null ? `; ${referenceLabel.toLowerCase()} ${f(r.reference)}` : ""}`;
          return (
            <li key={r.key} className="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[12rem_minmax(0,1fr)_9.5rem] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{r.label}</p>
                {r.sub && <p className="text-[11px] text-muted-foreground">{r.sub}</p>}
              </div>
              <div className="relative h-6" role="img" aria-label={desc}>
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
                <div
                  className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/15"
                  style={{ left: `${position(r.min, hi)}%`, width: `${Math.max(0.8, position(r.max, hi) - position(r.min, hi))}%` }}
                />
                {r.reference !== null && (
                  <div className="absolute top-0.5 bottom-0.5 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${position(r.reference, hi)}%` }} title={`${referenceLabel}: ${f(r.reference)}`} />
                )}
                <div
                  className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: `${position(r.value, hi)}%`, background: r.color }}
                  title={`${valueLabel}: ${f(r.value)}`}
                />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums sm:text-right">
                <b className="text-sm text-foreground">{f(r.value)}</b> · {f(r.min)}–{f(r.max)}
                {r.reference !== null && (
                  <>
                    <br className="max-sm:hidden" />
                    <span className="sm:hidden"> · </span>all {f(r.reference)}
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
