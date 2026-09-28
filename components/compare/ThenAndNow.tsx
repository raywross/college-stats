"use client";

import { useState } from "react";
import type { FormatKind } from "@/lib/format";
import { SlopeChart, type SlopeRow } from "@/components/charts/SlopeChart";
import { cn } from "@/lib/utils";

export interface ThenAndNowMetric {
  key: string;
  label: string;
  format: FormatKind;
  fromLabel: string;
  toLabel: string;
  rows: SlopeRow[];
  /** Colleges without both endpoints, named in a note. */
  missing: string[];
}

/**
 * Compare "Then & now" (specs/trends-design.md#compare-then--now): one metric at a time, picked from a segmented
 * control, as a slope chart over the default 10-year window. Data comes from school.trends, so no history files load.
 */
export function ThenAndNow({ metrics }: { metrics: ThenAndNowMetric[] }) {
  const usable = metrics.filter((m) => m.rows.length > 0);
  const [key, setKey] = useState(usable[0]?.key);
  const m = usable.find((x) => x.key === key) ?? usable[0];
  if (!m) return <p className="text-sm text-muted-foreground">None of these colleges has 10 years of history to compare.</p>;
  return (
    <div>
      <div role="radiogroup" aria-label="Measure" className="mb-4 inline-flex flex-wrap gap-1 rounded-full border bg-card p-0.5 text-xs font-semibold">
        {usable.map((x) => (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={x.key === m.key}
            onClick={() => setKey(x.key)}
            className={cn(
              "rounded-full px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              x.key === m.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      <SlopeChart rows={m.rows} fromLabel={m.fromLabel} toLabel={m.toLabel} format={m.format} label={`${m.label}, ${m.fromLabel} to ${m.toLabel}`} />
      {m.rows.some((r) => r.lateStart) && (
        <p className="mt-2 text-[11px] text-muted-foreground">Years in parentheses: that college&apos;s first reported year in the window.</p>
      )}
      {m.missing.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Not enough years reported: {m.missing.join(", ")}.</p>}
    </div>
  );
}
