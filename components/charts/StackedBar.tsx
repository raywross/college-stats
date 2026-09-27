"use client";

import { useState } from "react";
import { DEMOGRAPHIC_CATEGORIES } from "@/lib/metrics";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

type Breakdown = Record<string, number>;

/**
 * Race/ethnicity part-to-whole. Categories keep a fixed order (so each keeps
 * its color and neighbors); hovering a segment or legend item highlights it.
 */
export function StackedBar({
  data,
  height = "h-8",
  showLegend = true,
  label,
}: {
  data: Breakdown;
  height?: string;
  showLegend?: boolean;
  label?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const items = DEMOGRAPHIC_CATEGORIES.map((c) => ({ ...c, value: data[c.key] ?? 0 })).filter((i) => i.value > 0);
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const activeItem = items.find((i) => i.key === active);

  return (
    <div className="space-y-3">
      <div className="relative">
        <div
          className={cn("flex w-full gap-[2px] overflow-hidden rounded-lg", height)}
          role="img"
          aria-label={`${label ?? "Race/ethnicity"}: ${items.map((i) => `${i.label} ${pct(i.value)}`).join(", ")}`}
          onMouseLeave={() => setActive(null)}
        >
          {items.map((item) => (
            <div
              key={item.key}
              className="h-full origin-left animate-grow-x cursor-default transition-opacity first:rounded-l-lg last:rounded-r-lg"
              style={{
                width: `${(item.value / total) * 100}%`,
                backgroundColor: item.color,
                opacity: active && active !== item.key ? 0.3 : 1,
              }}
              onMouseEnter={() => setActive(item.key)}
            />
          ))}
        </div>
        {activeItem && (
          <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-lg">
            {activeItem.label}: {pct(activeItem.value)}
          </div>
        )}
      </div>
      {showLegend && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onMouseEnter={() => setActive(item.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(item.key)}
                onBlur={() => setActive(null)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md text-left text-xs transition-opacity",
                  active && active !== item.key && "opacity-50"
                )}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate text-muted-foreground">{item.label}</span>
                <span className="ml-auto font-semibold tabular-nums">{pct(item.value)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
