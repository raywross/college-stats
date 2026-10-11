"use client";

import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { FEDERAL_TOP, INCOME_MAX, curvePoints, priceAt, type CostCurve as Curve } from "@/lib/cost-curve";
import type { MeritInfo } from "@/lib/merit";
import type { AnyCited } from "@/lib/lineage";
import {
  ESTIMATE_WORD,
  breakIncomeLabel,
  chartSummary,
  hasEstimate,
  incomeLabel,
  meritFloor,
  meritFloorLabel,
  needAidView,
  priceLabel,
  promiseChartLabel,
  readout,
  tableRows,
} from "@/lib/cost-display";
import { SourceTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { useWidth } from "./useWidth";

/** Where each part of the legend gets its citation (the page passes `citeField` results). */
export interface CostCurveCitations {
  published?: AnyCited;
  estimate?: AnyCited;
  breakPoint?: AnyCited;
  merit?: AnyCited;
  promise?: AnyCited;
}

const STEP = 5_000;
const COLOR = "var(--d-value)";
/** A surface-colored outline behind text that crosses a line, so it stays legible. */
const HALO = { paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3, strokeLinejoin: "round" } as const;

/** 1, 2, 2.5, 5 × 10^n steps giving about `count` ticks (as TrendLine). */
function niceTicks(hi: number, count = 4): number[] {
  const raw = hi / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** A label above the plot: the break point or a promise, placed in the first row it fits. */
interface LaneItem {
  key: string;
  kind: "break" | "promise";
  income: number;
  text: string;
}

/**
 * A college's cost as a curve over family income (specs/product/cost-by-income.md "How cost is shown"): published
 * federal figures as solid steps to $110K, a dashed estimate with its range above, where need-based aid ends, the
 * merit floor, and the college's published promises. Hover or focus reads a price at any income; a table view lists
 * the same. With estimates hidden (the accuracy pilot's gate) only the published part, merit, and promises are drawn.
 * `mini` is the overview card's version: income ticks only, no hover, no legend.
 */
export function CostCurve({
  curve,
  merit = null,
  showEstimates,
  citations = {},
  promiseYear = null,
  income = null,
  onPick,
  mini = false,
}: {
  curve: Curve;
  merit?: MeritInfo | null;
  /** From `estimatesShown()` on the server. */
  showEstimates: boolean;
  citations?: CostCurveCitations;
  /** The award year of the college's promises, from lineage ("2025–26"). */
  promiseYear?: string | null;
  /** The slider's income: a dot on the curve. */
  income?: number | null;
  /** Tapping or clicking the chart picks an income (moves the slider). */
  onPick?: (income: number) => void;
  mini?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(340);
  const [hover, setHover] = useState<number | null>(null);
  const narrow = width < 480;
  const estimate = hasEstimate(curve, showEstimates);
  const need = needAidView(curve, showEstimates);
  const floor = meritFloor(curve, merit);
  const floorLabel = meritFloorLabel(curve, merit);
  const breakMid = need.kind === "break_point" ? need.mid : null;

  const height = mini ? 84 : narrow ? 232 : 280;

  /* Lane above the plot: the break point and the promises, in rows so labels never overlap. */
  const items: LaneItem[] = [];
  if (!mini) {
    if (breakMid !== null) items.push({ key: "break", kind: "break", income: Math.min(INCOME_MAX, breakMid), text: `Need-based aid ends about here (${ESTIMATE_WORD})` });
    for (const p of curve.promises) items.push({ key: `p${p.income}${p.kind}`, kind: "promise", income: Math.min(INCOME_MAX, p.income), text: promiseChartLabel(p) });
  }
  const m = mini ? { top: 6, right: 8, bottom: 18, left: 8 } : { top: 8, right: 14, bottom: 24, left: 46 };
  const plotW = Math.max(40, width - m.left - m.right);
  const x = (inc: number) => m.left + (Math.min(INCOME_MAX, Math.max(0, inc)) / INCOME_MAX) * plotW;

  const CHAR = 5.4;
  const edgeLo = 2;
  const edgeHi = width - 2;
  /* Each label goes right of its mark, else left, else on a row of its own below the mark (clamped to the chart). */
  const used: [number, number][][] = [];
  const free = (row: number, a: number, b: number) => !(used[row] ?? []).some(([c, d]) => a < d + 6 && b > c - 6);
  const lane = items
    .map((it) => ({ ...it, px: x(it.income), w: it.text.length * CHAR + 4 }))
    .sort((a, b) => a.px - b.px)
    .map((it) => {
      const mode = it.px + 8 + it.w <= edgeHi ? ("right" as const) : it.px - 8 - it.w >= edgeLo ? ("left" as const) : ("below" as const);
      const x0 = mode === "right" ? it.px + 8 : mode === "left" ? it.px - 8 - it.w : Math.min(Math.max(it.px - it.w / 2, edgeLo), Math.max(edgeLo, edgeHi - it.w));
      const boxes: [number, number, number][] =
        mode === "below" ? [[0, it.px - 6, it.px + 6], [1, x0, x0 + it.w]] : [[0, Math.min(it.px - 6, x0), Math.max(it.px + 6, x0 + it.w)]];
      let row = 0;
      while (!boxes.every(([off, a, b]) => free(row + off, a, b))) row++;
      for (const [off, a, b] of boxes) (used[row + off] ??= []).push([a, b]);
      return { ...it, mode, x0, row };
    });
  const rowEnd = used.map(() => 0);
  const rows = rowEnd.length;
  const ROW_H = 15;
  const laneH = rows ? rows * ROW_H + 4 : 0;
  const top = m.top + laneH;
  const plotH = height - top - m.bottom;

  const ticks = niceTicks(curve.coa);
  const y = (v: number) => top + plotH - (Math.min(curve.coa, Math.max(0, v)) / curve.coa) * plotH;
  const bottom = top + plotH;

  /* Published steps. */
  const steps = curve.published;
  let stepPath = "";
  steps.forEach((s, i) => {
    const prev = steps[i - 1];
    stepPath += prev && prev.hi === s.lo ? `L${x(s.lo)},${y(s.price)}` : `M${x(s.lo)},${y(s.price)}`;
    stepPath += `L${x(s.hi)},${y(s.price)}`;
  });

  /* The estimate: mid line and range band from $110K. */
  const pts = estimate ? curvePoints(curve, true, STEP).filter((p) => p.income >= FEDERAL_TOP && p.kind !== "unknown") : [];
  const midPath = pts.length ? `M${pts.map((p) => `${x(p.income)},${y(p.mid)}`).join("L")}` : "";
  const bandPath = pts.length
    ? `M${pts.map((p) => `${x(p.income)},${y(p.hi)}`).join("L")}L${[...pts].reverse().map((p) => `${x(p.income)},${y(p.lo)}`).join("L")}Z`
    : "";

  /* Merit floor: from the break point on, or a short marker at the right edge when there is none. */
  const floorFrom = breakMid !== null ? Math.min(INCOME_MAX, breakMid) : INCOME_MAX * 0.875;
  const floorY = floor ? y(floor.price) : 0;
  const floorBelow = floor ? floorY + 14 < bottom : false;
  const floorRoom = x(INCOME_MAX) - x(floorFrom) - 6;
  const floorText = floorLabel && floor ? (floorLabel.length * 5.2 <= floorRoom ? floorLabel : `Merit: ${priceLabel(floor.price)}`) : null;

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    return Math.min(INCOME_MAX, Math.max(0, Math.round((t * INCOME_MAX) / STEP) * STEP));
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    const delta = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setHover((h) => Math.min(INCOME_MAX, Math.max(0, (h ?? income ?? 150_000) + (e.key === "ArrowLeft" ? -1 : 1) * delta * STEP)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setHover(e.key === "Home" ? 0 : INCOME_MAX);
    } else if ((e.key === "Enter" || e.key === " ") && hover !== null) {
      e.preventDefault();
      onPick?.(hover);
    }
  };

  const hoverPrice = hover !== null ? priceAt(curve, hover, showEstimates) : null;
  const hoverPhrase = hover !== null ? readout(curve, hover, showEstimates) : null;
  const dotPrice = income !== null ? priceAt(curve, income, showEstimates) : null;
  const summary = chartSummary(curve, merit, showEstimates).text;

  const xLabels: { at: number; text: string; anchor: "start" | "middle" | "end" }[] = mini
    ? [
        { at: 0, text: "$0", anchor: "start" },
        { at: FEDERAL_TOP, text: incomeLabel(FEDERAL_TOP), anchor: "middle" },
        ...(breakMid !== null && breakMid < INCOME_MAX && Math.abs(x(breakMid) - x(FEDERAL_TOP)) > 38 && x(INCOME_MAX) - x(breakMid) > 40
          ? [{ at: breakMid, text: breakIncomeLabel(breakMid).replace("about ", ""), anchor: "middle" as const }]
          : []),
        { at: INCOME_MAX, text: `${incomeLabel(INCOME_MAX)}+`, anchor: "end" },
      ]
    : (narrow ? [0, 100_000, 200_000, 300_000, 400_000] : [0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000]).map((v) => ({
        at: v,
        text: v === INCOME_MAX ? `${incomeLabel(v)}+` : incomeLabel(v),
        anchor: (v === 0 ? "start" : v === INCOME_MAX ? "end" : "middle") as "start" | "middle" | "end",
      }));

  return (
    <div ref={ref} className="relative w-full" data-cost-curve={mini ? "mini" : "full"}>
      {/* The readout has its own line, so it never covers the chart's labels. */}
      {!mini && (
        <p role="status" className={cn("mb-2 min-h-10 text-sm leading-snug sm:min-h-5", hoverPhrase ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {hoverPhrase ? hoverPhrase.text : "Hover, tap, or use the arrow keys to read the price at an income."}
        </p>
      )}
      <svg width={width} height={height} role="img" aria-label={summary} className="block overflow-visible">
        {/* Grid and y axis */}
        {!mini &&
          ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {priceLabel(t)}
              </text>
            </g>
          ))}
        {/* Baseline and income ticks */}
        <line x1={m.left} x2={m.left + plotW} y1={bottom} y2={bottom} stroke="var(--axis)" strokeWidth={1} />
        {xLabels.map((l) => (
          <g key={l.at}>
            <line x1={x(l.at)} x2={x(l.at)} y1={bottom} y2={bottom + 3} stroke="var(--axis)" strokeWidth={1} />
            <text x={x(l.at)} y={height - (mini ? 4 : 8)} textAnchor={l.anchor} className="fill-muted-foreground text-[10px] tabular-nums">
              {l.text}
            </text>
          </g>
        ))}

        {/* The full price: a thin rule across the top */}
        <line x1={m.left} x2={m.left + plotW} y1={y(curve.coa)} y2={y(curve.coa)} stroke="var(--foreground)" strokeOpacity={0.45} strokeWidth={1} />
        {!mini && (
          <text x={m.left + 4} y={y(curve.coa) + 12} className="fill-foreground text-[10px] font-semibold">
            Full price {priceLabel(curve.coa)}
          </text>
        )}

        {/* Where the federal data end */}
        <line x1={x(FEDERAL_TOP)} x2={x(FEDERAL_TOP)} y1={top} y2={bottom} stroke="var(--foreground)" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="1 3" />

        {/* Published steps */}
        {stepPath && (
          <>
            <path d={`${stepPath}L${x(steps[steps.length - 1].hi)},${bottom}L${x(steps[0].lo)},${bottom}Z`} fill={COLOR} opacity={0.14} />
            <path d={stepPath} fill="none" stroke={COLOR} strokeWidth={mini ? 2 : 2.75} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}

        {/* The estimate: range band, then the dashed middle */}
        {bandPath && <path d={bandPath} fill={COLOR} opacity={0.22} />}
        {midPath && <path d={midPath} fill="none" stroke={COLOR} strokeWidth={mini ? 2 : 2.5} strokeDasharray="6 4" strokeLinejoin="round" />}

        {/* No estimate: say so where it would be */}
        {!estimate && !mini && (
          <text x={x(FEDERAL_TOP) + 10} y={top + plotH * 0.68} className="fill-muted-foreground text-[11px]" style={HALO}>
            <tspan x={x(FEDERAL_TOP) + 10} dy="0">
              {need.kind === "little_above_110k" ? `Little need-based aid above ${incomeLabel(FEDERAL_TOP)}` : `Published data end at ${incomeLabel(FEDERAL_TOP)}`}
            </tspan>
            {need.kind !== "little_above_110k" && (
              <tspan x={x(FEDERAL_TOP) + 10} dy="14">
                Use the college&apos;s calculator
              </tspan>
            )}
          </text>
        )}

        {/* Merit floor */}
        {floor && (
          <g>
            <line x1={x(floorFrom)} x2={x(INCOME_MAX)} y1={floorY} y2={floorY} stroke="var(--muted-foreground)" strokeWidth={mini ? 1.25 : 1.75} strokeDasharray="3 3" />
            {!mini && floorText && (
              <text x={x(INCOME_MAX)} y={floorBelow ? floorY + 13 : floorY - 5} textAnchor="end" className="fill-muted-foreground text-[10px]" style={HALO}>
                {floorText}
              </text>
            )}
          </g>
        )}

        {/* Break point and promises: marks in the plot, labels in the lane above */}
        {breakMid !== null && need.kind === "break_point" && (
          <g>
            <rect x={x(need.lo)} y={bottom - 4} width={Math.max(2, x(need.hi) - x(need.lo))} height={4} fill="var(--foreground)" opacity={0.3} />
            <line x1={x(breakMid)} x2={x(breakMid)} y1={mini ? top : top - 2} y2={bottom} stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="5 3" />
          </g>
        )}
        {!mini &&
          lane.map((it) => {
            const cy = m.top + it.row * ROW_H + 7;
            const ty = it.mode === "below" ? cy + ROW_H : cy;
            const isBreak = it.kind === "break";
            return (
              <g key={it.key}>
                {!isBreak && <line x1={it.px} x2={it.px} y1={cy} y2={bottom} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="1 3" />}
                {isBreak ? (
                  <rect x={it.px - 4} y={cy - 4} width={8} height={8} fill="var(--foreground)" />
                ) : (
                  <path d={`M${it.px},${cy - 5}L${it.px + 5},${cy}L${it.px},${cy + 5}L${it.px - 5},${cy}Z`} fill="var(--card)" stroke="var(--foreground)" strokeWidth={1.5} />
                )}
                <text
                  x={it.mode === "right" ? it.px + 12 : it.mode === "left" ? it.px - 12 : it.x0}
                  y={ty}
                  dy="0.34em"
                  textAnchor={it.mode === "left" ? "end" : "start"}
                  className={cn("fill-foreground text-[10px]", isBreak ? "font-bold" : "font-medium")}
                  style={HALO}
                >
                  {it.text}
                </text>
              </g>
            );
          })}

        {/* The slider's income */}
        {income !== null && !mini && (
          <g pointerEvents="none">
            {dotPrice && dotPrice.kind !== "unknown" ? (
              <>
                <line x1={x(income)} x2={x(income)} y1={y((dotPrice.lo + dotPrice.hi) / 2)} y2={bottom} stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1} />
                {dotPrice.hi > dotPrice.lo && <line x1={x(income)} x2={x(income)} y1={y(dotPrice.lo)} y2={y(dotPrice.hi)} stroke="var(--foreground)" strokeWidth={4} strokeLinecap="round" />}
                <circle cx={x(income)} cy={y((dotPrice.lo + dotPrice.hi) / 2)} r={6} fill="var(--foreground)" stroke="var(--card)" strokeWidth={2.5} />
              </>
            ) : (
              <path d={`M${x(income)},${bottom - 9}L${x(income) + 6},${bottom}L${x(income) - 6},${bottom}Z`} fill="var(--foreground)" />
            )}
          </g>
        )}

        {/* Hover / focus crosshair */}
        {hover !== null && !mini && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={top} y2={bottom} stroke="var(--foreground)" strokeOpacity={0.4} strokeWidth={1} />
            {hoverPrice && hoverPrice.kind !== "unknown" && <circle cx={x(hover)} cy={y((hoverPrice.lo + hoverPrice.hi) / 2)} r={4} fill={COLOR} stroke="var(--card)" strokeWidth={2} />}
          </g>
        )}
        {!mini && (
          <rect
            x={m.left}
            y={top}
            width={plotW}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            aria-label={`${summary} Use the left and right arrow keys to read the price at each income.`}
            className="cursor-crosshair outline-none focus-visible:stroke-ring focus-visible:stroke-2"
            onPointerMove={(e) => setHover(pick(e))}
            onPointerDown={(e) => setHover(pick(e))}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => onPick?.(pickAt(e.currentTarget, e.clientX))}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            style={{ touchAction: "pan-y" }}
          />
        )}
      </svg>

      {!mini && (
        <Legend curve={curve} estimate={estimate} floor={floorLabel} citations={citations} promiseYear={promiseYear} hasMerit={!!floor} />
      )}
      {!mini && <CurveTable curve={curve} showEstimates={showEstimates} />}
    </div>
  );
}

function pickAt(el: SVGRectElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  return Math.min(INCOME_MAX, Math.max(0, Math.round((((clientX - rect.left) / rect.width) * INCOME_MAX) / STEP) * STEP));
}

function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg width={22} height={12} aria-hidden className="shrink-0">
      {children}
    </svg>
  );
}

/** One item per kind of mark, each with a source (i) where it states a figure. */
function Legend({
  curve,
  estimate,
  floor,
  hasMerit,
  citations,
  promiseYear,
}: {
  curve: Curve;
  estimate: boolean;
  floor: string | null;
  hasMerit: boolean;
  citations: CostCurveCitations;
  promiseYear: string | null;
}) {
  const item = "inline-flex items-center gap-1.5";
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      <li className={item}>
        <Swatch>
          <line x1={0} x2={22} y1={6} y2={6} stroke={COLOR} strokeWidth={2.75} />
        </Swatch>
        <span>Published federal figures</span>
        {citations.published && <SourceTip cited={citations.published} />}
      </li>
      {estimate && (
        <li className={item}>
          <Swatch>
            <rect x={0} y={1} width={22} height={10} fill={COLOR} opacity={0.22} />
            <line x1={0} x2={22} y1={6} y2={6} stroke={COLOR} strokeWidth={2.5} strokeDasharray="5 3" />
          </Swatch>
          <span>Our {ESTIMATE_WORD}, with its range</span>
          {citations.estimate && <SourceTip cited={citations.estimate} />}
        </li>
      )}
      {estimate && (
        <li className={item}>
          <Swatch>
            <line x1={11} x2={11} y1={0} y2={12} stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="4 2" />
          </Swatch>
          <span>Where need-based aid ends ({ESTIMATE_WORD})</span>
          {citations.breakPoint && <SourceTip cited={citations.breakPoint} />}
        </li>
      )}
      {hasMerit && floor && (
        <li className={item}>
          <Swatch>
            <line x1={0} x2={22} y1={6} y2={6} stroke="var(--muted-foreground)" strokeWidth={1.75} strokeDasharray="3 3" />
          </Swatch>
          <span>{floor}. A possibility, not a promise</span>
          {citations.merit && <SourceTip cited={citations.merit} />}
        </li>
      )}
      {curve.promises.length > 0 && (
        <li className={item}>
          <Swatch>
            <path d="M11,1L16,6L11,11L6,6Z" fill="var(--card)" stroke="var(--foreground)" strokeWidth={1.5} />
          </Swatch>
          <span>The college&apos;s published promise{promiseYear ? ` (${promiseYear} policy)` : ""}</span>
          {citations.promise && <SourceTip cited={citations.promise} />}
        </li>
      )}
    </ul>
  );
}

/** The same prices as a table (the accessible view). */
function CurveTable({ curve, showEstimates }: { curve: Curve; showEstimates: boolean }) {
  const rows = tableRows(curve, showEstimates);
  return (
    <details className="group mt-3 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-semibold text-primary hover:underline">View as a table</summary>
      <table className="mt-2 w-full max-w-md text-left text-xs">
        <caption className="sr-only">Price per year by family income</caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-semibold">
              Family income
            </th>
            <th scope="col" className="py-1.5 font-semibold">
              Price per year
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.income} className="border-b border-border/60">
              <th scope="row" className="py-1.5 pr-3 font-medium tabular-nums">
                {r.income}
              </th>
              <td className="py-1.5 tabular-nums">{r.price.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
