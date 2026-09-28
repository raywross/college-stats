import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { School } from "@/lib/types";
import { DOMAINS } from "@/lib/metrics";
import { historyYearLabel } from "@/lib/history";
import { detailText, indicatorOf, indicatorsOf, type Direction, type Indicator, type IndicatorKey } from "@/lib/indicators";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/*
 * Trend indicators (specs/trend-indicators.md). Direction is neutral, never good/bad: the icon wears the measure's
 * domain color (identity) and the word carries the meaning, so nothing relies on color alone.
 */

const ICONS: Record<Direction, typeof TrendingUp> = { up: TrendingUp, steady: Minus, down: TrendingDown };

/** "since fall 2014" / "since 2013–14": the start year inside a sentence. */
function since(i: Indicator): string {
  return `since ${historyYearLabel(i.trend.since, i.def.kind).replace(/^Fall/, "fall")}`;
}

/** Full sentence for tooltips and screen readers: "Cost: Falling, −12% after inflation since 2013–14". */
export function indicatorSentence(i: Indicator): string {
  return `${i.def.label}: ${i.def.words[i.direction]}, ${detailText(i)} ${since(i)}`;
}

export function DirectionIcon({ indicator: i, className }: { indicator: Indicator; className?: string }) {
  const Icon = ICONS[i.direction];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className ?? "size-7")}
      style={{
        backgroundColor: `color-mix(in oklch, ${DOMAINS[i.def.domain].color} ${i.direction === "steady" ? 8 : 16}%, transparent)`,
        color: i.direction === "steady" ? "var(--muted-foreground)" : DOMAINS[i.def.domain].color,
      }}
    >
      <Icon className="size-[60%]" strokeWidth={2.5} />
    </span>
  );
}

/** Profile hero: one card per indicator the college has history for. */
export function TrendIndicatorStrip({ school, className }: { school: School; className?: string }) {
  const list = indicatorsOf(school);
  if (!list.length) return null;
  return (
    <div className={className}>
      <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        Over 10 years <InfoTip term="trend-direction" />
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {list.map((i) => (
          <li key={i.def.key}>
            <a
              href="#history"
              title={indicatorSentence(i)}
              className="flex h-full items-start gap-2.5 rounded-2xl border bg-card/80 px-3 py-2.5 backdrop-blur transition-colors hover:border-foreground/30"
            >
              <DirectionIcon indicator={i} className="mt-0.5 size-7" />
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold text-muted-foreground">{i.def.label}</span>
                <span className="block font-display text-base leading-tight font-extrabold">{i.def.words[i.direction]}</span>
                <span className="block text-[11px] text-muted-foreground tabular-nums">
                  {detailText(i)} <span className="whitespace-nowrap">{since(i)}</span>
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** School card: a compact 2×2 grid; the full sentence is in the title and for screen readers. */
export function TrendIndicatorGrid({ school, className }: { school: School; className?: string }) {
  const list = indicatorsOf(school);
  if (!list.length) return null;
  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">10-year direction</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {list.map((i) => (
          <li key={i.def.key} title={indicatorSentence(i)} className="flex min-w-0 items-center gap-1.5 text-xs">
            <DirectionIcon indicator={i} className="size-5" />
            <span className="sr-only">{indicatorSentence(i)}</span>
            <span aria-hidden className="truncate">
              <span className="text-muted-foreground">{i.def.label}</span> <b>{shortWord(i)}</b>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Card-sized word: the label already names the quality ("Selectivity Up", not "Selectivity More selective"). */
function shortWord(i: Indicator): string {
  if (i.def.key === "diversity" || i.def.key === "selectivity") return i.direction === "up" ? "Up" : i.direction === "down" ? "Down" : "Steady";
  return i.def.words[i.direction];
}

/** Compare: one cell per college and indicator; a dash when its history can't say. */
export function TrendIndicatorCell({ school, indicator }: { school: School; indicator: IndicatorKey }) {
  const i = indicatorOf(school, indicator);
  if (!i) return <span className="text-sm text-muted-foreground">Not enough data</span>;
  return (
    <span className="flex items-start gap-2">
      <DirectionIcon indicator={i} className="mt-0.5 size-6" />
      <span className="min-w-0">
        <span className="block text-sm font-bold">{i.def.words[i.direction]}</span>
        <span className="block text-[11px] text-muted-foreground tabular-nums">
          {detailText(i)} {since(i)}
        </span>
      </span>
    </span>
  );
}
