import Link from "next/link";
import { formatBy } from "@/lib/format";
import {
  SERIES,
  changeOver,
  defaultWindow,
  formatChange,
  historyYearLabel,
  inDollarsOf,
  isTinyBase,
  valueAt,
  type SchoolHistory,
  type SeriesKey,
} from "@/lib/history";
import type { HistoryFiles } from "@/lib/supabase";
import { Sparkline } from "@/components/charts/Sparkline";

/**
 * A muted "since" line under a section's headline number (specs/trends-design.md#profile-top-of-page): "Fall 2014:
 * 13%" for rates, "+9% since fall 2014" for counts, "+3% after inflation since 2013–14" for money, with a 60×16
 * sparkline of the window on ≥ sm screens. Renders nothing without both endpoints.
 */
export function HeadlineDelta({
  seriesKey,
  history,
  files,
  color,
  href,
}: {
  seriesKey: SeriesKey;
  history: SchoolHistory;
  files: HistoryFiles;
  color: string;
  /** Where "Over time" links: the college's history page (topicHref(id, "history")). */
  href: string;
}) {
  const def = SERIES[seriesKey];
  const window = defaultWindow(files.meta, def.kind);
  const c = changeOver(seriesKey, history.series[seriesKey], window, files.cpi);
  const s = history.series[seriesKey];
  if (!c || !s) return null;
  const since = historyYearLabel(c.from.year, def.kind);
  const text =
    def.unit === "share"
      ? `${since}: ${formatBy(def.format, c.from.value)}`
      : isTinyBase(c)
        ? `${since}: ${formatBy(def.format, c.from.value)}`
        : `${formatChange(c)}${def.unit === "usd" ? " after inflation" : ""} since ${since.charAt(0).toLowerCase()}${since.slice(1)}`;
  const shown = def.unit === "usd" ? inDollarsOf(s, def.unit, files.cpi, window[1]) : s;
  const values = Array.from({ length: window[1] - window[0] + 1 }, (_, i) => valueAt(shown, window[0] + i));
  return (
    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
      <span>{text}</span>
      <div className="hidden w-[60px] sm:block">
        <Sparkline compact height={16} start={window[0]} kind={def.kind} format={def.format} label={`${def.label}, ${historyYearLabel(window[0], def.kind)} to ${historyYearLabel(window[1], def.kind)}`} series={[{ name: def.short, color, values }]} />
      </div>
      <Link href={href} className="text-xs font-semibold text-primary hover:underline">
        Over time
      </Link>
    </div>
  );
}
