"use client";

import { useState } from "react";
import { INCOME_MAX, priceAt, type CostCurve as Curve } from "@/lib/cost-curve";
import type { MeritInfo } from "@/lib/merit";
import type { AidPolicy } from "@/lib/aid-policies";
import type { AnyCited } from "@/lib/lineage";
import { changeNotes, incomeLabel, meritFloorLabel, needAidView, partOfCurve, readout } from "@/lib/cost-display";
import { CostCurve, type CostCurveCitations } from "@/components/charts/CostCurve";
import { SourceTip } from "@/components/ui/info-tip";

const DEFAULT_INCOME = 150_000;

/**
 * The cost curve with an income slider under it ("At your income", specs/product/cost-by-income.md): drag to move a dot
 * along the curve and read the price range and which part of the curve it is on; tap the chart to pick an income. The
 * income lives in memory only (nothing is saved). Under it, what can move a real family's price off the curve.
 */
export function CostAtIncome({
  curve,
  merit,
  showEstimates,
  citations,
  promiseYear,
  name,
  policy,
  methodology,
  noteCited,
}: {
  curve: Curve;
  merit: MeritInfo | null;
  showEstimates: boolean;
  citations: CostCurveCitations;
  promiseYear: string | null;
  name: string;
  policy: AidPolicy | null;
  methodology: "federal" | "institutional" | "both" | null;
  /** Citations for the notes that state a source's fact, by field path. */
  noteCited: Record<string, AnyCited | undefined>;
}) {
  const [income, setIncome] = useState(DEFAULT_INCOME);
  const phrase = readout(curve, income, showEstimates);
  const part = partOfCurve(curve, income, showEstimates);
  const need = needAidView(curve, showEstimates);
  const past = need.kind === "break_point" && priceAt(curve, income, showEstimates).kind === "full_price";
  const merit_ = past ? meritFloorLabel(curve, merit) : null;
  const notes = changeNotes({ name, policy, methodology });

  return (
    <div className="space-y-5">
      <CostCurve curve={curve} merit={merit} showEstimates={showEstimates} citations={citations} promiseYear={promiseYear} income={income} onPick={setIncome} />

      <div className="rounded-2xl border bg-muted/30 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <label htmlFor="cost-income" className="font-display text-base font-bold">
            At your income
          </label>
          <output htmlFor="cost-income" className="font-display text-lg font-extrabold tabular-nums">
            {incomeLabel(income)} a year
          </output>
        </div>
        <input
          id="cost-income"
          type="range"
          min={0}
          max={INCOME_MAX}
          step={5_000}
          value={income}
          onChange={(e) => setIncome(Number(e.target.value))}
          aria-valuetext={`${incomeLabel(income)} family income`}
          className="mt-2 block h-11 w-full cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
          <span>$0</span>
          <span>{incomeLabel(INCOME_MAX)}+</span>
        </div>
        <div className="mt-3 space-y-1" aria-live="polite">
          <p className="font-display text-lg leading-snug font-extrabold">{phrase.text}</p>
          <p className="text-sm text-muted-foreground">{part.text}</p>
          {merit_ && <p className="text-sm text-muted-foreground">{merit_}. Merit aid isn&apos;t a promise.</p>}
          <p className="text-xs text-muted-foreground">
            {priceAt(curve, income, showEstimates).kind === "unknown" ? "" : "Families like yours typically pay in this range. "}
            Your own number depends on the details below, so use the college&apos;s calculator for it.
          </p>
        </div>
      </div>

      <div>
        <h4 className="font-display text-base font-bold">What can change this</h4>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          {notes.map((n) => (
            <li key={n.key} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
              <span>
                {n.text}
                {n.field && noteCited[n.field] && <SourceTip cited={noteCited[n.field]!} className="ml-1" />}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
