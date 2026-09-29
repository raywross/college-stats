import { ArrowRight } from "lucide-react";
import { formatBy } from "@/lib/format";
import { SERIES, formatChange, historyYearLabel, isTinyBase, tenYearSummary, type Change, type SchoolHistory } from "@/lib/history";
import type { HistoryFiles } from "@/lib/supabase";
import { InfoTip } from "@/components/ui/info-tip";

const LABELS: Partial<Record<Change["key"], string>> = {
  full_price: "Full price",
  acceptance_rate: "Acceptance rate",
  applicants: "Applications",
  undergrads: "Undergrads",
  grant_pct: "Share with grants",
};

function ChangeLine({ c }: { c: Change }) {
  const def = SERIES[c.key];
  const money = def.unit === "usd";
  const fmt = money ? "moneyCompact" : def.format;
  return (
    <li className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{LABELS[c.key] ?? def.short}</span>
      <span className="tabular-nums">
        {formatBy(fmt, c.from.value)} → {formatBy(fmt, c.to.value)}
        {!isTinyBase(c) && <b className="ml-1.5">{formatChange(c)}</b>}
      </span>
    </li>
  );
}

/**
 * Overview bento: how this college changed over the default 10-year window (specs/trends-design.md). Always average
 * total cost after inflation, then up to two notable changes; "Steady" when nothing stands out. Links to #history.
 */
export function TenYearTile({ history, files }: { history: SchoolHistory; files: HistoryFiles }) {
  const { avgCost, notable } = tenYearSummary(history, files.national, files.cpi, files.meta);
  if (!avgCost && !notable.length) return null;
  return (
    <div className="col-span-2 flex flex-col rounded-3xl border bg-card p-4 sm:p-5">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        10 years <InfoTip term="inflation-adjusted" />
      </p>
      {avgCost && (
        <div className="mt-3">
          <p className="font-display text-2xl font-extrabold tabular-nums sm:text-3xl">
            {formatBy("moneyCompact", avgCost.from.value)} <span className="text-muted-foreground">→</span> {formatBy("moneyCompact", avgCost.to.value)}
          </p>
          <p className="text-xs text-muted-foreground">
            Average total cost, <b className="text-foreground">{formatChange(avgCost)}</b> after inflation since {historyYearLabel(avgCost.from.year, "academic")}
          </p>
        </div>
      )}
      {notable.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t pt-3">
          {notable.map((c) => (
            <ChangeLine key={c.key} c={c} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{avgCost ? "Otherwise steady" : "Steady"} over 10 years compared with other colleges.</p>
      )}
      <a href="#history" className="group mt-auto inline-flex items-center gap-1 self-start pt-3 text-xs font-bold text-primary hover:underline">
        See how it&apos;s changed <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </a>
    </div>
  );
}
