"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { SchoolType } from "@/lib/types";
import { compact, pctSmart, num, typeShort } from "@/lib/format";
import { Crest } from "@/components/school/Crest";
import { InfoTip } from "@/components/ui/info-tip";
import { useWidth } from "./useWidth";

export interface LandscapePoint {
  id: string;
  name: string;
  acceptance: number;
  sat: number;
  enrollment: number;
  type: SchoolType;
  city: string;
  state: string;
}

const SERIES: Record<"public" | "private", { label: string; color: string }> = {
  public: { label: "Public", color: "var(--s1)" },
  private: { label: "Private", color: "var(--s2)" },
};
const seriesOf = (t: SchoolType) => (t === "public" ? "public" : "private");

/**
 * The admissions landscape: acceptance rate (x) vs SAT midpoint (y),
 * dot area = undergrad enrollment, color = public/private.
 */
export function LandscapeScatter({
  points,
  highlight,
  focusId,
  height: fixedHeight,
}: {
  points: LandscapePoint[];
  /** When set, only these ids are emphasized; others fade back. */
  highlight?: string[];
  focusId?: string;
  height?: number;
}) {
  const router = useRouter();
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const narrow = width < 520;
  const height = fixedHeight ?? (narrow ? 340 : 440);
  const m = { top: 16, right: 16, bottom: 44, left: narrow ? 40 : 52 };
  const iw = Math.max(width - m.left - m.right, 100);
  const ih = height - m.top - m.bottom;

  const xMax = Math.max(0.1, Math.ceil(Math.max(0, ...points.map((p) => p.acceptance)) * 10) / 10);
  const yMin = Math.min(1300, Math.floor((Math.min(1600, ...points.map((p) => p.sat)) - 20) / 100) * 100);
  const yMax = 1600;
  const eMax = Math.max(1, ...points.map((p) => p.enrollment));

  const x = (v: number) => m.left + (v / xMax) * iw;
  const y = (v: number) => m.top + (1 - (v - yMin) / (yMax - yMin)) * ih;
  // Dense charts (hundreds of schools) get smaller, more translucent dots.
  const dense = points.length > 120;
  const rMin = dense ? 2.5 : narrow ? 4 : 5;
  const rSpan = dense ? (narrow ? 7 : 10) : narrow ? 10 : 15;
  const r = (e: number) => rMin + Math.sqrt(e / eMax) * rSpan;

  const xTicks = useMemo(() => {
    const step = xMax > 0.4 ? 0.1 : 0.05;
    const t: number[] = [];
    for (let v = 0; v <= xMax + 1e-9; v += step) t.push(Math.round(v * 100) / 100);
    return t;
  }, [xMax]);
  const yTicks = useMemo(() => {
    const t: number[] = [];
    for (let v = yMin; v <= yMax; v += 100) t.push(v);
    return t;
  }, [yMin]);

  const hl = highlight ? new Set(highlight) : null;
  // Draw big dots first so small ones stay clickable on top.
  const ordered = [...points].sort(
    (a, b) => Number(a.id === focusId) - Number(b.id === focusId) || b.enrollment - a.enrollment
  );
  const activeId = hover ?? pinned;
  const active = points.find((p) => p.id === activeId);
  const focus = points.find((p) => p.id === focusId);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        {(Object.keys(SERIES) as ("public" | "private")[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-full" style={{ backgroundColor: SERIES[k].color }} />
            <span className="font-medium">{SERIES[k].label}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-flex items-end gap-0.5">
            <span className="size-2 rounded-full border border-muted-foreground" />
            <span className="size-3.5 rounded-full border border-muted-foreground" />
          </span>
          Dot size = undergrads
        </span>
      </div>

      <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        ↑ SAT midpoint (higher = higher scores) <InfoTip term="sat" />
      </p>
      <div ref={ref} className="relative select-none" style={{ height }} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label="Scatter plot of acceptance rate versus SAT midpoint for each school">
          {/* Selectivity zone shading */}
          <rect x={m.left} y={m.top} width={Math.max(0, x(Math.min(0.1, xMax)) - m.left)} height={ih} fill="var(--d-admissions)" opacity={0.06} />
          {/* Grid */}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={`x${t}`}>
              <line x1={x(t)} x2={x(t)} y1={m.top} y2={m.top + ih} stroke="var(--grid)" />
              <text x={x(t)} y={m.top + ih + 16} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          <line x1={m.left} x2={width - m.right} y1={m.top + ih} y2={m.top + ih} stroke="var(--axis)" />
          <text x={m.left + 6} y={m.top + 14} className="fill-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
            Most selective zone
          </text>

          {/* Dots */}
          {ordered.map((p) => {
            const color = SERIES[seriesOf(p.type)].color;
            const faded = hl && !hl.has(p.id);
            const isActive = p.id === activeId || p.id === focusId;
            return (
              <circle
                key={p.id}
                cx={x(p.acceptance)}
                cy={y(p.sat)}
                r={r(p.enrollment) + (isActive ? 2 : 0)}
                fill={color}
                fillOpacity={faded ? 0.1 : isActive ? 1 : dense ? 0.55 : 0.78}
                stroke={isActive ? "var(--foreground)" : "var(--card)"}
                strokeWidth={dense && !isActive ? 1 : 2}
                className="cursor-pointer outline-none transition-[r,fill-opacity] duration-200 focus-visible:stroke-[var(--foreground)]"
                tabIndex={0}
                role="link"
                aria-label={`${p.name}: ${pctSmart(p.acceptance)} acceptance, SAT midpoint ${p.sat}, ${num(p.enrollment)} undergrads`}
                onMouseEnter={() => setHover(p.id)}
                onFocus={() => setHover(p.id)}
                onBlur={() => setHover(null)}
                onPointerUp={(e) => {
                  if (e.pointerType === "mouse") router.push(`/schools/${p.id}`);
                  else setPinned((cur) => (cur === p.id ? null : p.id));
                }}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/schools/${p.id}`)}
              />
            );
          })}

          {/* Focus label */}
          {focus && focus.id !== activeId && (
            <g pointerEvents="none">
              <text
                x={x(focus.acceptance) + r(focus.enrollment) + 6}
                y={y(focus.sat)}
                dy="0.32em"
                className="fill-foreground text-[12px] font-bold"
                stroke="var(--card)"
                strokeWidth={4}
                paintOrder="stroke"
              >
                {focus.name}
              </text>
            </g>
          )}
        </svg>

        {/* Axis titles */}
        <div className="absolute right-0 bottom-0 left-0 flex justify-center text-[11px] font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            Acceptance rate → less selective <InfoTip term="acceptance-rate" />
          </span>
        </div>

        {/* Tooltip card */}
        {active && (
          <div
            className="absolute z-10 w-60 rounded-2xl border bg-popover p-3 shadow-2xl shadow-black/15"
            style={{
              left: Math.min(Math.max(x(active.acceptance) - 120, 0), width - 240),
              top: y(active.sat) > height / 2 ? Math.max(y(active.sat) - r(active.enrollment) - 132, 0) : y(active.sat) + r(active.enrollment) + 10,
            }}
            onMouseEnter={() => setHover(active.id)}
          >
            <div className="flex items-center gap-2.5">
              <Crest id={active.id} name={active.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{active.name}</p>
                <p className="text-xs text-muted-foreground">
                  {active.city}, {active.state} · {typeShort(active.type)}
                </p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/70 px-1 py-1.5">
                <dt className="text-[10px] text-muted-foreground">Admit</dt>
                <dd className="text-sm font-bold">{pctSmart(active.acceptance)}</dd>
              </div>
              <div className="rounded-lg bg-muted/70 px-1 py-1.5">
                <dt className="text-[10px] text-muted-foreground">SAT mid</dt>
                <dd className="text-sm font-bold">{active.sat}</dd>
              </div>
              <div className="rounded-lg bg-muted/70 px-1 py-1.5">
                <dt className="text-[10px] text-muted-foreground">Undergrads</dt>
                <dd className="text-sm font-bold">{compact(active.enrollment)}</dd>
              </div>
            </dl>
            <Link
              href={`/schools/${active.id}`}
              className="mt-2.5 flex items-center justify-center gap-1 rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground"
            >
              View profile <ArrowRight className="size-3.5" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
