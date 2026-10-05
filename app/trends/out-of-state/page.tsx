import type { Metadata } from "next";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { money, pct } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import { MIN_YEAR_COVERAGE } from "@/lib/trend-panel";
import { studyBySlug } from "@/lib/trend-studies";
import type { OutOfStateValues } from "@/lib/trends";
import type { TileLevel } from "@/components/charts/StateTileMap";
import { StateTileMap } from "@/components/charts/StateTileMap";
import { TrendLine } from "@/components/charts/TrendLine";
import { SmallMultiples } from "@/components/trends/SmallMultiples";
import { StudyPage } from "@/components/trends/StudyPage";
import { TrendStat } from "@/components/trends/TrendStat";
import { direction, groupingTiles } from "@/components/trends/tiles";
import { Term } from "@/components/ui/info-tip";

const study = studyBySlug("out-of-state")!;

export const metadata: Metadata = { title: study.title, description: study.question };

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const EVENTS = [{ year: 2020, label: "Pandemic" }];
const COLOR = study.color;

/** Sending-state totals are thousands at the biggest senders, so the tile map needs its own scale (not college counts). */
const SENDING_LEVELS: TileLevel[] = [
  { min: 1, label: "Under 500", bg: "var(--seq-1)", ink: "text-foreground" },
  { min: 500, label: "500–1,999", bg: "var(--seq-2)", ink: "text-foreground" },
  { min: 2000, label: "2,000–4,999", bg: "var(--seq-3)", ink: "text-foreground" },
  { min: 5000, label: "5,000–9,999", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { min: 10_000, label: "10,000+", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];

/**
 * Study 5 (specs/trends/out-of-state.md): every number and year comes from data/history/trends/out-of-state.json;
 * only the sentences are written here.
 */
export default async function OutOfStatePage() {
  const [file, files] = await Promise.all([getTrendFile("out-of-state"), getHistoryFiles()]);
  const v = file?.national.values;
  if (!file || !v) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const { from, to, lineFrom } = file;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const academic = (y: number) => historyYearLabel(y, "academic");
  const T = Math.round(file.threshold * 100);
  const provisional = files?.meta.provisional.adm ?? null;

  const shareSeries = (x: OutOfStateValues) => [
    { key: "median", name: "Median out-of-state share", color: COLOR, start: lineFrom, values: x.lines.medianShare },
    { key: "share30", name: `${T}%+ out-of-state`, color: COLOR, dashed: true, start: lineFrom, values: x.lines.share30 },
  ];

  const row = (grouping: string, key: string) => file.groupings.find((g) => g.grouping === grouping)?.groups.find((r) => r.key === key)?.values ?? null;
  const northeast = row("region", "Northeast");
  const southwest = row("region", "Southwest");
  const r1 = row("research", "R1");

  // The standard "control" breakdown is a single group (the panel is all public), so it's in the registry for
  // lineage and tests but left off the small multiples the reader switches between.
  const breakdownGroupings = file.groupings.filter((g) => g.grouping !== "control");

  // Sort by value so the biggest senders lead, matching the tile map's visual weight.
  const topSenders = Object.entries(file.sendingStates.totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <StudyPage
      study={study}
      file={file}
      headline={
        <>
          <TrendStat
            label={<>Median public&apos;s out-of-state share</>}
            values={v.medianShare}
            format="pct"
            from={from}
            to={to}
            kind="fall"
            counts="median public college"
            color={COLOR}
          />
          <TrendStat
            label={
              <>
                Public colleges <Term term="in-state-student">30%+ out-of-state</Term>
              </>
            }
            values={v.share30}
            format="pct"
            from={from}
            to={to}
            kind="fall"
            counts="share of public colleges"
            color={COLOR}
          />
          <TrendStat label={<>Counting every public first-year</>} values={v.weightedShare} format="pct" from={from} to={to} kind="fall" counts="weighted by first-years" />
        </>
      }
      nationalIntro={
        <>
          The median public college&apos;s <Term term="in-state-student">share of first-years from other states</Term>, each even fall since {fall(lineFrom)} (residence
          is collected only in even-numbered falls, so odd years have no point). Private nonprofits, dashed below, are shown only as context: this study is about
          publics.
        </>
      }
      national={
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Median out-of-state share, public vs. private nonprofit</figcaption>
            <div className="mt-3">
              <TrendLine
                series={[
                  { key: "public", name: "Public (median)", color: COLOR, start: lineFrom, values: v.lines.medianShare },
                  { key: "private", name: "Private nonprofit (median)", color: "var(--muted-foreground)", dashed: true, start: lineFrom, values: file.private.line },
                ]}
                from={lineFrom}
                to={to}
                kind="fall"
                format="pct"
                events={EVENTS}
                provisionalYear={provisional}
                label={`Median out-of-state share of first-years, public colleges vs. private nonprofits, ${fall(lineFrom)} to ${fall(to)}`}
              />
            </div>
          </figure>
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Public colleges {T}%+ out-of-state</figcaption>
            <div className="mt-3">
              <TrendLine
                series={[{ key: "share30", name: `${T}%+ out-of-state`, color: COLOR, start: lineFrom, values: v.lines.share30 }]}
                from={lineFrom}
                to={to}
                kind="fall"
                format="pct"
                events={EVENTS}
                provisionalYear={provisional}
                label={`Share of public colleges ${T}%+ out-of-state, ${fall(lineFrom)} to ${fall(to)}`}
              />
            </div>
          </figure>
          <p className="text-sm text-muted-foreground lg:col-span-2">
            <b className="text-foreground">Counting applicants instead of colleges:</b> weighted by each college&apos;s first-year class, {pct(v.weightedShare[0])} of
            public first-years came from other states in {fall(from)}, rising to {pct(v.weightedShare[1])} by {fall(to)}.
          </p>
          <p className="text-sm text-muted-foreground lg:col-span-2">
            <b className="text-foreground">Students from abroad:</b> the median public college&apos;s international share of first-years was{" "}
            {pct(file.internationalMedian[0], 1)} in {fall(from)} and {pct(file.internationalMedian[1], 1)} in {fall(to)}: the shift toward other states is
            domestic, not international.
          </p>
        </div>
      }
      breakdownsIntro={
        <>
          The same lines for each group, on one scale: median share (solid) and the {T}%+ share (dashed). Switch to <i>Students</i> to weight each college by its
          first-year class.
        </>
      }
      breakdowns={
        <SmallMultiples
          label={`Median out-of-state share and share of colleges ${T}%+ out-of-state`}
          from={lineFrom}
          to={to}
          kind="fall"
          events={EVENTS}
          provisionalYear={provisional}
          views={[
            {
              key: "colleges",
              label: "Colleges",
              caption: `Median out-of-state share (solid) and share of colleges ${T}%+ out-of-state (dashed), ${fall(lineFrom)} to ${fall(to)}. Numbers: ${fall(from)} → ${fall(to)}.`,
              format: "pct",
              legend: [
                { name: "Median out-of-state share", color: COLOR },
                { name: `${T}%+ out-of-state`, color: COLOR, dashed: true },
              ],
              groupings: groupingTiles(breakdownGroupings, (x) => ({
                series: shareSeries(x),
                summary: `Median ${pct(x.medianShare[0])} → ${pct(x.medianShare[1])} · ${T}%+ ${pct(x.share30[0])} → ${pct(x.share30[1])}`,
              })),
            },
            {
              key: "students",
              label: "Students",
              caption: `Out-of-state share weighted by each college's first-year class, ${fall(lineFrom)} to ${fall(to)}.`,
              format: "pct",
              legend: [{ name: "Weighted by first-years", color: COLOR }],
              groupings: groupingTiles(breakdownGroupings, (x) => ({
                series: [{ key: "weighted", name: "Weighted by first-years", color: COLOR, start: lineFrom, values: x.lines.weightedShare }],
                summary: `${pct(x.weightedShare[0])} → ${pct(x.weightedShare[1])}`,
              })),
            },
          ]}
        />
      }
      takeaway={
        <>
          <p>
            Across {file.n.toLocaleString("en-US")} public colleges, the median out-of-state share {direction(v.medianShare[0], v.medianShare[1])} from{" "}
            {pct(v.medianShare[0])} in {fall(from)} to {pct(v.medianShare[1])} in {fall(to)}, and the share of publics that are {T}%+ out-of-state{" "}
            {direction(v.share30[0], v.share30[1])} from {pct(v.share30[0])} to {pct(v.share30[1])}.
            {r1 && (
              <>
                {" "}
                Research universities lead: among R1 publics, the median rose to {pct(r1.medianShare[1])}, and {pct(r1.share30[1])} are now {T}%+ out-of-state.
              </>
            )}
            {northeast && (
              <>
                {" "}
                The Northeast changed most, from a low base: {pct(northeast.medianShare[0])} to {pct(northeast.medianShare[1])}.
              </>
            )}
            {southwest && (
              <>
                {" "}
                The Southwest barely moved: {pct(southwest.medianShare[0])} to {pct(southwest.medianShare[1])}.
              </>
            )}
          </p>
          <p className="text-muted-foreground">
            This shows where the shift is concentrated, not why: it can reflect state funding, enrollment strategy, or demand from other states, and the data
            can&apos;t separate those.
          </p>
        </>
      }
      method={[
        <>
          <b className="text-foreground">Residence is collected every other year.</b> IPEDS requires the home-state survey only in even-numbered falls, so the
          lines above have a point every two years; odd years are left out, not zero.
        </>,
        <>
          <b className="text-foreground">
            <Term term="colleges-or-students">Colleges or students.</Term>
          </b>{" "}
          Shares and medians count each college once. The <i>Students</i> view weights each college by its first-year class.
        </>,
        <>
          <b className="text-foreground">Selectivity.</b> Fewer than 30 public colleges admit under 25% of applicants, so that group shows &quot;too few colleges to
          say&quot; and folds into &quot;60% or more&quot; for the purposes of this note; the full breakdown above shows it separately.
        </>,
        <>
          <b className="text-foreground">The premium</b> (below) uses full sticker price, converted to {academic(file.premium.to)} dollars with the Consumer Price
          Index; prices are reported for the academic year and lag the residence survey by about a year, so its window is {academic(file.premium.from)} to{" "}
          {academic(file.premium.to)}.
        </>,
        <>
          <b className="text-foreground">Yearly lines</b> run from {fall(lineFrom)} over the panel colleges reporting each even fall; a year is left out of a line
          when under {Math.round(MIN_YEAR_COVERAGE * 100)}% of its colleges reported.
        </>,
      ]}
    >
      <section aria-labelledby="premium" className="min-w-0">
        <h2 id="premium" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          The out-of-state premium
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Full price out-of-state minus full price in-state at the median public college, after inflation ({academic(file.premium.to)} dollars). Relates the shift
          to money without attributing it.
        </p>
        <div className="mt-5 rounded-3xl border bg-card p-4 sm:p-5">
          <figcaption className="text-sm font-semibold">Median out-of-state premium, full price</figcaption>
          <div className="mt-3">
            <TrendLine
              series={[{ key: "premium", name: "Median premium", color: COLOR, start: file.premium.lineFrom, values: file.premium.line }]}
              from={file.premium.lineFrom}
              to={file.premium.to}
              kind="academic"
              format="money"
              events={EVENTS}
              provisionalYear={null}
              label={`Median public college's out-of-state premium, in ${academic(file.premium.to)} dollars, ${academic(file.premium.lineFrom)} to ${academic(file.premium.to)}`}
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {academic(file.premium.from)}: {money(file.premium.median[0])}, and {pct(file.premium.over20k[0])} of publics charged $20,000 or more extra. By{" "}
            {academic(file.premium.to)}: {money(file.premium.median[1])}, and {pct(file.premium.over20k[1])} charged $20,000 or more extra.
          </p>
        </div>
      </section>

      <section aria-labelledby="sending-states" className="min-w-0">
        <h2 id="sending-states" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Where they come from
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Out-of-state first-years at public colleges, by home state, summed from each college&apos;s <Term term="in-state-student">residence table</Term> in{" "}
          {fall(file.sendingStates.year)} (the newest year the data exists; it&apos;s a snapshot, not a trend). {file.sendingStates.n.toLocaleString("en-US")} public
          colleges reported the table.
        </p>
        <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <h3 className="mb-3 text-sm font-semibold">Top sending states</h3>
            <ol className="space-y-2.5">
              {topSenders.map(([st, n]) => (
                <li key={st} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{st}</span>
                  <b className="tabular-nums">{n.toLocaleString("en-US")}</b>
                </li>
              ))}
            </ol>
          </div>
          <StateTileMap
            counts={file.sendingStates.totals}
            levels={SENDING_LEVELS}
            legendLabel="Out-of-state first-years from each state"
            unit="out-of-state first-year"
            href={null}
          />
        </div>
      </section>
    </StudyPage>
  );
}
