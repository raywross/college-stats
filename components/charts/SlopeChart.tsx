"use client";

import { formatBy, type FormatKind } from "@/lib/format";
import { useWidth } from "./useWidth";

export interface SlopeRow {
  id: string;
  name: string;
  /** Compare-slot color token. */
  color: string;
  from: number;
  to: number;
  /** Start label when this row starts later than the others (e.g. "2016–17"). */
  lateStart?: string;
}

/**
 * Two points per row joined by a line (Compare "Then & now"): one shared y-scale, slot colors, direct labels at
 * both ends nudged apart so they never overlap. Values are printed, so it needs no hover; the table below Compare
 * lists them too.
 */
export function SlopeChart({ rows, fromLabel, toLabel, format, label }: { rows: SlopeRow[]; fromLabel: string; toLabel: string; format: FormatKind; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(520);
  const height = 240;
  const narrow = width < 480;
  const m = { top: 28, bottom: 16, side: narrow ? 64 : 150 };
  const x0 = m.side;
  const x1 = Math.max(x0 + 60, width - m.side);
  const vals = rows.flatMap((r) => [r.from, r.to]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
  lo -= pad;
  hi += pad;
  const y = (v: number) => m.top + (height - m.top - m.bottom) * (1 - (v - lo) / (hi - lo || 1));

  // Labels at each end, pushed apart by at least 14px.
  const place = (key: "from" | "to") => {
    const items = rows.map((r) => ({ id: r.id, ly: y(r[key]) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < items.length; i++) items[i].ly = Math.max(items[i].ly, items[i - 1].ly + 14);
    return new Map(items.map((i) => [i.id, i.ly]));
  };
  const left = place("from");
  const right = place("to");

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
        <text x={x0} y={12} textAnchor="middle" className="fill-muted-foreground text-[11px] font-semibold">
          {fromLabel}
        </text>
        <text x={x1} y={12} textAnchor="middle" className="fill-muted-foreground text-[11px] font-semibold">
          {toLabel}
        </text>
        <line x1={x0} x2={x0} y1={m.top - 6} y2={height - m.bottom} stroke="var(--border)" />
        <line x1={x1} x2={x1} y1={m.top - 6} y2={height - m.bottom} stroke="var(--border)" />
        {rows.map((r) => (
          <g key={r.id}>
            <line x1={x0} x2={x1} y1={y(r.from)} y2={y(r.to)} stroke={r.color} strokeWidth={2} strokeLinecap="round" />
            <circle cx={x0} cy={y(r.from)} r={4.5} fill={r.color} stroke="var(--card)" strokeWidth={2} />
            <circle cx={x1} cy={y(r.to)} r={4.5} fill={r.color} stroke="var(--card)" strokeWidth={2} />
            <text x={x0 - 10} y={left.get(r.id)} dy="0.32em" textAnchor="end" className="fill-foreground text-[11px] tabular-nums">
              {narrow ? "" : `${r.name} `}
              <tspan className="font-semibold">{formatBy(format, r.from)}</tspan>
              {r.lateStart ? <tspan className="fill-muted-foreground">{` (${r.lateStart})`}</tspan> : null}
            </text>
            <text x={x1 + 10} y={right.get(r.id)} dy="0.32em" className="fill-foreground text-[11px] tabular-nums">
              <tspan className="font-semibold">{formatBy(format, r.to)}</tspan>
              {narrow ? "" : ` ${r.name}`}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
