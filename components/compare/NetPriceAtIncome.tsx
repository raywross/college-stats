"use client";

import { useState, useSyncExternalStore } from "react";
import type { CostCurve } from "@/lib/cost-curve";
import { FEDERAL_BANDS, FEDERAL_TOP, INCOME_MAX } from "@/lib/cost-curve";
import type { MeritInfo } from "@/lib/merit";
import { TABLE_INCOMES, dollarsK, incomeLabel, meritNote, priceText } from "@/lib/cost-at-income";
import { INCOME_INPUT } from "@/lib/cost-explore";
import { readIncome, subscribeIncome, writeIncome } from "@/lib/income-memory";
import { SLOT_COLORS } from "@/lib/brand";
import { Slider } from "@/components/ui/slider";
import { SegmentedControl } from "@/components/ui/segmented-control";

/** One compared college, as the server worked it out (everything here is plain data). */
export interface IncomeEntry {
  id: string;
  name: string;
  /** Index into SLOT_COLORS: the college's compare-slot color. */
  slot: number;
  curve: CostCurve | null;
  merit: MeritInfo;
  /** The published average over every income above $110K (cost.net_price_by_income[4]), for the table. */
  over110: number | null;
}

type View = "bars" | "table";

/** Solid for a published price; stripes (hatched) for anything the model estimated. */
function fill(color: string, estimated: boolean, faint = false): string {
  if (!estimated) return color;
  const a = faint ? 40 : 100;
  const b = faint ? 14 : 38;
  return `repeating-linear-gradient(135deg, color-mix(in oklab, ${color} ${a}%, transparent) 0 4px, color-mix(in oklab, ${color} ${b}%, transparent) 4px 7px)`;
}

const TICKS = [0, FEDERAL_TOP, 200_000, 300_000, INCOME_MAX];

/**
 * Each college's price at one family income (specs/product/cost-by-income.md "Compare"). A slider sets the income
 * ($0–$400K, default $150K, remembered in this browser only); each college gets one bar on a shared scale (the largest
 * full price among them): solid where the price is a published federal figure, hatched where it is our estimate, with
 * "estimate" in words beside it. Above $110K with estimates hidden (the pilot's gate), a college says "Published data
 * end at $110K". A table view lists the same prices at fixed incomes.
 */
export function NetPriceAtIncome({ entries, showEstimates }: { entries: IncomeEntry[]; showEstimates: boolean }) {
  const remembered = useSyncExternalStore(subscribeIncome, () => readIncome() ?? INCOME_INPUT.default, () => INCOME_INPUT.default);
  const [draft, setDraft] = useState<number | null>(null);
  const [view, setView] = useState<View>("bars");
  const income = draft ?? remembered;
  const scaleMax = Math.max(1, ...entries.map((e) => e.curve?.coa ?? 0));
  const pos = (v: number) => `${(v / scaleMax) * 100}%`;
  // Colleges whose table cells above $110K are dashes say why, once, under the table.
  const statusNotes = entries
    .map((e) => ({ id: e.id, name: e.name, message: priceText(e.curve, INCOME_MAX, showEstimates).message }))
    .filter((n): n is { id: string; name: string; message: string } => n.message !== null);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm">
            <span className="text-muted-foreground">Family income per year </span>
            <span className="font-display text-xl font-extrabold tabular-nums">{incomeLabel(income)}</span>
          </p>
          <SegmentedControl<View>
            label="Show prices as"
            value={view}
            onChange={setView}
            options={[
              { value: "bars", label: "Bars" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
        <div className="px-1.5 py-2">
          <Slider
            aria-label="Family income per year"
            min={INCOME_INPUT.min}
            max={INCOME_INPUT.max}
            step={INCOME_INPUT.step}
            value={[income]}
            onValueChange={(v) => Array.isArray(v) && setDraft(v[0])}
            onValueCommitted={(v) => Array.isArray(v) && writeIncome(v[0])}
          />
          <div className="relative mt-2 h-8 text-[11px] text-muted-foreground" aria-hidden>
            {TICKS.map((t) => (
              <span
                key={t}
                className="absolute top-0 whitespace-nowrap tabular-nums"
                style={{ left: `${(t / INCOME_MAX) * 100}%`, transform: t === 0 ? "none" : t === INCOME_MAX ? "translateX(-100%)" : "translateX(-50%)" }}
              >
                {t === INCOME_MAX ? `${dollarsK(t)}+` : dollarsK(t)}
                {t === FEDERAL_TOP && <span className="block text-[10px]">published data end</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {view === "bars" ? (
        <>
          <ul className="space-y-4">
            {entries.map((e) => {
              const t = priceText(e.curve, income, showEstimates);
              const color = SLOT_COLORS[e.slot];
              const note = meritNote(e.merit, t.kind, income);
              const estimated = t.estimate;
              return (
                <li key={e.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                      <span className="truncate">{e.name}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-bold tabular-nums">
                      {t.kind === "full_price" ? "Full price " : ""}
                      {t.value ?? <span className="font-normal text-muted-foreground">{t.message}</span>}
                      {estimated && <span className="ml-1 text-[11px] font-normal text-muted-foreground">estimate</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${e.name}: ${t.value ?? t.message}${estimated ? " (estimate)" : ""}`}>
                    {t.lo !== null && t.hi !== null && (
                      <div className="relative h-full">
                        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150" style={{ width: pos(t.lo), minWidth: 3, background: fill(color, estimated) }} />
                        {estimated && t.hi > t.lo && (
                          <span className="absolute inset-y-0 transition-[left,width] duration-150" style={{ left: pos(t.lo), width: `calc(${pos(t.hi)} - ${pos(t.lo)})`, background: fill(color, true, true) }} />
                        )}
                      </div>
                    )}
                  </div>
                  {(note || (e.curve && income > FEDERAL_TOP && t.kind === "estimate" && e.curve.breakIncome)) && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t.kind === "estimate" && e.curve?.breakIncome && <>Need-based aid ends about {dollarsK(e.curve.breakIncome.mid)} (estimate). </>}
                      {note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded-full bg-foreground/70" aria-hidden /> Published (federal figure, up to {dollarsK(FEDERAL_TOP)})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded-full" style={{ background: fill("var(--foreground)", true) }} aria-hidden /> Estimate
            </span>
            <span>Bars share one scale: the largest full price.</span>
          </p>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Price per year by family income, for each college</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="sticky left-0 bg-card py-2 pr-4 font-semibold">
                  Family income
                </th>
                {entries.map((e) => (
                  <th key={e.id} scope="col" className="px-3 py-2 font-bold text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[e.slot] }} aria-hidden />
                      {e.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {TABLE_INCOMES.flatMap((row, i) => {
                const cells = (
                  <tr key={row.label}>
                    <th scope="row" className="sticky left-0 bg-card py-2 pr-4 text-left font-normal text-muted-foreground">
                      {row.label}
                    </th>
                    {entries.map((e) => {
                      const t = priceText(e.curve, row.income, showEstimates);
                      return (
                        <td key={e.id} className="px-3 py-2 font-semibold">
                          {t.kind === "full_price" ? "Full price " : ""}
                          {t.value ?? <span className="font-normal text-muted-foreground">{row.income > FEDERAL_TOP ? "–" : t.message}</span>}
                          {t.estimate && <span className="block text-[11px] font-normal text-muted-foreground">estimate</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
                // The published average for every income above $110K closes the federal bands.
                return i === FEDERAL_BANDS.length - 1
                  ? [
                      cells,
                      <tr key="over110">
                        <th scope="row" className="sticky left-0 bg-card py-2 pr-4 text-left font-normal text-muted-foreground">
                          Over {dollarsK(FEDERAL_TOP)}, average
                        </th>
                        {entries.map((e) => (
                          <td key={e.id} className="px-3 py-2 font-semibold">
                            {e.over110 === null ? <span className="font-normal text-muted-foreground">–</span> : dollarsK(e.over110)}
                          </td>
                        ))}
                      </tr>,
                    ]
                  : [cells];
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            The average over {dollarsK(FEDERAL_TOP)} is what all families above that income who filed the FAFSA paid.
            {statusNotes.map((n) => (
              <span key={n.id} className="block">
                {n.name}: {n.message}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
