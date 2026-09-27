"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface RadarSeries {
  id: string;
  label: string;
  color: string;
  values: (number | null)[]; // 0..1 per axis; null = not reported
}

/**
 * Overlaid "shape" of up to four schools across percentile axes.
 * Colors are the validated all-pairs compare slots; a legend is always shown.
 */
export function RadarChart({ axes, series }: { axes: string[]; series: RadarSeries[] }) {
  const anyMissing = series.some((s) => s.values.some((v) => v === null));
  const [active, setActive] = useState<string | null>(null);
  const size = 340;
  const cx = size / 2;
  const cy = size / 2;
  const R = 118;
  const n = axes.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, v: number) => [cx + Math.cos(angle(i)) * R * v, cy + Math.sin(angle(i)) * R * v] as const;
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox={`-60 -12 ${size + 120} ${size + 24}`} className="w-full max-w-[440px] overflow-visible" role="img" aria-label="Radar chart comparing school profiles by percentile">
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => pt(i, ring).join(",")).join(" ")}
            fill={ring === 1 ? "var(--surface-2)" : "none"}
            stroke="var(--grid)"
            strokeWidth={1}
          />
        ))}
        {axes.map((a, i) => {
          const [x2, y2] = pt(i, 1);
          const [lx, ly] = pt(i, 1.2);
          return (
            <g key={a}>
              <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="var(--grid)" />
              <text
                x={lx}
                y={ly}
                textAnchor={Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end"}
                dy="0.32em"
                className="fill-muted-foreground text-[11px] font-semibold"
              >
                {a}
              </text>
            </g>
          );
        })}
        {series.map((s) => {
          const dim = active && active !== s.id;
          return (
            <g key={s.id} className="transition-opacity" opacity={dim ? 0.15 : 1}>
              <polygon
                points={s.values.map((v, i) => pt(i, Math.max(v ?? 0, 0.04)).join(",")).join(" ")}
                fill={s.color}
                fillOpacity={active === s.id ? 0.25 : 0.1}
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {s.values.map((v, i) => {
                const [x, y] = pt(i, Math.max(v ?? 0, 0.04));
                return v === null ? (
                  <circle key={i} cx={x} cy={y} r={3.5} fill="var(--card)" stroke={s.color} strokeWidth={1.5} />
                ) : (
                  <circle key={i} cx={x} cy={y} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-2">
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            onMouseEnter={() => setActive(s.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(s.id)}
            onBlur={() => setActive(null)}
            onClick={() => setActive((cur) => (cur === s.id ? null : s.id))}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-opacity",
              active && active !== s.id && "opacity-40"
            )}
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      {anyMissing && (
        <p className="text-center text-[11px] text-muted-foreground">Hollow dots at the center mean that measure isn&apos;t reported.</p>
      )}
    </div>
  );
}
