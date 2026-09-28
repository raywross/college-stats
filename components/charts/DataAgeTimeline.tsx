import type { ReactNode } from "react";

export interface DataAgeRow {
  id: string;
  /** Dataset name, e.g. "IPEDS Admissions survey". */
  label: string;
  /** Display year from lineage, e.g. "Fall YYYY"; null when the release has no single year. */
  year: string | null;
  /** ISO date the period `year` describes began; null draws no bar. */
  start: string | null;
  /** What the dataset is used for on the site. */
  usedFor: string;
  /** ISO date of the next expected update; null when irregular or unknown. */
  next: string | null;
  /** Text for the next update, e.g. "Dec YYYY · estimated". */
  nextLabel: ReactNode;
  /** Shown instead of a bar when `start` is null. */
  noBarNote?: string;
}

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

function ageLabel(start: Date, today: Date): string {
  const months = Math.round((today.getTime() - start.getTime()) / MONTH_MS);
  if (months < 12) return `${months} months old`;
  const years = Math.round((months / 12) * 10) / 10;
  return `${years} years old`;
}

/**
 * How old each dataset on the site is: one row per release, a bar from the start of
 * the period it describes to today, and a ring at its next expected update. Every
 * value is also printed in the row (year, next update), so the chart is its own table.
 */
export function DataAgeTimeline({ rows, today: todayIso }: { rows: DataAgeRow[]; today: string }) {
  const today = new Date(todayIso);
  const times = rows.flatMap((r) => [r.start, r.next]).filter((d): d is string => !!d).map((d) => new Date(d).getTime());
  const lo = Math.min(today.getTime(), ...times) - 2 * MONTH_MS;
  const hi = Math.max(today.getTime(), ...times) + 3 * MONTH_MS;
  const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const todayPct = pct(today.getTime());

  // A tick at each New Year inside the domain.
  const ticks: { year: number; at: number }[] = [];
  for (let y = new Date(lo).getUTCFullYear() + 1; Date.UTC(y, 0, 1) < hi; y++) ticks.push({ year: y, at: pct(Date.UTC(y, 0, 1)) });

  const plotGrid = (
    <>
      {ticks.map((t) => (
        <span key={t.year} aria-hidden className="absolute inset-y-0 w-px bg-grid" style={{ left: `${t.at}%` }} />
      ))}
      <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${todayPct}%` }} />
    </>
  );

  return (
    <figure className="rounded-3xl border bg-card p-4 sm:p-6">
      <figcaption className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-6 rounded-r-[4px] bg-primary" /> Period the data describes, up to today
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-full border-2 border-foreground bg-card" /> Next expected update
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-3.5 w-px bg-foreground/50" /> Today
        </span>
      </figcaption>

      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const start = r.start ? new Date(r.start) : null;
          const startPct = start ? pct(start.getTime()) : null;
          const nextPct = r.next ? pct(new Date(r.next).getTime()) : null;
          const age = start ? ageLabel(start, today) : null;
          return (
            <li key={r.id} className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-[16rem_1fr_9rem] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {r.label}
                  {r.year && <span className="font-normal text-muted-foreground"> · {r.year}</span>}
                </p>
                <p className="text-xs text-muted-foreground">{r.usedFor}</p>
              </div>

              <div className="relative h-7">
                {plotGrid}
                {startPct !== null ? (
                  <span
                    tabIndex={0}
                    className="group absolute top-1/2 h-3 -translate-y-1/2 rounded-r-[4px] bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: `${startPct}%`, width: `${todayPct - startPct}%` }}
                    aria-label={`${r.label}, ${r.year}: ${age}`}
                  >
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-lg border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md group-hover:block group-focus-visible:block"
                    >
                      <b>{r.year}</b> data · {age}
                    </span>
                  </span>
                ) : (
                  <span className="absolute inset-y-0 left-0 flex items-center pr-2 text-xs text-muted-foreground italic" style={{ maxWidth: `${todayPct}%` }}>
                    <span className="truncate bg-card pr-1">{r.noBarNote}</span>
                  </span>
                )}
                {nextPct !== null && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-card ring-2 ring-card"
                    style={{ left: `${nextPct}%` }}
                  />
                )}
              </div>

              <p className="text-xs text-muted-foreground sm:text-right">
                <span className="sm:hidden">Next update: </span>
                {r.nextLabel}
              </p>
            </li>
          );
        })}
      </ul>

      {/* Year axis, aligned with the plot column. */}
      <div className="grid gap-x-6 pt-1 sm:grid-cols-[16rem_1fr_9rem]" aria-hidden>
        <span className="hidden sm:block" />
        <div className="relative h-5 text-[11px] text-muted-foreground tabular-nums">
          {ticks.map((t) => (
            <span key={t.year} className="absolute -translate-x-1/2" style={{ left: `${t.at}%` }}>
              {t.year}
            </span>
          ))}
          <span className="absolute -translate-x-1/2 top-5 font-semibold text-foreground" style={{ left: `${todayPct}%` }}>
            Today
          </span>
        </div>
      </div>
      <div className="h-4" />
    </figure>
  );
}
