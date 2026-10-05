import type { Metadata } from "next";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { pct } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import { studyBySlug } from "@/lib/trend-studies";
import type { GroupingResult, ShrinkingValues } from "@/lib/trends";
import { TrendLine } from "@/components/charts/TrendLine";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { Sparkline } from "@/components/charts/Sparkline";
import type { GroupBarsView } from "@/components/trends/GroupBars";
import { ShrinkingBreakdowns } from "@/components/trends/ShrinkingBreakdowns";
import { StudyPage } from "@/components/trends/StudyPage";
import { TrendStat } from "@/components/trends/TrendStat";
import { Term } from "@/components/ui/info-tip";

const study = studyBySlug("shrinking-colleges")!;

export const metadata: Metadata = { title: study.title, description: study.question };

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const EVENTS = [{ year: 2020, label: "Pandemic" }];
const COLOR = study.color; // var(--d-size): shrank
const GROW_COLOR = "var(--d-access)"; // grew

/** GroupBars "Colleges" view: shrank 10%+ vs grew 10%+, as paired bars, for one window's groupings. */
function collegesView(groupings: readonly GroupingResult<ShrinkingValues>[], key: string, label: string, caption: string): GroupBarsView {
  return {
    key,
    label,
    caption,
    format: "pct",
    legend: [
      { name: "Shrank 10%+", color: COLOR },
      { name: "Grew 10%+", color: GROW_COLOR },
    ],
    groupings: groupings.map((g) => ({
      key: g.grouping,
      label: g.label,
      floor: g.floor,
      rows: g.groups.map((r) =>
        r.tooFew || !r.values
          ? { key: r.key, label: r.label, n: r.n, tooFew: true }
          : {
              key: r.key,
              label: r.label,
              n: r.n,
              bars: [
                { name: "Shrank 10%+", value: r.values.shrank10, color: COLOR },
                { name: "Grew 10%+", value: r.values.grew10, color: GROW_COLOR },
              ],
              summary: `Shrank ${pct(r.values.shrank10)} · Grew ${pct(r.values.grew10)}`,
            }
      ),
    })),
  };
}

/** GroupBars "Students" view: total undergraduate change, as one diverging bar, for one window's groupings. */
function studentsView(groupings: readonly GroupingResult<ShrinkingValues>[], key: string, label: string, caption: string): GroupBarsView {
  return {
    key,
    label,
    caption,
    format: "pct",
    diverging: true,
    legend: [{ name: "Total undergraduate change", color: COLOR }],
    groupings: groupings.map((g) => ({
      key: g.grouping,
      label: g.label,
      floor: g.floor,
      rows: g.groups.map((r) =>
        r.tooFew || !r.values
          ? { key: r.key, label: r.label, n: r.n, tooFew: true }
          : {
              key: r.key,
              label: r.label,
              n: r.n,
              bars: [{ name: "Total change", value: r.values.totalChange, color: r.values.totalChange >= 0 ? GROW_COLOR : COLOR }],
              summary: `${r.values.totalChange >= 0 ? "+" : ""}${pct(r.values.totalChange)} of this group's students`,
            }
      ),
    })),
  };
}

/**
 * Study 3 (specs/trends/shrinking-colleges.md): half of colleges have 10%+ fewer undergraduates than ten years ago.
 * Every number and year comes from data/history/trends/shrinking-colleges.json; only the sentences are written here.
 */
export default async function ShrinkingCollegesPage() {
  const [file, files] = await Promise.all([getTrendFile("shrinking-colleges"), getHistoryFiles()]);
  const v = file?.national.values;
  if (!file || !v) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const { from, to, five, histogram, belowStart, companion } = file;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const T = Math.round(file.threshold * 100);
  const provisional = files?.meta.provisional.adm ?? null;

  const vMidwest = file.groupings.find((g) => g.grouping === "region")?.groups.find((r) => r.key === "Midwest")?.values ?? null;
  const vR1 = file.groupings.find((g) => g.grouping === "research")?.groups.find((r) => r.key === "R1")?.values ?? null;
  const vForProfit = file.groupings.find((g) => g.grouping === "control")?.groups.find((r) => r.key === "private-forprofit")?.values ?? null;
  const vTerritories = file.groupings.find((g) => g.grouping === "region")?.groups.find((r) => r.key === "Territories")?.values ?? null;

  const windows = [
    {
      key: "ten",
      label: `${fall(from)} to ${fall(to)}`,
      views: [
        collegesView(file.groupings, "colleges", "Colleges", `Share of colleges that shrank (left) or grew (right) by ${T}+ points, ${fall(from)} to ${fall(to)}.`),
        studentsView(file.groupings, "students", "Students", `Total change in undergraduates within each group, ${fall(from)} to ${fall(to)}.`),
      ],
    },
    {
      key: "five",
      label: `${fall(five.from)} to ${fall(five.to)}`,
      views: [
        collegesView(five.groupings, "colleges", "Colleges", `Share of colleges that shrank (left) or grew (right) by ${T}+ points, ${fall(five.from)} to ${fall(five.to)}. Isolates the pandemic drop and partial recovery.`),
        studentsView(five.groupings, "students", "Students", `Total change in undergraduates within each group, ${fall(five.from)} to ${fall(five.to)}.`),
      ],
    },
  ];

  return (
    <StudyPage
      study={study}
      file={file}
      headline={
        <>
          <TrendStat
            label={
              <>
                <Term term="undergrad-enrollment">Undergraduates</Term> down {T}%+ from ten years ago
              </>
            }
            values={[0, v.shrank10]}
            format="pct"
            from={from}
            to={to}
            kind="fall"
            counts="share of colleges"
            color={COLOR}
          />
          <TrendStat label={<>Up {T}%+ from ten years ago</>} values={[0, v.grew10]} format="pct" from={from} to={to} kind="fall" counts="share of colleges" color={GROW_COLOR} />
          <TrendStat label={<>Median college&apos;s change</>} values={[0, v.medianChange]} format="pct" from={from} to={to} kind="fall" counts="median college" />
        </>
      }
      nationalIntro={
        <>
          {pct(v.shrank10)} of {file.n.toLocaleString("en-US")} colleges have at least {T}% fewer undergraduates than in {fall(from)}. The share that was smaller than{" "}
          {fall(from)} each year since, and how the ten-year change is distributed.
        </>
      }
      national={
        <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Share of colleges smaller than in {fall(from)}, by year</figcaption>
            <div className="mt-4">
              <Sparkline
                series={[{ name: "Smaller than at the start", color: COLOR, values: belowStart }]}
                start={from}
                kind="fall"
                format="pct"
                label={`Share of the panel with fewer undergraduates than in ${fall(from)}, ${fall(from)} to ${fall(to)}`}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {pct(belowStart[belowStart.length - 1] ?? 0)} in {fall(to)}; it peaked during the pandemic.
            </p>
          </figure>
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Ten-year change in undergraduates, across {histogram.n.toLocaleString("en-US")} colleges</figcaption>
            <div className="mt-4">
              <DistributionStrip
                label="Median college's ten-year change"
                dist={{ bins: histogram.counts, min: histogram.min, max: histogram.max, n: histogram.n }}
                value={histogram.median}
                rank={null}
                format="pct"
                color={COLOR}
                lowLabel="−60% or less"
                highLabel="+60% or more"
              />
            </div>
          </figure>
        </div>
      }
      breakdownsIntro={
        <>
          The same measures split by group, on one scale. Switch to <i>Students</i> to weight by how many undergraduates each group has, or to the five-year window to
          isolate the pandemic.
        </>
      }
      breakdowns={<ShrinkingBreakdowns windows={windows} />}
      takeaway={
        <>
          <p>
            Across {file.n.toLocaleString("en-US")} colleges, {pct(v.shrank10)} have at least {T}% fewer undergraduates than in {fall(from)}, making a decline the{" "}
            <b>median</b> experience ({pct(Math.abs(v.medianChange))} {v.medianChange < 0 ? "smaller" : "larger"} at the typical college), even though the total panel is
            about the same size ({pct(Math.abs(v.totalChange))} {v.totalChange < 0 ? "smaller" : "larger"}: students concentrated rather than disappeared.
          </p>
          {vMidwest && (
            <p>
              The decline is concentrated: in the Midwest, {pct(vMidwest.shrank10)} of colleges shrank {T}%+, and the region&apos;s total undergraduates fell{" "}
              {pct(Math.abs(vMidwest.totalChange))}.
              {vTerritories && <> Puerto Rico&apos;s colleges lost the most of any region, {pct(Math.abs(vTerritories.totalChange))} of their students in total.</>}
            </p>
          )}
          {vR1 && vForProfit && (
            <p>
              Growth went the other way: R1 universities&apos; median college grew {pct(Math.abs(vR1.medianChange))}, while for-profit colleges grew{" "}
              {pct(Math.abs(vForProfit.medianChange))} at the median but shrank {pct(Math.abs(vForProfit.totalChange))} in total — a few large closures against many
              small gains, the reason this page shows colleges and students separately.
            </p>
          )}
          <p className="text-muted-foreground">These breakdowns show where undergraduate counts changed, not why; a college shrinking could mean fewer applicants, lower yield, or less retention.</p>
        </>
      }
      method={[
        <>
          <b className="text-foreground">Shrank / grew.</b> A change of {T} or more percentage points in undergraduates, either way, over the window.
        </>,
        <>
          <b className="text-foreground">300-undergraduate floor.</b> A college needs {file.minUndergrads.toLocaleString("en-US")}+ undergraduates at both ends of a
          window to join its panel (the same bar as the site&apos;s diversity-change indicator): below it, a handful of students can swing a percentage a lot. A college
          that fell below 2,000 undergraduates counts as &quot;under 2,000&quot; at both ends of the size grouping.
        </>,
        <>
          <b className="text-foreground">Two windows.</b> The ten-year window ({fall(from)} to {fall(to)}) is the default; the five-year window ({fall(five.from)} to{" "}
          {fall(five.to)}, {five.n.toLocaleString("en-US")} colleges) isolates the pandemic drop and the partial recovery since. Each has its own fixed panel.
        </>,
        <>
          <b className="text-foreground">The distribution chart</b> clamps changes beyond ±60% into the end bins, so a few extreme closures or mergers don&apos;t stretch
          the scale.
        </>,
        <>
          <b className="text-foreground">The companion chart</b> covers the {companion.n.toLocaleString("en-US")} colleges that shrank {T}%+ over the ten-year window
          (a sub-panel), median applicants and enrolled first-years reported each fall.
        </>,
      ]}
      links={[
        { href: "/trends/movers", label: "Biggest movers: shrank and grew the most" },
        { href: "/trends/states", label: "By state" },
      ]}
    >
      <section aria-labelledby="companion" className="min-w-0">
        <h2 id="companion" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Did they lose applicants, or enroll fewer of them?
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          At the {companion.n.toLocaleString("en-US")} colleges that shrank {T}%+ over the ten-year window: median <Term term="applicants">applicants</Term> and median{" "}
          <Term term="enrolled">enrolled first-years</Term>, each fall.
        </p>
        <div className="mt-5 rounded-3xl border bg-card p-4 sm:p-5">
          <TrendLine
            series={[
              { key: "applicants", name: "Applicants (median)", color: COLOR, start: companion.from, values: companion.applicants },
              { key: "enrolled", name: "Enrolled first-years (median)", color: GROW_COLOR, start: companion.from, values: companion.enrolled },
            ]}
            from={companion.from}
            to={companion.to}
            kind="fall"
            format="compact"
            events={EVENTS}
            provisionalYear={provisional}
            label={`Median applicants and enrolled first-years at shrinking colleges, ${fall(companion.from)} to ${fall(companion.to)}`}
          />
        </div>
      </section>
    </StudyPage>
  );
}
