"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatBy, type FormatKind } from "@/lib/format";
import { axisYearLabel, historyYearLabel, type YearKind } from "@/lib/history";
import { useWidth } from "./useWidth";

export interface TrendSeries {
  key: string;
  name: string;
  /** A color token, e.g. "var(--d-value)" for the headline or "var(--muted-foreground)" for context. */
  color: string;
  dashed?: boolean;
  start: number;
  values: (number | null)[];
  /** Years computed with a fallback formula (noted in the tooltip). */
  approx?: number[];
}

/** A range drawn as a band with edge lines (SAT/ACT middle 50%). */
export interface TrendRange {
  key: string;
  name: string;
  color: string;
  start: number;
  lo: (number | null)[];
  hi: (number | null)[];
}

/** Shown in the tooltip only (e.g. the share who submitted scores). */
export interface TrendExtra {
  name: string;
  start: number;
  values: (number | null)[];
  format: FormatKind;
}

export interface TrendBand {
  label: string;
  start: number;
  /** [25th percentile, median, 75th percentile] per year. */
  stats: ([number, number, number] | null)[];
}

const at = <T,>(start: number, arr: readonly T[], year: number): T | null => {
  const i = year - start;
  return i >= 0 && i < arr.length ? arr[i] : null;
};

/** 1, 2, 2.5, 5 × 10^n steps giving about `count` ticks. */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  const raw = (hi - lo) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/**
 * Year-by-year line chart for the profile's "Over time" section (specs/trends-design.md): one y-axis, 2px lines,
 * gaps left as gaps, an optional national p25–p75 band with a dotted median, a faint band for events (the
 * pandemic year), a hollow point for the provisional latest year, and a crosshair tooltip that lists every series
 * at the hovered year (keyboard: focus the chart, then ← →). Ranges draw as bands; breaks (a definition change)
 * split every line and draw a dotted rule; spans shade labeled runs of years (e.g. scores not required).
 */
export function TrendLine({
  series,
  ranges = [],
  breaks = [],
  spans = [],
  extras = [],
  band,
  from,
  to,
  kind,
  format,
  axisFormat,
  provisionalYear,
  events = [],
  label,
}: {
  series: TrendSeries[];
  ranges?: TrendRange[];
  breaks?: { year: number; label: string }[];
  spans?: { from: number; to: number; label: string }[];
  extras?: TrendExtra[];
  band?: TrendBand | null;
  from: number;
  to: number;
  kind: YearKind;
  format: FormatKind;
  /** Tick format (defaults to a compact form of `format`). */
  axisFormat?: FormatKind;
  provisionalYear?: number | null;
  events?: { year: number; label: string }[];
  /** Accessible description of the chart. */
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);
  const height = width < 480 ? 170 : 210;
  const directLabels = width >= 480 && series.length + ranges.length <= 4;
  const m = { top: 14, right: directLabels ? 104 : 12, bottom: 24, left: 48 };
  const plotW = Math.max(40, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const years = useMemo(() => Array.from({ length: to - from + 1 }, (_, i) => from + i), [from, to]);
  const tickFormat: FormatKind = axisFormat ?? (format === "money" ? "moneyCompact" : format === "pctSmart" ? "pct" : format);

  const { lo, hi, ticks } = useMemo(() => {
    const vals: number[] = [];
    for (const y of years) {
      for (const s of series) {
        const v = at(s.start, s.values, y);
        if (v !== null) vals.push(v);
      }
      for (const r of ranges) {
        const [a, b] = [at(r.start, r.lo, y), at(r.start, r.hi, y)];
        if (a !== null) vals.push(a);
        if (b !== null) vals.push(b);
      }
      const b = band ? at(band.start, band.stats, y) : null;
      if (b) vals.push(b[0], b[2]);
    }
    if (!vals.length) return { lo: 0, hi: 1, ticks: [0, 1] };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    // Anchor at zero when the data sits close to it, so small values aren't exaggerated.
    if (min >= 0 && min < max * 0.4) min = 0;
    const pad = (max - min || Math.abs(max) || 1) * 0.08;
    max += pad;
    if (min !== 0) min = min > 0 ? Math.max(0, min - pad) : min - pad;
    const t = niceTicks(min, max);
    return { lo: Math.min(min, t[0]), hi: Math.max(max, t[t.length - 1]), ticks: t };
  }, [years, series, ranges, band]);

  const x = (year: number) => m.left + (to === from ? plotW / 2 : ((year - from) / (to - from)) * plotW);
  const y = (v: number) => m.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const breakYears = new Set(breaks.map((b) => b.year));
  /** Path pieces over consecutive reported years, split at breaks; isolated points become dots. */
  const pieces = (get: (year: number) => number | null) => {
    const runs: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const yr of years) {
      const v = get(yr);
      if (breakYears.has(yr) && cur.length) {
        runs.push(cur);
        cur = [];
      }
      if (v === null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push([x(yr), y(v)]);
    }
    if (cur.length) runs.push(cur);
    return runs;
  };

  const xStep = Math.max(1, Math.ceil(years.length / (width < 480 ? 4 : 7)));
  const xTicks = years.filter((yr) => (to - yr) % xStep === 0);

  // Direct labels at each series' last point in view, nudged apart so they never overlap.
  const rangeEnds = ranges
    .map((r) => {
      for (let yr = to; yr >= from; yr--) {
        const [a, b] = [at(r.start, r.lo, yr), at(r.start, r.hi, yr)];
        if (a !== null && b !== null) return { s: { key: r.key, name: r.name, color: r.color, dashed: false } as TrendSeries, yr, v: (a + b) / 2, ly: y((a + b) / 2) };
      }
      return null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const ends = series
    .map((s) => {
      for (let yr = to; yr >= from; yr--) {
        const v = at(s.start, s.values, yr);
        if (v !== null) return { s, yr, v, ly: y(v) };
      }
      return null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const labels = [...ends, ...rangeEnds].sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + 13);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(to, Math.max(from, Math.round(from + t * (to - from)))));
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = e.key === "ArrowLeft" ? -1 : 1;
    setHover((h) => Math.min(to, Math.max(from, (h ?? to) + d)));
  };

  const hoverBand = hover !== null && band ? at(band.start, band.stats, hover) : null;
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) - 90, 0), Math.max(0, width - 180));

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
        {/* Grid and y-axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
              {formatBy(tickFormat, t)}
            </text>
          </g>
        ))}
        {xTicks.map((yr) => (
          <text key={yr} x={x(yr)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
            {axisYearLabel(yr, kind)}
          </text>
        ))}

        {/* Events (e.g. the pandemic year) */}
        {events
          .filter((ev) => ev.year >= from && ev.year <= to)
          .map((ev) => {
            const half = to === from ? 12 : plotW / (to - from) / 2;
            const x0 = Math.max(m.left, x(ev.year) - half);
            const x1 = Math.min(m.left + plotW, x(ev.year) + half);
            return (
              <g key={ev.year}>
                <rect x={x0} y={m.top} width={x1 - x0} height={plotH} fill="var(--foreground)" opacity={0.05} />
                <text x={(x0 + x1) / 2} y={m.top - 3} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                  {ev.label}
                </text>
              </g>
            );
          })}

        {/* Shaded runs of years (e.g. scores not required) */}
        {spans
          .filter((sp) => sp.to >= from && sp.from <= to)
          .map((sp) => {
            const half = to === from ? 12 : plotW / (to - from) / 2;
            const x0 = Math.max(m.left, x(Math.max(sp.from, from)) - half);
            const x1 = Math.min(m.left + plotW, x(Math.min(sp.to, to)) + half);
            return (
              <g key={`${sp.from}${sp.label}`}>
                <rect x={x0} y={m.top} width={x1 - x0} height={plotH} fill="var(--foreground)" opacity={0.04} />
                {/* Label only when it fits (~5px a character at 9px); the tooltip names every span. */}
                {x1 - x0 >= sp.label.length * 5 + 8 && (
                  <text x={x0 + 4} y={m.top + plotH - 4} className="fill-muted-foreground text-[9px]">
                    {sp.label}
                  </text>
                )}
              </g>
            );
          })}

        {/* Definition changes */}
        {breaks
          .filter((b) => b.year > from && b.year <= to)
          .map((b) => {
            const bx = (x(b.year - 1) + x(b.year)) / 2;
            return (
              <g key={b.year}>
                <line x1={bx} x2={bx} y1={m.top} y2={m.top + plotH} stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 3" />
                <text x={bx + 3} y={m.top + 8} className="fill-foreground text-[9px] font-semibold">
                  {b.label}
                </text>
              </g>
            );
          })}

        {/* Ranges */}
        {ranges.map((r) => {
          const runs: number[][] = [];
          let cur: number[] = [];
          for (const yr of years) {
            const ok = at(r.start, r.lo, yr) !== null && at(r.start, r.hi, yr) !== null;
            if ((breakYears.has(yr) || !ok) && cur.length) {
              runs.push(cur);
              cur = [];
            }
            if (ok) cur.push(yr);
          }
          if (cur.length) runs.push(cur);
          return runs.map((run, i) => {
            const top = run.map((yr) => `${x(yr)},${y(at(r.start, r.hi, yr)!)}`);
            const bottom = [...run].reverse().map((yr) => `${x(yr)},${y(at(r.start, r.lo, yr)!)}`);
            return (
              <g key={`${r.key}${i}`}>
                {run.length === 1 ? (
                  <line x1={x(run[0])} x2={x(run[0])} y1={y(at(r.start, r.lo, run[0])!)} y2={y(at(r.start, r.hi, run[0])!)} stroke={r.color} strokeWidth={4} strokeLinecap="round" />
                ) : (
                  <>
                    <path d={`M${top.join("L")}L${bottom.join("L")}Z`} fill={r.color} opacity={0.18} />
                    <path d={`M${top.join("L")}`} fill="none" stroke={r.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    <path d={`M${[...bottom].reverse().join("L")}`} fill="none" stroke={r.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  </>
                )}
              </g>
            );
          });
        })}

        {/* National middle 50% and median */}
        {band &&
          (() => {
            const runs: { yr: number; s: [number, number, number] }[][] = [];
            let cur: { yr: number; s: [number, number, number] }[] = [];
            for (const yr of years) {
              const s = at(band.start, band.stats, yr);
              if (!s) {
                if (cur.length) runs.push(cur);
                cur = [];
              } else cur.push({ yr, s });
            }
            if (cur.length) runs.push(cur);
            return runs.map((run, i) => (
              <g key={i}>
                <path
                  d={`M${run.map((p) => `${x(p.yr)},${y(p.s[2])}`).join("L")}L${[...run].reverse().map((p) => `${x(p.yr)},${y(p.s[0])}`).join("L")}Z`}
                  fill="var(--foreground)"
                  opacity={0.07}
                />
                <path
                  d={`M${run.map((p) => `${x(p.yr)},${y(p.s[1])}`).join("L")}`}
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.5}
                  strokeDasharray="1 4"
                  strokeLinecap="round"
                />
              </g>
            ));
          })()}

        {/* Series */}
        {series.map((s) =>
          pieces((yr) => at(s.start, s.values, yr)).map((run, i) =>
            run.length === 1 ? (
              <circle key={`${s.key}${i}`} cx={run[0][0]} cy={run[0][1]} r={3} fill={s.color} />
            ) : (
              <path
                key={`${s.key}${i}`}
                d={`M${run.map((p) => p.join(",")).join("L")}`}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )
          )
        )}

        {/* End points: solid, or hollow when the year is provisional */}
        {ends.map((e) => (
          <circle
            key={e.s.key}
            cx={x(e.yr)}
            cy={y(e.v)}
            r={4}
            fill={e.yr === provisionalYear ? "var(--card)" : e.s.color}
            stroke={e.s.color}
            strokeWidth={2}
          />
        ))}

        {directLabels &&
          labels.map((e) => (
            <g key={e.s.key}>
              <line x1={m.left + plotW + 10} x2={m.left + plotW + 20} y1={e.ly} y2={e.ly} stroke={e.s.color} strokeWidth={2} strokeDasharray={e.s.dashed ? "3 2" : undefined} />
              <text x={m.left + plotW + 24} y={e.ly} dy="0.32em" className="fill-foreground text-[10px] font-medium">
                {e.s.name}
              </text>
            </g>
          ))}

        {/* Crosshair */}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + plotH} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
            {series.map((s) => {
              const v = at(s.start, s.values, hover);
              return v === null ? null : <circle key={s.key} cx={x(hover)} cy={y(v)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />;
            })}
          </g>
        )}
        <rect
          x={m.left}
          y={m.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          tabIndex={0}
          aria-label={`${label}. Use the left and right arrow keys to read each year.`}
          className="cursor-crosshair outline-none focus-visible:stroke-ring"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          style={{ touchAction: "pan-y" }}
        />
      </svg>

      {hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 w-[180px] rounded-xl border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg"
          style={{ left: tipLeft }}
        >
          <p className="mb-1.5 font-semibold">{historyYearLabel(hover, kind)}</p>
          <ul className="space-y-1">
            {series.map((s) => {
              const v = at(s.start, s.values, hover);
              return (
                <li key={s.key} className="flex items-center gap-1.5">
                  <svg width={12} height={4} aria-hidden className="shrink-0">
                    <line x1={0} x2={12} y1={2} y2={2} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "3 2" : undefined} />
                  </svg>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.name}</span>
                  <span className="font-semibold tabular-nums">
                    {v === null ? "—" : formatBy(format, v)}
                    {v !== null && s.approx?.includes(hover) ? "*" : ""}
                  </span>
                </li>
              );
            })}
            {ranges.map((r) => {
              const [a, b] = [at(r.start, r.lo, hover), at(r.start, r.hi, hover)];
              return (
                <li key={r.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-3 shrink-0 rounded-sm" style={{ backgroundColor: r.color, opacity: 0.6 }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.name}</span>
                  <span className="font-semibold tabular-nums">{a === null || b === null ? "—" : `${formatBy(format, a)}–${formatBy(format, b)}`}</span>
                </li>
              );
            })}
            {extras.map((e) => {
              const v = at(e.start, e.values, hover);
              return (
                <li key={e.name} className="flex items-center gap-1.5 pl-[18px]">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.name}</span>
                  <span className="font-semibold tabular-nums">{v === null ? "—" : formatBy(e.format, v)}</span>
                </li>
              );
            })}
            {band && (
              <li className="flex items-center gap-1.5">
                <svg width={12} height={4} aria-hidden className="shrink-0">
                  <line x1={0} x2={12} y1={2} y2={2} stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="1 3" strokeLinecap="round" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{band.label}</span>
                <span className="font-semibold tabular-nums">{hoverBand ? formatBy(format, hoverBand[1]) : "—"}</span>
              </li>
            )}
          </ul>
          {series.some((s) => s.approx?.includes(hover)) && <p className="mt-1.5 text-[10px] text-muted-foreground">* Estimated (see note below the charts)</p>}
          {hover === provisionalYear && <p className="mt-1.5 text-[10px] text-muted-foreground">Provisional: NCES revises this year next release.</p>}
          {spans.filter((sp) => hover >= sp.from && hover <= sp.to).map((sp) => (
            <p key={sp.label + sp.from} className="mt-1.5 text-[10px] text-muted-foreground">{sp.label}</p>
          ))}
        </div>
      )}
    </div>
  );
}
