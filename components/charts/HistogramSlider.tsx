"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";

/**
 * Range slider with the distribution drawn above it (Airbnb-price style),
 * so you can see how many schools each choice includes.
 */
export function HistogramSlider({
  bins,
  min,
  max,
  step = 1,
  value,
  format,
  onCommit,
  label,
}: {
  bins: number[];
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  format: (v: number) => string;
  onCommit: (v: [number, number]) => void;
  label: string;
}) {
  const [draft, setDraft] = useState<[number, number]>(value);
  const [synced, setSynced] = useState(value);
  // Re-sync when the URL-driven value changes (e.g. "Clear all").
  if (synced[0] !== value[0] || synced[1] !== value[1]) {
    setSynced(value);
    setDraft(value);
  }

  const peak = Math.max(1, ...bins);
  const binWidth = (max - min) / bins.length;

  return (
    <div className="space-y-2">
      <div className="flex h-12 items-end gap-[2px]" aria-hidden>
        {bins.map((count, i) => {
          const lo = min + i * binWidth;
          const hi = lo + binWidth;
          const inside = hi > draft[0] && lo < draft[1];
          return (
            <div
              key={i}
              className="flex-1 rounded-t-[3px] transition-colors"
              style={{
                height: `${count === 0 ? 4 : 12 + (count / peak) * 88}%`,
                backgroundColor: inside ? "var(--primary)" : "var(--muted)",
                opacity: count === 0 ? 0.5 : 1,
              }}
            />
          );
        })}
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        onValueChange={(v) => Array.isArray(v) && setDraft([v[0], v[1]])}
        onValueCommitted={(v) => Array.isArray(v) && onCommit([v[0], v[1]])}
      />
      <div className="flex justify-between text-xs">
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-semibold tabular-nums">{format(draft[0])}</span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-semibold tabular-nums">{format(draft[1])}</span>
      </div>
    </div>
  );
}
