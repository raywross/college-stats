"use client";

import { useWidth } from "@/components/charts/useWidth";
import { pct } from "@/lib/format";
import { axisYearLabel } from "@/lib/history";

export interface ApplicationPanel {
  key: string;
  label: string;
  groups: { key: string; label: string; shares: number[] }[];
}

const COLORS = ["var(--demo-1)", "var(--demo-2)", "var(--demo-3)", "var(--demo-4)"];

function Panel({ panel, falls }: { panel: ApplicationPanel; falls: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(300);
  const height = 140;
  const m = { top: 10, right: 18, bottom: 22, left: 36 };
  const plotW = Math.max(40, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const all = panel.groups.flatMap((g) => g.shares);
  const hi = Math.min(1, Math.ceil((Math.max(...all) + 0.02) * 10) / 10);
  const lo = 0;
  const x = (y: number) => m.left + ((y - falls[0]) / Math.max(1, falls[falls.length - 1] - falls[0])) * plotW;
  const yv = (v: number) => m.top + plotH * (1 - (v - lo) / (hi - lo || 1));
  const ticks = [lo, hi / 2, hi];
  return (
    <figure className="min-w-0 rounded-2xl border bg-card p-3">
      <figcaption className="text-sm font-semibold">{panel.label}</figcaption>
      <div ref={ref} className="mt-2">
        <svg width={width} height={height} className="block" role="img" aria-label={`Share of applications by ${panel.label.toLowerCase()}: ${panel.groups.map((g) => `${g.label} ${g.shares.map((s) => pct(s, 1)).join(", ")}`).join("; ")}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={yv(t)} y2={yv(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={m.left - 6} y={yv(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {pct(t)}
              </text>
            </g>
          ))}
          {falls.map((y) => (
            <text key={y} x={x(y)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
              {axisYearLabel(y, "fall")}
            </text>
          ))}
          {panel.groups.map((g, i) => (
            <g key={g.key}>
              <polyline
                points={g.shares.map((s, j) => `${x(falls[j])},${yv(s)}`).join(" ")}
                fill="none"
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {g.shares.map((s, j) => (
                <circle key={j} cx={x(falls[j])} cy={yv(s)} r={3} fill={COLORS[i % COLORS.length]} stroke="var(--card)" strokeWidth={1.5} />
              ))}
            </g>
          ))}
        </svg>
      </div>
      <ul className="mt-2 space-y-1 text-xs" aria-label="Legend">
        {panel.groups.map((g, i) => (
          <li key={g.key} className="flex items-baseline gap-1.5">
            <span className="size-2.5 shrink-0 translate-y-0.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{g.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{g.shares.map((s) => pct(s, 1)).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * Study 7's applications companion (specs/trends/where-students-go.md, section 7): each group's share of all
 * applications at the few falls the data allows, as small lines on a time axis (points placed by year, so uneven
 * gaps read as uneven), one panel per grouping. Values printed in the legend.
 */
export function ApplicationLines({ panels, falls }: { panels: ApplicationPanel[]; falls: number[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {panels.map((p) => (
        <Panel key={p.key} panel={p} falls={falls} />
      ))}
    </div>
  );
}
