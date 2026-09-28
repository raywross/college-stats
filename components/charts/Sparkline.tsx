"use client";

import { useState, type PointerEvent } from "react";
import { formatBy, type FormatKind } from "@/lib/format";
import { historyYearLabel, type YearKind } from "@/lib/history";
import { useWidth } from "./useWidth";

export interface SparkSeries {
  name: string;
  color: string;
  dashed?: boolean;
  values: (number | null)[];
}

/**
 * A small trend for a headline fact (Home "What's changed"): one or two series sharing one scale, a dot on each
 * end, and a hover readout of the year and values. No axes; the card's text carries the numbers. Drawn at the
 * container's real width so strokes and dots keep their size.
 */
export function Sparkline({
  series,
  start,
  kind,
  format,
  height = 64,
  compact = false,
  label,
}: {
  series: SparkSeries[];
  start: number;
  kind: YearKind;
  format: FormatKind;
  height?: number;
  /** Tiny inline size (60×16 beside a headline): thinner line, smaller dots. */
  compact?: boolean;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(compact ? 60 : 240);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = compact ? 3 : 6;
  const x = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - lo) / (hi - lo || 1));

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={label}>
        {series.map((s) => {
          const runs: string[][] = [];
          let cur: string[] = [];
          s.values.forEach((v, i) => {
            if (v === null) {
              if (cur.length) runs.push(cur);
              cur = [];
            } else cur.push(`${x(i)},${y(v)}`);
          });
          if (cur.length) runs.push(cur);
          const points = s.values.map((v, i) => [v, i] as const).filter(([v]) => v !== null);
          const ends = points.length ? [points[0], points[points.length - 1]] : [];
          return (
            <g key={s.name}>
              {runs.map((r, i) => (
                <path
                  key={i}
                  d={`M${r.join("L")}`}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={compact ? 1.5 : 2}
                  strokeDasharray={s.dashed ? "5 3" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {ends.map(([v, i]) => (
                <circle key={i} cx={x(i)} cy={y(v!)} r={compact ? 2.5 : 4} fill={s.color} stroke="var(--card)" strokeWidth={compact ? 1 : 2} />
              ))}
            </g>
          );
        })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--foreground)" strokeOpacity={0.3} />}
        <rect x={0} y={0} width={width} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="hidden sm:block" />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-2 right-0 z-10 -translate-y-full rounded-lg border bg-popover px-2 py-1 text-[11px] whitespace-nowrap text-popover-foreground shadow">
          <b>{historyYearLabel(start + hover, kind)}</b>
          {series.map((s) => (
            <span key={s.name} className="ml-2 text-muted-foreground">
              {series.length > 1 ? `${s.name} ` : ""}
              <b className="text-foreground tabular-nums">{s.values[hover] === null ? "—" : formatBy(format, s.values[hover]!)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
