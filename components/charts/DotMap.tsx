"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MapPoint } from "@/lib/us-map";
import { compact, pctSmart } from "@/lib/format";
import { DotCard, DotLegend, SERIES, seriesOf } from "./ScatterPlot";
import { useWidth } from "./useWidth";

/** Hover finds the nearest dot within this many screen pixels (a 24px+ target even for the smallest dots). */
const HIT_RADIUS = 14;
const CARD_W = 240;

/**
 * Colleges on a U.S. outline: dot area = undergrads, color = public/private, as in ScatterPlot.
 * Hover picks the nearest dot; mouse click opens the profile; a touch tap pins the card.
 */
export function DotMap({
  points,
  outline,
  box,
}: {
  points: MapPoint[];
  outline: { nation: string; borders: string };
  box: { width: number; height: number };
}) {
  const router = useRouter();
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const k = width / box.width; // screen px per map unit
  const height = box.height * k;
  const narrow = width < 520;
  const eMax = Math.max(1, ...points.map((p) => p.enrollment));
  const dense = points.length > 120;
  // Radii in screen px, drawn in map units.
  const rPx = (e: number) => (dense ? 2 : narrow ? 3 : 4) + Math.sqrt(e / eMax) * (dense ? (narrow ? 6 : 10) : narrow ? 9 : 14);
  const r = (e: number) => rPx(e) / k;

  // Big dots first so small ones stay visible on top.
  const ordered = [...points].sort((a, b) => b.enrollment - a.enrollment);
  const activeId = hover ?? pinned;
  const active = points.find((p) => p.id === activeId);

  function nearest(clientX: number, clientY: number): string | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mx = (clientX - rect.left) / k;
    const my = (clientY - rect.top) / k;
    let best: string | null = null;
    let bestD = Infinity;
    for (const p of points) {
      // Distance to the dot's edge, so a big dot is hit anywhere inside it.
      const d = Math.max(0, Math.hypot(p.x - mx, p.y - my) - r(p.enrollment)) * k;
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return bestD <= HIT_RADIUS ? best : null;
  }

  return (
    <div className="space-y-3">
      <DotLegend />
      <div ref={ref} className="relative select-none" style={{ height }} onMouseLeave={() => setHover(null)}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          role="img"
          aria-label={`Map of ${points.length} colleges. Switch to the table view for a list.`}
          className={hover ? "cursor-pointer" : undefined}
          onPointerMove={(e) => e.pointerType === "mouse" && setHover(nearest(e.clientX, e.clientY))}
          onPointerUp={(e) => {
            const id = nearest(e.clientX, e.clientY);
            if (e.pointerType === "mouse") {
              if (id) router.push(`/schools/${id}`);
            } else setPinned((cur) => (id === cur ? null : id));
          }}
        >
          <path d={outline.nation} fill="var(--muted)" stroke="none" />
          <path d={outline.borders} fill="none" stroke="var(--card)" strokeWidth={1.5 / k} strokeLinejoin="round" />
          {ordered.map((p) => {
            const isActive = p.id === activeId;
            return (
              <circle
                key={p.id}
                cx={p.x}
                cy={p.y}
                r={r(p.enrollment) + (isActive ? 2 / k : 0)}
                fill={SERIES[seriesOf(p.type)].color}
                fillOpacity={isActive ? 1 : dense ? 0.6 : 0.8}
                stroke={isActive ? "var(--foreground)" : "var(--card)"}
                strokeWidth={(dense && !isActive ? 1 : 2) / k}
                pointerEvents="none"
              />
            );
          })}
          {active && (
            // Redraw the active dot on top of its neighbors.
            <circle
              cx={active.x}
              cy={active.y}
              r={r(active.enrollment) + 2 / k}
              fill={SERIES[seriesOf(active.type)].color}
              stroke="var(--foreground)"
              strokeWidth={2 / k}
              pointerEvents="none"
            />
          )}
        </svg>

        {active && (
          <div
            className="absolute z-10 w-60 rounded-2xl border bg-popover p-3 shadow-2xl shadow-black/15"
            style={{
              left: Math.min(Math.max(active.x * k - CARD_W / 2, 0), Math.max(width - CARD_W, 0)),
              top:
                active.y * k > height / 2
                  ? Math.max(active.y * k - rPx(active.enrollment) - 142, 0)
                  : active.y * k + rPx(active.enrollment) + 10,
            }}
            onMouseEnter={() => setHover(active.id)}
          >
            <DotCard
              school={active}
              stats={[
                { k: "Setting", v: active.setting ?? "—" },
                { k: "Admit", v: active.admit !== null ? pctSmart(active.admit) : "—" },
                { k: "Undergrads", v: compact(active.enrollment) },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
