import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, TrendingUp } from "lucide-react";
import { getData, getHistoryFiles, getTrendFile } from "@/lib/data";
import { MOVER_LISTS, MOVER_WINDOWS, isMoverWindow, type MoverListDef, type MoverWindow } from "@/lib/movers";
import type { School } from "@/lib/types";
import { MoverListCard, moverYear } from "@/components/trends/movers/MoverListCard";
import { Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Biggest movers",
  description: "The colleges whose applications, selectivity, size, cost, and graduation rates changed the most over ten or five years, with the floors and exclusions that keep the lists fair.",
};

const LISTS = MOVER_LISTS as readonly MoverListDef[];

/**
 * /trends/movers (specs/trends/top-10-lists.md): one list per measure from data/history/trends/movers.json, for the
 * window in `?window=10|5` (ten by default). Every number and year comes from the file; nothing is ranked here.
 */
export default async function MoversPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const asked = Number(params.window);
  const window: MoverWindow = isMoverWindow(asked) ? asked : 10;
  const [file, files, data] = await Promise.all([getTrendFile("movers"), getHistoryFiles(), getData()]);
  const lists = file?.windows.find((w) => w.years === window)?.lists ?? null;

  const ids = new Set(lists?.flatMap((l) => l.entries.map((e) => e.unit_id)) ?? []);
  const schools = new Map<string, School>(data.getSchoolsByIds([...ids]).map((s) => [s.unit_id, s]));
  const fall = lists?.find((l) => l.kind === "fall");

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <Link href="/trends" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> National trends
      </Link>
      <header className="mt-4 mb-6 max-w-3xl sm:mb-8">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">
          <TrendingUp className="size-4" /> National trends
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Biggest movers</h1>
        <p className="mt-3 text-muted-foreground">
          The colleges that changed the most, measure by measure. Each list ranks only colleges that were big enough at the start for a change to mean
          something, and leaves out closed campuses, mergers, and reporting errors (the <Term term="biggest-movers">rules</Term>). Changes in rates are in{" "}
          <Term term="percentage-points">percentage points</Term>; costs are <Term term="inflation-adjusted">after inflation</Term>.
        </p>
      </header>

      {!file || !files || !lists ? (
        <div className="rounded-3xl border border-dashed p-6 text-muted-foreground sm:p-8">
          <p className="font-semibold text-foreground">The lists aren&apos;t available yet.</p>
          <p className="mt-1 text-sm">They&apos;re computed from the site&apos;s year-by-year history, and appear once that data is published.</p>
          <Link href="/trends" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
            All national trends <ArrowRight className="size-4" />
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <nav aria-label="Window" className="inline-flex rounded-full border bg-card p-0.5 text-xs font-semibold">
              {MOVER_WINDOWS.map((w) => (
                <Link
                  key={w}
                  href={w === 10 ? "/trends/movers" : `/trends/movers?window=${w}`}
                  aria-current={w === window ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-3 py-1.5 whitespace-nowrap transition-colors",
                    w === window ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {w} years
                </Link>
              ))}
            </nav>
            {fall && (
              <p className="text-sm text-muted-foreground">
                {moverYear(fall.from, fall.kind).replace(/^f/, "F")} to {moverYear(fall.to, fall.kind)} for admissions and enrollment; each list gives its own years.
              </p>
            )}
          </div>
          {window === 5 && (
            <p className="mt-3 max-w-3xl rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
              <b className="text-foreground">This window spans the pandemic.</b> Applications, enrollment, and test policies all shifted during it, so a
              five-year change can reflect a dip and a recovery as much as a trend.
            </p>
          )}

          {/* Phones: one swipeable row of list titles that jump to each list (specs/mobile.md chip row). */}
          <nav aria-label="Lists" className="mt-5 flex gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 sm:flex-wrap">
            {LISTS.map((def) => (
              <a
                key={def.key}
                href={`#${def.key}`}
                className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold whitespace-nowrap hover:border-primary hover:text-primary"
              >
                {def.title}
              </a>
            ))}
          </nav>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {LISTS.map((def) => {
              const list = lists.find((l) => l.key === def.key);
              return list ? <MoverListCard key={def.key} def={def} list={list} window={window} schools={schools} files={files} shown={file.shown} /> : null;
            })}
          </div>

          <section aria-labelledby="method" className="mt-14 max-w-3xl">
            <h2 id="method" className="font-display text-2xl font-extrabold tracking-tight">
              How the lists are made
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground marker:text-border">
              <li>
                <b className="text-foreground">The same change as college pages.</b> Each list ranks the change a college&apos;s own page and Explore show, from
                the window&apos;s first year (or up to two years later, when a college didn&apos;t report that year) to its last. Ties at the tenth place are all
                shown.
              </li>
              <li>
                <b className="text-foreground">A floor at the start.</b> A percent change on a small base isn&apos;t the story, so each list names the size a
                college needed at the start of the window.
              </li>
              <li>
                <b className="text-foreground">Still open, one campus.</b> Colleges under {file.rules.stillOpenMinUndergrads.toLocaleString("en-US")}{" "}
                undergraduates today are closing rather than shrinking, and are left off every list, as are campuses that merged or split during the window
                ({file.rules.excludedCampuses} reviewed by hand).
              </li>
              <li>
                <b className="text-foreground">Campus-based growth.</b> The growth lists leave out for-profit colleges and{" "}
                {file.rules.onlineFirst.toLocaleString("en-US")} <Term term="online-first">online-first colleges</Term>, whose enrollment can grow without a
                campus growing.
              </li>
              <li>
                <b className="text-foreground">Reporting errors.</b> A count at either end that is more than {file.rules.jumpFactor}× (or under a{" "}
                {file.rules.jumpFactor === 3 ? "third" : `1/${file.rules.jumpFactor}`}) of the year next to it is usually a typo in a college&apos;s report;
                those colleges are left off the list, not out of the data.
              </li>
              <li>
                <b className="text-foreground">The universe.</b> The site&apos;s four-year colleges, not all of U.S. higher education. A list shows how much a
                college changed, not why.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
