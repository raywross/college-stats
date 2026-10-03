"use client";

import { useState } from "react";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Class sections by size (CDS I-3; specs/data-expansion/cds-academics.md): one column per bin, all one hue, the bins
 * under 20 students at full strength and the rest lighter, so the headline's share is visible in the chart. Columns
 * grow from one baseline, capped at 24px wide with 4px rounded tops; hover a column for its count and share.
 * A hidden table carries the same numbers for screen readers.
 */
export function ClassSizeHistogram({
  bins,
  labels,
  highlight,
  color,
  unit = "sections",
}: {
  /** Counts per bin, in order. */
  bins: readonly number[];
  /** Bin labels ("2–9", …, "100+"). */
  labels: readonly string[];
  /** How many leading bins are the highlighted group (2: under 20 students). */
  highlight: number;
  color: string;
  unit?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = bins.reduce((a, b) => a + b, 0);
  const peak = Math.max(1, ...bins);
  if (!total) return null;
  const fill = (i: number) => (i < highlight ? color : `color-mix(in oklch, ${color} 38%, transparent)`);

  return (
    <figure className="space-y-2">
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <div className="flex h-36 items-end border-b border-foreground/20" aria-hidden>
          {bins.map((v, i) => (
            <div key={labels[i]} className="flex h-full flex-1 items-end justify-center" onMouseEnter={() => setActive(i)}>
              <span
                className={cn("block w-full max-w-6 origin-bottom animate-grow-y rounded-t-[4px] transition-opacity", active !== null && active !== i && "opacity-40")}
                style={{ height: `${v === 0 ? 0 : Math.max(2, (v / peak) * 100)}%`, backgroundColor: fill(i) }}
              />
            </div>
          ))}
        </div>
        {active !== null && (
          <div
            className={cn(
              "pointer-events-none absolute z-10 rounded-lg bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-lg",
              // Edge columns anchor the tooltip inward so it never overflows a phone screen.
              active < 2 ? "translate-x-0" : active >= bins.length - 2 ? "-translate-x-full" : "-translate-x-1/2"
            )}
            style={{
              left: `${((active < 2 ? active : active >= bins.length - 2 ? active + 1 : active + 0.5) / bins.length) * 100}%`,
              bottom: `calc(${(bins[active] / peak) * 100}% + 0.5rem)`,
            }}
          >
            {bins[active].toLocaleString("en-US")} {unit} of {labels[active]} students ({pct(bins[active] / total)})
          </div>
        )}
      </div>
      <div className="flex text-[11px] text-muted-foreground tabular-nums" aria-hidden>
        {labels.map((l) => (
          <span key={l} className="flex-1 text-center">
            {l}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden /> Under 20 students
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[3px]" style={{ backgroundColor: fill(bins.length - 1) }} aria-hidden /> 20 or more
        </span>
        <span>Students per class section</span>
      </figcaption>
      <table className="sr-only">
        <caption>Undergraduate class {unit} by number of students</caption>
        <thead>
          <tr>
            <th scope="col">Students</th>
            <th scope="col">{unit}</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((v, i) => (
            <tr key={labels[i]}>
              <th scope="row">{labels[i]}</th>
              <td>{v.toLocaleString("en-US")}</td>
              <td>{pct(v / total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
