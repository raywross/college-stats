"use client";

import { useMemo, useState } from "react";
import { Term } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatBy, type FormatKind } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One group's bars (Study 3's "share shrank 10%+ vs grew 10%+" or the students view's one diverging bar). */
export interface GroupBarsRow {
  key: string;
  label: string;
  /** Panel colleges in the group. */
  n: number;
  tooFew?: boolean;
  bars?: { name: string; value: number; color: string }[];
  /** Printed under the label. */
  summary?: string;
}

export interface GroupBarsGrouping {
  key: string;
  label: string;
  floor: number;
  rows: GroupBarsRow[];
}

/** One way of counting ("Colleges" paired bars, "Students" one diverging bar). */
export interface GroupBarsView {
  key: string;
  label: string;
  caption: string;
  format: FormatKind;
  legend: { name: string; color: string }[];
  groupings: GroupBarsGrouping[];
  /** Bars grow from the left (shares) rather than from a centered zero (a signed change). */
  diverging?: boolean;
  /** Shared scale (the largest |value| across every tile); computed from the data when omitted. */
  domain?: number;
}

function fitDomain(view: GroupBarsView): number {
  const vals = view.groupings.flatMap((g) => g.rows.flatMap((r) => (r.bars ?? []).map((b) => Math.abs(b.value))));
  return vals.length ? Math.max(...vals) * 1.1 : 1;
}

/**
 * Small multiples for a national trend study, drawn as paired or diverging bars rather than lines (SmallMultiples is
 * for a yearly series; Study 3's groups compare two shares, or one signed change, at a single window — a new chart
 * per specs/charts.md and the dataviz rules, since none of the reusable charts fit). Same shape as SmallMultiples: a
 * grouping switch, a shared scale, and "too few colleges to say" tiles under the floor.
 */
export function GroupBars({
  views,
  windowLabel,
}: {
  views: GroupBarsView[];
  /** "Ten years" / "Five years" caption prefix, when the caller also offers a window switch. */
  windowLabel?: string;
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
      <p className="mt-3 text-sm text-muted-foreground">
        {windowLabel ? `${windowLabel}. ` : ""}
        {view.caption}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {view.legend.map((l) => (
          <li key={l.name} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
            {l.name}
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label={`By ${grouping.label.toLowerCase()}`}>
        {grouping.rows.map((r) => (
          <div key={`${grouping.key}-${r.key}`} role="listitem" className={cn("min-w-0 rounded-2xl border p-3", r.tooFew ? "border-dashed bg-transparent" : "bg-card")}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold" title={r.label}>
                {r.label}
              </p>
              <p className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{r.n.toLocaleString("en-US")} colleges</p>
            </div>
            {r.tooFew || !r.bars ? (
              <p className="mt-6 mb-5 text-center text-sm text-muted-foreground">
                <Term term="too-few-colleges">Too few colleges to say</Term>
                <span className="block text-[11px]">Needs {grouping.floor} or more</span>
              </p>
            ) : (
              <>
                {r.summary && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.summary}</p>}
                <div className="mt-3 space-y-2">
                  {r.bars.map((b) => (
                    <div key={b.name} className="flex items-center gap-2 text-xs">
                      <span className="w-20 shrink-0 truncate text-muted-foreground" title={b.name}>
                        {b.name}
                      </span>
                      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted/40">
                        {view.diverging && <div className="absolute inset-y-0 left-1/2 w-px bg-border" />}
                        <div
                          className="absolute inset-y-0 rounded-full"
                          style={
                            view.diverging
                              ? {
                                  backgroundColor: b.color,
                                  left: b.value >= 0 ? "50%" : `${50 - (Math.abs(b.value) / domain) * 50}%`,
                                  width: `${(Math.abs(b.value) / domain) * 50}%`,
                                }
                              : { backgroundColor: b.color, left: 0, width: `${(Math.abs(b.value) / domain) * 100}%` }
                          }
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right tabular-nums">{formatBy(view.format, b.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
