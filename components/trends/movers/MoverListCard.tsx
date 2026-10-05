import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { historyYearLabel, type YearKind } from "@/lib/history";
import {
  EXCLUSION_LABELS,
  MOVER_EXCLUSIONS,
  formatMoverChange,
  moverExploreHref,
  moverSeries,
  shownEntries,
  type MoverListDef,
  type MoverResult,
  type MoverWindow,
} from "@/lib/movers";
import type { HistoryFiles } from "@/lib/supabase";
import type { School } from "@/lib/types";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { Term } from "@/components/ui/info-tip";
import { MoverRows } from "./MoverRows";
import { ShowRest } from "./ShowRest";

/** "fall 2014", "2013–14", or "fall 2008" for an entering class, for use mid-sentence. */
export function moverYear(year: number, kind: YearKind): string {
  return kind === "cohort" ? `fall ${year}` : historyYearLabel(year, kind).replace(/^Fall/, "fall");
}

/** "2,000+ applicants in fall 2014"; lists with floors at both ends name both years. */
export function floorSentence(def: MoverListDef, list: Pick<MoverResult, "from" | "to" | "kind">): string {
  const from = moverYear(list.from, list.kind);
  return def.floors.some((f) => f.at === "both") ? `${def.floorText} (classes entering ${from} and ${moverYear(list.to, list.kind)})` : `${def.floorText} in ${from}`;
}

/**
 * One movers list as a card: title, the median college's change, the ranked ten (ties at the tenth included) with
 * "Show 25", and, unless `compact`, the method note, Explore link, and sources. `id` is the anchor the page's list
 * row jumps to.
 */
export function MoverListCard({
  def,
  list,
  window,
  schools,
  files,
  shown,
  compact = false,
}: {
  def: MoverListDef;
  list: MoverResult;
  window: MoverWindow;
  schools: ReadonlyMap<string, School>;
  files: HistoryFiles;
  /** Rows before "Show …" (the file's `shown`, or fewer on the /trends entry). */
  shown: number;
  compact?: boolean;
}) {
  const first = shownEntries(list.entries, shown);
  const rest = compact ? [] : list.entries.slice(first.length);
  const max = Math.max(0, ...list.entries.map((e) => Math.abs(e.change)));
  const span = `${moverYear(list.from, list.kind)} to ${moverYear(list.to, list.kind)}`;
  const explore = moverExploreHref(def);
  const excluded = MOVER_EXCLUSIONS.filter((k) => list.excluded[k]);
  const closed = (list.excluded["closed-or-merged"] ?? 0) + (list.excluded["under-300"] ?? 0);
  const cohort = list.kind === "cohort" ? "Classes entering " : "";
  return (
    <section id={def.key} aria-labelledby={`${def.key}-title`} className="min-w-0 scroll-mt-24 rounded-3xl border bg-card p-4 sm:p-5">
      <h2 id={`${def.key}-title`} className="font-display text-xl font-bold tracking-tight">
        {def.title}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        <Term term={def.term}>{def.measure}</Term>
        {def.change === "ratio" && def.series[0] === "avg_paid_all" && <> (in {moverYear(list.to, list.kind)} dollars)</>}, {cohort}
        {span}
      </p>
      {list.median !== null && (
        <p className="mt-2 text-sm">
          Median college: <b className="tabular-nums">{formatMoverChange(def, list.median)}</b>{" "}
          <span className="text-muted-foreground">
            ({list.n.toLocaleString("en-US")} colleges ranked)
          </span>
        </p>
      )}

      <div className="mt-3 -mx-2">
        {first.length ? (
          <MoverRows def={def} list={list} entries={first} schools={schools} max={max} />
        ) : (
          <p className="px-2 text-sm text-muted-foreground">No college moved this way over the window.</p>
        )}
        {rest.length > 0 && (
          <ShowRest count={rest.length} total={list.entries.length}>
            <MoverRows def={def} list={list} entries={rest} schools={schools} max={max} start={first.length + 1} />
          </ShowRest>
        )}
      </div>

      {!compact && (
        <>
          {def.decline && (
            <p className="mt-3 text-xs text-muted-foreground">
              Smaller can be deliberate: a college ending programs or a system consolidating campuses shrinks on purpose. The list shows how much, not why.
              {closed > 0 && <> {closed.toLocaleString("en-US")} colleges that closed, merged, or are winding down aren&apos;t listed.</>}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            <b className="text-foreground">Who&apos;s ranked:</b> {def.types?.includes("public") && def.types.length === 1 ? "public colleges" : "colleges"} with{" "}
            {floorSentence(def, list)}.
            {excluded.length > 0 && (
              <>
                {" "}
                Left out:{" "}
                {excluded.map((k, i) => (
                  <span key={k}>
                    {k === "online-first" ? <Term term="online-first">{EXCLUSION_LABELS[k]}</Term> : EXCLUSION_LABELS[k]} ({list.excluded[k]!.toLocaleString("en-US")})
                    {i < excluded.length - 1 ? "; " : "."}
                  </span>
                ))}
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {explore && (
              <Link href={explore} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                {window === 10 ? "See all in Explore" : "See the ten-year ranking in Explore"} <ArrowRight className="size-3.5" />
              </Link>
            )}
            {def.decline && closed > 0 && def.explore && (
              <Link
                href={`/explore?${new URLSearchParams({ sortBy: def.explore.sortBy, sortDir: def.explore.sortDir, view: "table" })}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary hover:underline"
              >
                Including them <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
        </>
      )}
      <HistorySourceNote keys={moverSeries(def)} files={files} range={{ [list.kind]: [list.from, list.to], fall: [list.from, files.meta.latest.fall] }} className="mt-3" />
      {compact && (
        <Link href={`/trends/movers#${def.key}`} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
          Top {Math.min(list.entries.length, 10)} and how it&apos;s ranked <ArrowRight className="size-3.5" />
        </Link>
      )}
    </section>
  );
}
