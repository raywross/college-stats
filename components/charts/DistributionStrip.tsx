"use client";

import { useState } from "react";
import type { TermKey } from "@/lib/glossary";
import { MetricLabel } from "@/components/ui/info-tip";
import { formatBy, num, type FormatKind } from "@/lib/format";

export interface Distribution {
  bins: number[];
  min: number;
  max: number;
  n: number;
}

/**
 * "Where it sits": the distribution of a metric across every reporting
 * college (a compact histogram), with this school pinned on top.
 * Replaces a per-school beeswarm, which can't show ~2,000 dots legibly.
 */
export function DistributionStrip({
  label,
  term,
  dist,
  value,
  rank,
  format,
  color,
  lowLabel,
  highLabel,
  rankPhrase = "higher than",
}: {
  label: string;
  term?: TermKey;
  dist: Distribution;
  value: number | null;
  /** 0..1 share of schools below this value. */
  rank: number | null;
  format: FormatKind;
  color: string;
  lowLabel?: string;
  highLabel?: string;
  /** How to phrase the rank, e.g. "more selective than" with an inverted rank. */
  rankPhrase?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { bins, min, max, n } = dist;
  const peak = Math.max(1, ...bins);
  const width = (max - min) / bins.length;
  const pos = value === null ? null : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const focusBin = pos === null ? -1 : Math.min(bins.length - 1, Math.floor((pos / 100) * bins.length));
  const f = (v: number) => formatBy(format, v);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <MetricLabel term={term} className="text-sm font-medium">
          {label}
        </MetricLabel>
        <span className="shrink-0 text-sm font-semibold whitespace-nowrap">{value === null ? "Not reported" : f(value)}</span>
      </div>

      <div className="relative pt-7">
        {/* Pin */}
        {pos !== null && (
          <div className="pointer-events-none absolute top-0 bottom-0 z-10 -translate-x-1/2" style={{ left: `${pos}%` }}>
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {f(value!)}
            </span>
            <span className="absolute top-5 bottom-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-foreground" />
          </div>
        )}

        {/* Histogram */}
        <div className="flex h-12 items-end gap-px" role="img" aria-label={`Distribution of ${label} across ${n} colleges`}>
          {bins.map((count, i) => (
            <div
              key={i}
              className="relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="w-full rounded-t-[2px] transition-colors"
                style={{
                  height: `${count === 0 ? 2 : 8 + (count / peak) * 92}%`,
                  backgroundColor:
                    i === focusBin || i === hover ? color : `color-mix(in oklch, ${color} 28%, var(--muted))`,
                }}
              />
            </div>
          ))}
        </div>
        {hover !== null && (
          <div
            className="pointer-events-none absolute -bottom-7 z-20 -translate-x-1/2 rounded-lg bg-foreground px-2 py-1 text-[11px] font-medium whitespace-nowrap text-background shadow-lg"
            style={{ left: `${Math.min(88, Math.max(12, ((hover + 0.5) / bins.length) * 100))}%` }}
          >
            {num(bins[hover])} colleges · {f(min + hover * width)}–{f(min + (hover + 1) * width)}
          </div>
        )}
        <div className="h-px bg-axis" />
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>← {lowLabel ?? f(min)}</span>
        {rank !== null && (
          <span className="normal-case tracking-normal">
            {rankPhrase} <b className="text-foreground">{Math.round(rank * 100)}%</b> of {num(n)}
          </span>
        )}
        <span>{highLabel ?? f(max)} →</span>
      </div>
    </div>
  );
}
