"use client";

import { useState } from "react";
import { num } from "@/lib/format";
import { gradPointShort, gradPointWords, gradTrendDomain, type GradTrendPoint } from "@/lib/high-school-ui";
import { useWidth } from "./useWidth";

/**
 * A high school's graduation rate by class (specs/charts.md "ClassTrend"): one column per class from the oldest to the
 * newest. An exact rate is a dot, joined by a 2px line to the next class only when that one is exact too (a published
 * range is never turned into a point); a range is an interval bar from its low to its high bound (open ranges run to
 * 100% or the axis floor); a suppressed class is a small hollow ring on the floor; a class the files skip is a gap.
 * The first and last rated classes are labeled; hover or tap a column for its class, rate, and cohort. Single series in
 * `--primary`, so no legend; the caption beside it carries the summary sentence and a screen-reader list.
 */
export function ClassTrend({ points, label }: { points: GradTrendPoint[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const [hover, setHover] = useState<number | null>(null);
  const height = width < 480 ? 130 : 150;
  const m = { top: 20, right: 10, bottom: 22, left: 38 };
  const plotW = Math.max(40, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const n = points.length;
  const slot = plotW / Math.max(1, n);
  const [lo, hi] = gradTrendDomain(points);
  const x = (i: number) => m.left + (i + 0.5) * slot;
  const y = (v: number) => m.top + plotH - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)) * plotH;
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelEvery = Math.max(1, Math.ceil(34 / slot));
  const rated = points.map((p, i) => [p, i] as const).filter(([p]) => p.kind === "exact" || p.kind === "range");
  const labeled = new Set(rated.length ? [rated[0][1], rated[rated.length - 1][1]] : []);
  const barW = Math.max(8, Math.min(14, slot * 0.4));

  const top = (p: GradTrendPoint) => (p.kind === "exact" ? y(p.value!) : p.kind === "range" ? Math.min(y(p.high!), (y(p.high!) + y(p.low!)) / 2 - 5) : y(lo));
  // Beside the hovered column (left of it in the right half), so the tooltip never covers the mark it describes.
  const tipLeft =
    hover === null ? 0 : x(hover) > width / 2 ? Math.max(0, x(hover) - slot / 2 - 164) : Math.min(Math.max(0, width - 160), x(hover) + slot / 2 + 4);

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          (n - 1 - i) % labelEvery === 0 ? (
            <text key={p.year} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
              {p.year}
            </text>
          ) : null,
        )}

        {/* Lines only between neighbouring exact classes */}
        {points.map((p, i) => {
          const q = points[i + 1];
          if (!q || p.kind !== "exact" || q.kind !== "exact") return null;
          return <line key={`l${p.year}`} x1={x(i)} y1={y(p.value!)} x2={x(i + 1)} y2={y(q.value!)} stroke="var(--primary)" strokeWidth={2} strokeLinecap="round" />;
        })}

        {points.map((p, i) => {
          if (p.kind === "range") {
            const y0 = y(p.high!);
            const y1 = y(p.low!);
            // A narrow range keeps a 10px bar, centred on its span, so it never reads as a dot.
            const h = Math.max(10, y1 - y0);
            return (
              <rect
                key={p.year}
                x={x(i) - barW / 2}
                y={(y0 + y1) / 2 - h / 2}
                width={barW}
                height={h}
                rx={3}
                fill="var(--primary)"
                fillOpacity={0.22}
                stroke="var(--primary)"
                strokeWidth={1.5}
              />
            );
          }
          if (p.kind === "exact") return <circle key={p.year} cx={x(i)} cy={y(p.value!)} r={4.5} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />;
          if (p.kind === "suppressed") return <circle key={p.year} cx={x(i)} cy={y(lo)} r={3.5} fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth={1.5} />;
          return null;
        })}

        {[...labeled].map((i) => (
          <text key={`v${i}`} x={x(i)} y={top(points[i]) - 7} textAnchor="middle" className="fill-foreground text-[10px] font-semibold tabular-nums">
            {gradPointShort(points[i])}
          </text>
        ))}

        {hover !== null && <rect x={x(hover) - slot / 2} y={m.top} width={slot} height={plotH} fill="var(--foreground)" opacity={0.05} pointerEvents="none" />}
        {points.map((p, i) => (
          <rect
            key={`h${p.year}`}
            x={x(i) - slot / 2}
            y={m.top}
            width={slot}
            height={plotH}
            fill="transparent"
            onPointerEnter={() => setHover(i)}
            onPointerDown={() => setHover(i)}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
            style={{ touchAction: "pan-y" }}
          />
        ))}
      </svg>
      {hover !== null && (
        <div role="status" className="pointer-events-none absolute top-0 z-10 w-[160px] rounded-xl border bg-popover p-2 text-xs text-popover-foreground shadow-lg" style={{ left: tipLeft }}>
          <p className="font-semibold">{points[hover].label}</p>
          <p className="text-muted-foreground">
            {gradPointWords(points[hover])}
            {points[hover].cohort !== null ? ` · cohort ${num(points[hover].cohort!)}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
