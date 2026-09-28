"use client";

import { useState, type PointerEvent } from "react";
import { formatBy } from "@/lib/format";
import { axisYearLabel, historyYearLabel, type YearKind } from "@/lib/history";
import { useWidth } from "./useWidth";

export interface AreaCategory {
  key: string;
  label: string;
  /** A validated palette token, e.g. "var(--demo-1)". */
  color: string;
  start: number;
  values: (number | null)[];
}

/**
 * Part-to-whole over time (student body by race/ethnicity): categories stacked to 100% each year in a fixed order,
 * a 1px surface line between layers, years without data left blank, and a crosshair listing every share. The legend
 * mirrors the stack order (top to bottom).
 */
export function StackedArea100({ categories, from, to, kind, label }: { categories: AreaCategory[]; from: number; to: number; kind: YearKind; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);
  const height = width < 480 ? 170 : 210;
  const m = { top: 8, right: 8, bottom: 24, left: 40 };
  const plotW = Math.max(40, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const at = (c: AreaCategory, y: number) => c.values[y - c.start] ?? null;
  // Normalize each year to 100% (shares are rounded, so they rarely sum to exactly 1); null when the year is missing.
  const shares = new Map<number, number[] | null>(
    years.map((y) => {
      const vals = categories.map((c) => at(c, y));
      if (vals.every((v) => v === null)) return [y, null];
      const total = vals.reduce<number>((a, v) => a + (v ?? 0), 0) || 1;
      return [y, vals.map((v) => (v ?? 0) / total)];
    })
  );
  const x = (y: number) => m.left + (to === from ? plotW / 2 : ((y - from) / (to - from)) * plotW);
  const yy = (v: number) => m.top + plotH * (1 - v);

  // Runs of consecutive reported years.
  const runs: number[][] = [];
  let cur: number[] = [];
  for (const y of years) {
    if (shares.get(y)) cur.push(y);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);

  const xStep = Math.max(1, Math.ceil(years.length / (width < 480 ? 4 : 7)));
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(to, Math.max(from, Math.round(from + ((e.clientX - r.left) / r.width) * (to - from)))));
  };
  const hoverShares = hover === null ? null : shares.get(hover) ?? null;
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) - 85, 0), Math.max(0, width - 170));

  return (
    <div>
      <div ref={ref} className="relative w-full">
        <svg width={width} height={height} role="img" aria-label={label} className="block">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={yy(t)} y2={yy(t)} stroke="var(--border)" />
              <text x={m.left - 6} y={yy(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {formatBy("pct", t)}
              </text>
            </g>
          ))}
          {years
            .filter((y) => (to - y) % xStep === 0)
            .map((y) => (
              <text key={y} x={x(y)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
                {axisYearLabel(y, kind)}
              </text>
            ))}
          {runs.map((run, ri) =>
            categories.map((c, ci) => {
              const base = (y: number) => shares.get(y)!.slice(0, ci).reduce((a, b) => a + b, 0);
              const topPts = run.map((y) => `${x(y)},${yy(base(y) + shares.get(y)![ci])}`);
              const botPts = [...run].reverse().map((y) => `${x(y)},${yy(base(y))}`);
              return (
                <path
                  key={`${ri}${c.key}`}
                  d={run.length === 1 ? `M${x(run[0]) - 3},${yy(base(run[0]) + shares.get(run[0])![ci])}h6V${yy(base(run[0]))}h-6Z` : `M${topPts.join("L")}L${botPts.join("L")}Z`}
                  fill={c.color}
                  stroke="var(--card)"
                  strokeWidth={1}
                  opacity={hover !== null && hoverShares === null ? 0.5 : 1}
                />
              );
            })
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + plotH} stroke="var(--foreground)" strokeWidth={1.5} />}
          <rect
            x={m.left}
            y={m.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            aria-label={`${label}. Use the left and right arrow keys to read each year.`}
            className="cursor-crosshair outline-none"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              setHover((h) => Math.min(to, Math.max(from, (h ?? to) + (e.key === "ArrowLeft" ? -1 : 1))));
            }}
            style={{ touchAction: "pan-y" }}
          />
        </svg>
        {hover !== null && (
          <div role="status" className="pointer-events-none absolute top-0 z-10 w-[170px] rounded-xl border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg" style={{ left: tipLeft }}>
            <p className="mb-1.5 font-semibold">{historyYearLabel(hover, kind)}</p>
            {hoverShares ? (
              <ul className="space-y-1">
                {[...categories].reverse().map((c) => {
                  const i = categories.indexOf(c);
                  return (
                    <li key={c.key} className="flex items-center gap-1.5">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: c.color }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.label}</span>
                      <span className="font-semibold tabular-nums">{formatBy("pct", hoverShares[i])}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground">Not reported</p>
            )}
          </div>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {[...categories].reverse().map((c) => (
          <li key={c.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: c.color }} aria-hidden />
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
