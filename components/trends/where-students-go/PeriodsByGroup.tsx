"use client";

import { useMemo, useState } from "react";
import { TrendLine } from "@/components/charts/TrendLine";
import { Term } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { pct } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";

export interface PeriodCell {
  key: "before" | "pandemic" | "after";
  from: number;
  to: number;
  /** Share points per year. */
  pace: number;
  studentsChange: number;
  medianChange: number;
  grewShare: number;
}

export interface PeriodGroup {
  key: string;
  label: string;
  n: number;
  /** Yearly share of campus-based undergraduates, `from` → `to`. */
  line: (number | null)[];
  periods: PeriodCell[];
  /** Share of the group's colleges back at their pre-pandemic size. */
  back: number;
}

export interface PeriodGrouping {
  key: string;
  label: string;
  groups: PeriodGroup[];
}

const COLORS = ["var(--demo-1)", "var(--demo-2)", "var(--demo-3)", "var(--demo-4)", "var(--demo-5)", "var(--demo-7)"];
const PERIOD_LABEL = { before: "Before", pandemic: "Pandemic", after: "After" } as const;
const PERIOD_INK = { before: "var(--muted-foreground)", pandemic: "var(--d-size)", after: "var(--d-scores)" } as const;

const signed = (v: number, digits = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
const signedPct = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${pct(Math.abs(r), 1)}`;
};

/**
 * Study 7's pandemic section (specs/trends/where-students-go.md, section 5): for the grouping the switch selects, each
 * group's yearly share of campus-based undergraduates on one scale with the pandemic period shaded, then the pace
 * strip (three small bars per group: before · pandemic · after, in share points per year, on one shared scale, so an
 * acceleration reads as a taller middle bar and a reversal as a bar that flips sign), then the share of each group's
 * colleges back at their pre-pandemic size. Every value is printed beside its bar.
 */
export function PeriodsByGroup({ groupings, from, to, pre, low }: { groupings: PeriodGrouping[]; from: number; to: number; pre: number; low: number }) {
  const [key, setKey] = useState(groupings[0]?.key ?? "");
  const grouping = groupings.find((g) => g.key === key) ?? groupings[0];
  const maxPace = useMemo(() => Math.max(0.05, ...groupings.flatMap((g) => g.groups.flatMap((r) => r.periods.map((p) => Math.abs(p.pace))))), [groupings]);
  if (!grouping) return null;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const afterLen = to - low;
  const periodAxis = {
    before: `before: ${pre - from} falls`,
    pandemic: `pandemic: ${low - pre} falls`,
    after: `after: ${afterLen} ${afterLen === 1 ? "fall" : "falls"} so far`,
  } as const;

  return (
    <div>
      <div className="relative max-w-full max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4">
        <SegmentedControl label="Group colleges by" value={grouping.key} options={groupings.map((g) => ({ value: g.key, label: g.label }))} onChange={setKey} />
      </div>

      <figure className="mt-4 min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
        <figcaption className="text-sm font-semibold">Each group&apos;s share of campus-based undergraduates, by fall</figcaption>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {grouping.groups.map((g, i) => (
            <li key={g.key} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} aria-hidden />
              {g.label}
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <TrendLine
            series={grouping.groups.map((g, i) => ({ key: g.key, name: g.label, color: COLORS[i % COLORS.length], start: from, values: g.line }))}
            from={from}
            to={to}
            kind="fall"
            format="pct"
            spans={[{ from: pre, to: low, label: "Pandemic" }]}
            label={`Share of campus-based undergraduates by ${grouping.label.toLowerCase()}, ${fall(from)} to ${fall(to)}; the pandemic period, ${fall(pre)} to ${fall(low)}, shaded`}
          />
        </div>
      </figure>

      <figure className="mt-4 min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
        <figcaption className="text-sm font-semibold">
          Pace of change in share, <Term term="percentage-points">points</Term> per year
        </figcaption>
        <p className="mt-1 text-xs text-muted-foreground">
          Before ({fall(from)} to {fall(pre)}) · pandemic ({fall(pre)} to {fall(low)}) · after ({fall(low)} to {fall(to)}). A taller middle bar means the pandemic sped a
          shift up; a bar that flips sign would mean a reversal. The after period is {afterLen} {afterLen === 1 ? "fall" : "falls"} long so far.
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {(["before", "pandemic", "after"] as const).map((k) => (
            <li key={k} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: PERIOD_INK[k] }} aria-hidden />
              {periodAxis[k]}
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label={`Pace by ${grouping.label.toLowerCase()}`}>
          {grouping.groups.map((g) => (
            <div key={g.key} role="listitem" className="min-w-0 rounded-2xl border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-semibold" title={g.label}>
                  {g.label}
                </p>
                <p className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{g.n.toLocaleString("en-US")} colleges</p>
              </div>
              <div className="mt-3 space-y-1.5">
                {g.periods.map((p) => (
                  <div
                    key={p.key}
                    className="flex items-center gap-2 text-xs"
                    title={`${PERIOD_LABEL[p.key]} (${fall(p.from)} to ${fall(p.to)}): students ${signedPct(p.studentsChange)}; median college ${signedPct(p.medianChange)}; ${pct(p.grewShare)} of colleges grew`}
                  >
                    <span className="w-16 shrink-0 text-muted-foreground">{PERIOD_LABEL[p.key]}</span>
                    <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted/40">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                      <div
                        className="absolute inset-y-0 rounded-full"
                        style={{
                          backgroundColor: PERIOD_INK[p.key],
                          left: p.pace >= 0 ? "50%" : `${50 - (Math.abs(p.pace) / maxPace) * 50}%`,
                          width: `${(Math.abs(p.pace) / maxPace) * 50}%`,
                        }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right tabular-nums">{signed(p.pace)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground tabular-nums">
                Students: {g.periods.map((p) => signedPct(p.studentsChange)).join(" · ")}
              </p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Back at their {fall(pre)} size: <b className="text-foreground">{pct(g.back)}</b> of colleges
              </p>
            </div>
          ))}
        </div>
      </figure>
    </div>
  );
}
