"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { SchoolType } from "@/lib/types";
import type { TermKey } from "@/lib/glossary";
import { compact, formatBy, num, typeShort, type FormatKind } from "@/lib/format";
import { Crest } from "@/components/school/Crest";
import { InfoTip } from "@/components/ui/info-tip";
import { useWidth } from "./useWidth";

export interface ScatterPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  enrollment: number;
  type: SchoolType;
  city: string;
  state: string;
}

/** Serializable axis config, so server pages can describe the chart. */
export interface AxisSpec {
  /** Axis title, e.g. "Acceptance rate". */
  label: string;
  /** Short label for the tooltip, e.g. "Admit". */
  short: string;
  /** Direction hint appended to the title, e.g. "less selective". */
  hint?: string;
  term?: TermKey;
  format: FormatKind;
  step: number;
  min?: number;
  max?: number;
}

export interface ScatterZone {
  x: [number, number];
  y: [number, number];
  label: string;
}

const SERIES: Record<"public" | "private", { label: string; color: string }> = {
  public: { label: "Public", color: "var(--s1)" },
  private: { label: "Private", color: "var(--s2)" },
};
const seriesOf = (t: SchoolType) => (t === "public" ? "public" : "private");

function domainOf(values: number[], spec: AxisSpec): [number, number] {
  const lo = spec.min ?? Math.floor(Math.min(...values) / spec.step) * spec.step;
  const hi = spec.max ?? Math.ceil(Math.max(...values) / spec.step) * spec.step;
  return hi > lo ? [lo, hi] : [lo, lo + spec.step];
}

function ticksOf([lo, hi]: [number, number], step: number): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * Scatter of schools: dot area = undergrads, color = public/private.
 * Hover/focus shows a card; mouse click opens the profile; a touch tap pins
 * the card (with a "View profile" button).
 */
export function ScatterPlot({
  points,
  x: xSpec,
  y: ySpec,
  zone,
  diagonal,
  highlight,
  focusId,
  height: fixedHeight,
}: {
  points: ScatterPoint[];
  x: AxisSpec;
  y: AxisSpec;
  zone?: ScatterZone;
  /** Draw the y = x line with this label (e.g. "No aid: pays full price"). */
  diagonal?: string;
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
  const m = { top: 16, right: 16, bottom: 44, left: narrow ? 44 : 56 };
  const iw = Math.max(width - m.left - m.right, 100);
  const ih = height - m.top - m.bottom;

  const xDom = useMemo(() => domainOf(points.length ? points.map((p) => p.x) : [0, 1], xSpec), [points, xSpec]);
  const yDom = useMemo(() => domainOf(points.length ? points.map((p) => p.y) : [0, 1], ySpec), [points, ySpec]);
  const xTicks = useMemo(() => ticksOf(xDom, xSpec.step), [xDom, xSpec.step]);
  const yTicks = useMemo(() => ticksOf(yDom, ySpec.step), [yDom, ySpec.step]);
  const eMax = Math.max(1, ...points.map((p) => p.enrollment));

  const x = (v: number) => m.left + ((v - xDom[0]) / (xDom[1] - xDom[0])) * iw;
  const y = (v: number) => m.top + (1 - (v - yDom[0]) / (yDom[1] - yDom[0])) * ih;
  // Dense charts (hundreds of schools) get smaller, more translucent dots.
  const dense = points.length > 120;
  const rMin = dense ? 2.5 : narrow ? 4 : 5;
  const rSpan = dense ? (narrow ? 7 : 10) : narrow ? 10 : 15;
  const r = (e: number) => rMin + Math.sqrt(e / eMax) * rSpan;
  const fx = (v: number) => formatBy(xSpec.format, v);
  const fy = (v: number) => formatBy(ySpec.format, v);

  const hl = highlight ? new Set(highlight) : null;
  // Big dots first so small ones stay clickable; the focused school on top.
  const ordered = [...points].sort(
    (a, b) => Number(a.id === focusId) - Number(b.id === focusId) || b.enrollment - a.enrollment
  );
  const activeId = hover ?? pinned;
  const active = points.find((p) => p.id === activeId);
  const focus = points.find((p) => p.id === focusId);

  const clampX = (v: number) => Math.min(Math.max(v, xDom[0]), xDom[1]);
  const clampY = (v: number) => Math.min(Math.max(v, yDom[0]), yDom[1]);

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
        ↑ {ySpec.label}
        {ySpec.hint && <> ({ySpec.hint})</>}
        {ySpec.term && <InfoTip term={ySpec.term} />}
      </p>
      <div ref={ref} className="relative select-none" style={{ height }} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={`Scatter plot of ${xSpec.label} versus ${ySpec.label}`}>
          {zone && (
            <g>
              <rect
                x={x(clampX(zone.x[0]))}
                y={y(clampY(zone.y[1]))}
                width={Math.max(0, x(clampX(zone.x[1])) - x(clampX(zone.x[0])))}
                height={Math.max(0, y(clampY(zone.y[0])) - y(clampY(zone.y[1])))}
                fill="var(--d-admissions)"
                opacity={0.06}
              />
              <text
                x={x(clampX(zone.x[0])) + 6}
                y={y(clampY(zone.y[1])) + 14}
                className="fill-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
              >
                {zone.label}
              </text>
            </g>
          )}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {fy(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={`x${t}`}>
              <line x1={x(t)} x2={x(t)} y1={m.top} y2={m.top + ih} stroke="var(--grid)" />
              <text x={x(t)} y={m.top + ih + 16} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
                {fx(t)}
              </text>
            </g>
          ))}
          <line x1={m.left} x2={width - m.right} y1={m.top + ih} y2={m.top + ih} stroke="var(--axis)" />
          {diagonal &&
            (() => {
              // Solid reference line where y = x, clipped to the shared part of both domains.
              const lo = Math.max(xDom[0], yDom[0]);
              const hi = Math.min(xDom[1], yDom[1]);
              if (hi <= lo) return null;
              return (
                <g pointerEvents="none">
                  <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="var(--foreground)" strokeOpacity={0.45} strokeWidth={1.5} />
                  <text
                    x={x(hi) - 4}
                    y={y(hi) + 14}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
                  >
                    {diagonal}
                  </text>
                </g>
              );
            })()}

          {ordered.map((p) => {
            const color = SERIES[seriesOf(p.type)].color;
            const faded = hl && !hl.has(p.id);
            const isActive = p.id === activeId || p.id === focusId;
            return (
              <circle
                key={p.id}
                cx={x(p.x)}
                cy={y(p.y)}
                r={r(p.enrollment) + (isActive ? 2 : 0)}
                fill={color}
                fillOpacity={faded ? 0.1 : isActive ? 1 : dense ? 0.55 : 0.78}
                stroke={isActive ? "var(--foreground)" : "var(--card)"}
                strokeWidth={dense && !isActive ? 1 : 2}
                className="cursor-pointer outline-none transition-[r,fill-opacity] duration-200"
                tabIndex={0}
                role="link"
                aria-label={`${p.name}: ${xSpec.short} ${fx(p.x)}, ${ySpec.short} ${fy(p.y)}, ${num(p.enrollment)} undergrads`}
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

          {focus && focus.id !== activeId && (
            <text
              // Flip the label to the dot's left when it would run off the right edge (~6.5px per character).
              {...(x(focus.x) + r(focus.enrollment) + 6 + focus.name.length * 6.5 > width - 4
                ? { x: x(focus.x) - r(focus.enrollment) - 6, textAnchor: "end" as const }
                : { x: x(focus.x) + r(focus.enrollment) + 6 })}
              y={y(focus.y)}
              dy="0.32em"
              className="pointer-events-none fill-foreground text-[12px] font-bold"
              stroke="var(--card)"
              strokeWidth={4}
              paintOrder="stroke"
            >
              {focus.name}
            </text>
          )}
        </svg>

        <div className="absolute right-0 bottom-0 left-0 flex justify-center text-[11px] font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {xSpec.label}
            {xSpec.hint && <> → {xSpec.hint}</>}
            {xSpec.term && <InfoTip term={xSpec.term} />}
          </span>
        </div>

        {active && (
          <div
            className="absolute z-10 w-60 rounded-2xl border bg-popover p-3 shadow-2xl shadow-black/15"
            style={{
              left: Math.min(Math.max(x(active.x) - 120, 0), width - 240),
              top:
                y(active.y) > height / 2
                  ? Math.max(y(active.y) - r(active.enrollment) - 132, 0)
                  : y(active.y) + r(active.enrollment) + 10,
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
              {[
                { k: xSpec.short, v: fx(active.x) },
                { k: ySpec.short, v: fy(active.y) },
                { k: "Undergrads", v: compact(active.enrollment) },
              ].map((d) => (
                <div key={d.k} className="rounded-lg bg-muted/70 px-1 py-1.5">
                  <dt className="truncate text-[10px] text-muted-foreground">{d.k}</dt>
                  <dd className="text-sm font-bold">{d.v}</dd>
                </div>
              ))}
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
