"use client";

import { useState } from "react";
import { num, pct } from "@/lib/format";
import { OUTCOME_PARTS, OUTCOME_GROUPS, outcomeHeadline, type OutcomeGroupKey } from "@/lib/outcome-measures";
import type { EightYearGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

type Part = (typeof OUTCOME_PARTS)[number]["key"];

/** "0.06%" reads as "0%", which looks like none: say "<1%". */
const share = (v: number) => (v > 0 && v < 0.005 ? "<1%" : pct(v));

/**
 * Where entering students stand 8 years on (IPEDS Outcome Measures): one 100% bar, earned here → still here →
 * enrolled elsewhere → no record. One hue in lightness steps (the parts are ordered), gray for "no record"; the legend
 * always carries the label and value, so color is never the only cue. A toggle switches between all students,
 * students who started in college here, and transfer students (specs/data-expansion/outcome-measures.md).
 */
export function OutcomeBar({
  groups,
  color = "var(--d-value)",
}: {
  /** Only groups with rates to show (lib/outcome-measures.ts isShown), in OUTCOME_GROUPS order. */
  groups: Partial<Record<OutcomeGroupKey, EightYearGroup>>;
  color?: string;
}) {
  const available = OUTCOME_GROUPS.filter((g) => groups[g.key]);
  const [selected, setSelected] = useState<OutcomeGroupKey>(available[0]?.key ?? "all");
  const [active, setActive] = useState<Part | null>(null);
  const meta = available.find((g) => g.key === selected) ?? available[0];
  const g = meta ? groups[meta.key] : undefined;
  if (!meta || !g) return null;

  const fill: Record<Part, string> = {
    award: color,
    still_enrolled: `color-mix(in oklch, ${color} 55%, transparent)`,
    transferred: `color-mix(in oklch, ${color} 30%, transparent)`,
    // Gray from the text ink, so it stays visible on the dark card (--muted nearly vanishes there).
    unknown: "color-mix(in oklch, var(--muted-foreground) 35%, transparent)",
  };
  const parts = OUTCOME_PARTS.map((p) => ({ ...p, value: g[p.key] ?? 0 }));
  const shown = parts.filter((p) => p.value > 0);
  const activePart = parts.find((p) => p.key === active);

  return (
    <figure className="space-y-4">
      {available.length > 1 && (
        <div className="inline-flex flex-wrap gap-1 rounded-full border bg-surface-2 p-1" role="group" aria-label="Which students">
          {available.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={o.key === meta.key}
              onClick={() => setSelected(o.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                o.key === meta.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <p className="text-sm">
        {outcomeHeadline(g, meta.who)} <span className="text-muted-foreground">({num(g.cohort)} students)</span>
      </p>
      <div className="relative">
        <div
          className="flex h-6 w-full gap-[2px] overflow-hidden rounded-lg"
          role="img"
          aria-label={`${meta.label}, 8 years after entering: ${parts.map((p) => `${p.label} ${share(p.value)}`).join(", ")}`}
          onMouseLeave={() => setActive(null)}
        >
          {shown.map((p) => (
            <div
              key={p.key}
              className="h-full origin-left animate-grow-x transition-opacity first:rounded-l-lg last:rounded-r-lg"
              style={{ width: `${p.value * 100}%`, backgroundColor: fill[p.key], opacity: active && active !== p.key ? 0.35 : 1 }}
              onMouseEnter={() => setActive(p.key)}
            />
          ))}
        </div>
        {activePart && (
          <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-lg">
            {activePart.label}: {share(activePart.value)}
          </div>
        )}
      </div>
      <figcaption>
        <ul className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          {parts.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onMouseEnter={() => setActive(p.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(p.key)}
                onBlur={() => setActive(null)}
                className={cn("flex w-full items-center gap-2 text-left transition-opacity", active && active !== p.key && "opacity-50")}
              >
                <span className="size-3 shrink-0 rounded-[3px] ring-1 ring-foreground/10" style={{ backgroundColor: fill[p.key] }} aria-hidden />
                <span className="text-muted-foreground">{p.label}</span>
                <span className="ml-auto font-semibold tabular-nums">{share(p.value)}</span>
              </button>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
