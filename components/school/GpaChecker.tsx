"use client";

import { useState } from "react";
import { GPA_BANDS, gpaMiddleHalf, gpaPosition } from "@/lib/cds/admissions";
import { pct } from "@/lib/format";
import type { GpaBands } from "@/lib/types";
import { cn } from "@/lib/utils";

type Column = "all" | "with_test" | "without_test";
const COLUMN_LABELS: Record<Column, string> = { all: "All", with_test: "Sent test scores", without_test: "Didn't send scores" };

/** The bar's six segments: the top five bands, then everything below 3.0 together (all nine are in the table). */
const GROUPS: readonly { label: string; bands: readonly number[] }[] = [
  { label: "4.0", bands: [0] },
  { label: "3.75–3.99", bands: [1] },
  { label: "3.50–3.74", bands: [2] },
  { label: "3.25–3.49", bands: [3] },
  { label: "3.00–3.24", bands: [4] },
  { label: "below 3.0", bands: [5, 6, 7, 8] },
];
const groupOf = (band: number) => GROUPS.findIndex((g) => g.bands.includes(band));
const fmtGpa = (v: number) => (v === 4 ? "4.0" : v.toFixed(2));

/**
 * The GPA band bar with a column toggle and "Where would you land?" (specs/data-expansion/cds-admissions.md,
 * Display 4): an unweighted 4.0-scale GPA placed among the bands with `gpaPosition`, never against the average.
 */
export function GpaChecker({ columns, color }: { columns: Partial<Record<Column, GpaBands>>; color: string }) {
  const available = (["all", "with_test", "without_test"] as const).filter((c) => columns[c]);
  const [col, setCol] = useState<Column>(available[0] ?? "all");
  const [raw, setRaw] = useState("");
  const bands = columns[col];
  if (!bands) return null;
  const total = bands.reduce((a, b) => a + b, 0) || 1;
  const groups = GROUPS.map((g) => ({ ...g, share: g.bands.reduce((a, i) => a + bands[i], 0) / total }));
  const mid = gpaMiddleHalf(bands);
  const value = Number(raw);
  const pos = raw !== "" && Number.isFinite(value) ? gpaPosition(bands, value) : null;
  const marker = pos?.kind === "band" ? groupOf(pos.index) : null;
  // Centre of the marked segment, as a share of the bar.
  const markerAt = marker === null ? null : groups.slice(0, marker).reduce((a, g) => a + g.share, 0) + groups[marker].share / 2;

  return (
    <div className="space-y-4">
      {available.length > 1 && (
        <div role="radiogroup" aria-label="Which first-years" className="inline-flex flex-wrap rounded-full border bg-card p-0.5">
          {available.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={col === c}
              onClick={() => setCol(c)}
              className={cn("rounded-full px-3 py-1 text-xs font-bold", col === c ? "bg-foreground text-background" : "text-muted-foreground")}
            >
              {COLUMN_LABELS[c]}
            </button>
          ))}
        </div>
      )}

      <div className="relative pt-5">
        {markerAt !== null && (
          <span className="absolute top-0 -translate-x-1/2 text-[11px] font-bold" style={{ left: `${markerAt * 100}%` }}>
            You ▾
          </span>
        )}
        <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-lg" role="img" aria-label={`First-years by high school GPA: ${groups.map((g) => `${g.label} ${pct(g.share)}`).join(", ")}`}>
          {groups.map((g, i) =>
            g.share > 0 ? (
              <div
                key={g.label}
                className={cn("h-full first:rounded-l-lg last:rounded-r-lg", marker === i && "ring-2 ring-foreground ring-inset")}
                style={{ width: `${g.share * 100}%`, backgroundColor: `color-mix(in oklch, ${color} ${100 - i * 15}%, transparent)` }}
                title={`${g.label}: ${pct(g.share)}`}
              />
            ) : null
          )}
        </div>
        <ul className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs sm:grid-cols-6">
          {groups.map((g, i) => (
            <li key={g.label} className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${color} ${100 - i * 15}%, transparent)` }} />
              <span className="text-muted-foreground">{g.label}</span>
              <span className="ml-auto font-semibold tabular-nums">{pct(g.share)}</span>
            </li>
          ))}
        </ul>
      </div>
      {mid && (
        <p className="text-sm text-muted-foreground">
          The middle half had GPAs of {fmtGpa(mid.low)}–{fmtGpa(mid.high)}.
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-dashed bg-surface-2 p-4 sm:flex-row sm:items-center">
        <label htmlFor="gpa-checker" className="text-sm font-semibold sm:mr-auto">
          Your GPA (unweighted, 4.0 scale)
        </label>
        <input
          id="gpa-checker"
          inputMode="decimal"
          placeholder="e.g. 3.80"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/[^0-9.]/g, "").slice(0, 4))}
          className="h-9 w-28 rounded-full border bg-card px-4 text-sm font-semibold tabular-nums outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/15"
        />
      </div>
      {pos?.kind === "over-scale" && <p className="text-sm">Enter your unweighted GPA; this college&apos;s breakdown uses a 4.0 scale.</p>}
      {pos?.kind === "band" && (
        <p className="text-sm" aria-live="polite">
          Your {value.toFixed(2)} is in the {pos.label} band, with {pct(pos.share)} of enrolled first-years. {pct(pos.higher)} had a higher GPA, {pct(pos.lower)} lower.
        </p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">All nine bands</summary>
        <table className="mt-2 w-full max-w-sm text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-semibold">GPA</th>
              <th className="py-1 font-semibold">{COLUMN_LABELS[col]}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {GPA_BANDS.map((b, i) => (
              <tr key={b.label}>
                <td className="py-1">{b.label}</td>
                <td className="py-1 font-semibold">{pct(bands[i] / total, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
