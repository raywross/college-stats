import Link from "next/link";
import { BookMarked, ExternalLink } from "lucide-react";
import { getData } from "@/lib/data";
import { SERIES, historySources, type SeriesKey } from "@/lib/history";
import type { HistoryFiles } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Footnote for year-by-year values: each survey behind the series with the range of editions used ("IPEDS
 * Admissions survey, Fall 2014 to Fall 2024"), plus the inflation index when money is shown. Years come from
 * data/history/meta.json, so they update with each build. See specs/trends-data.md.
 */
export async function HistorySourceNote({
  keys,
  files,
  range,
  className,
}: {
  keys: readonly SeriesKey[];
  files: HistoryFiles;
  /** Only the years shown (e.g. a 10-year fact); all years otherwise. */
  range?: [number, number];
  className?: string;
}) {
  const { getMeta } = await getData();
  const sources = historySources(keys, files.meta, getMeta(), range);
  const money = keys.some((k) => SERIES[k].unit === "usd");
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <BookMarked className="size-3.5 shrink-0" aria-hidden />
      <span>{sources.length > 1 || money ? "Sources" : "Source"}:</span>
      {sources.map((s, i) => (
        <span key={`${s.key}${s.label}`}>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Files: ${s.files}`}
            className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary"
          >
            {s.label}
            <ExternalLink className="size-2.5" aria-hidden />
          </a>
          , {s.years}
          {i < sources.length - 1 || money ? ";" : ""}
        </span>
      ))}
      {money && (
        <span>
          inflation:{" "}
          <a
            href={files.cpi.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary"
          >
            BLS CPI-U
            <ExternalLink className="size-2.5" aria-hidden />
          </a>
          , school-year averages
        </span>
      )}
      <span aria-hidden>·</span>
      <Link href="/data" className="font-medium hover:text-primary hover:underline">
        About the data
      </Link>
      <span className="sr-only">(built {files.meta.built}; CPI retrieved {files.cpi.retrieved})</span>
    </p>
  );
}
