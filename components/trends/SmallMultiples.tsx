"use client";

import { useMemo, useState } from "react";
import { TrendLine, type TrendSeries } from "@/components/charts/TrendLine";
import { Term } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatBy, type FormatKind } from "@/lib/format";
import type { YearKind } from "@/lib/history";
import { cn } from "@/lib/utils";

/** One group's small chart. Under the floor: `tooFew`, no series ("too few colleges to say"). */
export interface SmallMultipleTile {
  key: string;
  label: string;
  /** Panel colleges in the group. */
  n: number;
  tooFew?: boolean;
  series?: TrendSeries[];
  /** Printed under the label, e.g. "Women 41% → 56% · Men 17% → 5%". */
  summary?: string;
}

export interface SmallMultipleGrouping {
  key: string;
  /** The switch's label ("Region"). */
  label: string;
  floor: number;
  tiles: SmallMultipleTile[];
}

/** One way of counting: "Colleges" (each college once) or "Students" (weighted). */
export interface SmallMultiplesView {
  key: string;
  label: string;
  /** One line saying what every tile shows ("Share of colleges, fall 2004 to fall 2024"). */
  caption: string;
  format: FormatKind;
  axisFormat?: FormatKind;
  legend: { name: string; color: string; dashed?: boolean }[];
  groupings: SmallMultipleGrouping[];
  /** Shared y-range; by default fitted to every tile of every grouping in the view, so switching keeps the scale. */
  domain?: [number, number];
}

function fitDomain(view: SmallMultiplesView): [number, number] {
  const vals = view.groupings.flatMap((g) => g.tiles.flatMap((t) => (t.series ?? []).flatMap((s) => s.values.filter((v): v is number => v !== null))));
  if (!vals.length) return [0, 1];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo >= 0 && lo < hi * 0.4) lo = 0;
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  hi = hi <= 0 ? Math.min(0, hi + pad) : hi + pad;
  if (lo !== 0) lo -= pad;
  return [lo, hi];
}

/**
 * Small multiples for a national trend study (specs/national-trends.md#where-it-appears): one small chart per group,
 * all on one scale so they compare at a glance, with a switch for the grouping (region, type, size, selectivity, plus
 * the study's extras) and, when given two views, a Colleges / Students switch. Groups under the floor show a "too few
 * colleges to say" tile with their count. Phones: one column, the switches scroll sideways (specs/mobile.md).
 */
export function SmallMultiples({
  views,
  from,
  to,
  kind,
  events = [],
  provisionalYear = null,
  label,
}: {
  views: SmallMultiplesView[];
  from: number;
  to: number;
  kind: YearKind;
  events?: { year: number; label: string }[];
  provisionalYear?: number | null;
  /** What the charts show, for screen readers ("Share of colleges admitting women at a higher rate, by group"). */
  label: string;
}) {
  const [viewKey, setViewKey] = useState(views[0].key);
  const [groupingKey, setGroupingKey] = useState(views[0].groupings[0]?.key ?? "");
  const view = views.find((v) => v.key === viewKey) ?? views[0];
  const grouping = view.groupings.find((g) => g.key === groupingKey) ?? view.groupings[0];
  const domain = useMemo(() => view.domain ?? fitDomain(view), [view]);
  if (!grouping) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {views.length > 1 && (
          <SegmentedControl label="Count colleges or students" value={view.key} options={views.map((v) => ({ value: v.key, label: v.label }))} onChange={setViewKey} />
        )}
        {view.groupings.length > 1 && (
          // Phones: the grouping pills scroll sideways, edge to edge.
          <div className="relative max-w-full max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4">
            <SegmentedControl
              label="Group colleges by"
              value={grouping.key}
              options={view.groupings.map((g) => ({ value: g.key, label: g.label }))}
              onChange={setGroupingKey}
            />
          </div>
        )}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{view.caption}</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {view.legend.map((l) => (
          <li key={l.name} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden className="shrink-0">
              <line x1="1" x2="17" y1="3" y2="3" stroke={l.color} strokeWidth={2} strokeDasharray={l.dashed ? "4 3" : undefined} strokeLinecap="round" />
            </svg>
            {l.name}
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label={`${label}, by ${grouping.label.toLowerCase()}`}>
        {grouping.tiles.map((t) => (
          <div key={`${grouping.key}-${t.key}`} role="listitem" className={cn("min-w-0 rounded-2xl border p-3", t.tooFew ? "border-dashed bg-transparent" : "bg-card")}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold" title={t.label}>
                {t.label}
              </p>
              <p className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{t.n.toLocaleString("en-US")} colleges</p>
            </div>
            {t.tooFew || !t.series ? (
              <p className="mt-6 mb-5 text-center text-sm text-muted-foreground">
                <Term term="too-few-colleges">Too few colleges to say</Term>
                <span className="block text-[11px]">Needs {grouping.floor} or more</span>
              </p>
            ) : (
              <>
                {t.summary && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{t.summary}</p>}
                <div className="mt-2">
                  <TrendLine
                    series={t.series}
                    from={from}
                    to={to}
                    kind={kind}
                    format={view.format}
                    axisFormat={view.axisFormat}
                    domain={domain}
                    height={130}
                    events={events}
                    provisionalYear={provisionalYear}
                    label={`${label}: ${t.label}, ${t.n} colleges. Scale ${formatBy(view.axisFormat ?? view.format, domain[0])} to ${formatBy(view.axisFormat ?? view.format, domain[1])}.`}
                  />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
