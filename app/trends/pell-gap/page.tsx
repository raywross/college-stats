import type { Metadata } from "next";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { pct, points } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import { MIN_YEAR_COVERAGE } from "@/lib/trend-panel";
import { studyBySlug } from "@/lib/trend-studies";
import type { PellGapValues } from "@/lib/trends";
import { Dumbbell, type DumbbellRow } from "@/components/charts/Dumbbell";
import { GroupDotPlot, type GroupDotRow } from "@/components/charts/GroupDotPlot";
import { TrendLine } from "@/components/charts/TrendLine";
import { SmallMultiples } from "@/components/trends/SmallMultiples";
import { StudyPage } from "@/components/trends/StudyPage";
import { TrendStat } from "@/components/trends/TrendStat";
import { direction, groupingTiles } from "@/components/trends/tiles";
import { ViewSwitch } from "@/components/trends/ViewSwitch";
import { Term } from "@/components/ui/info-tip";

const study = studyBySlug("pell-gap")!;

export const metadata: Metadata = { title: study.title, description: study.question };

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const COLOR = study.color;
/** "Students with neither a Pell Grant nor a subsidized loan" — IPEDS's comparison group, not simply "non-Pell"
 * (specs/trends/pell-gap.md open question 1: students with a subsidized loan but no Pell are in neither group). */
const NEITHER_LONG = "students with neither a Pell Grant nor a subsidized loan";

/**
 * Study 6 (specs/trends/pell-gap.md): every number and year comes from data/history/trends/pell-gap.json; only the
 * sentences are written here.
 */
export default async function PellGapPage() {
  const [file, files] = await Promise.all([getTrendFile("pell-gap"), getHistoryFiles()]);
  const v = file?.national.values;
  if (!file || !v) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const { from, to, lineFrom } = file;
  const entered = (y: number) => historyYearLabel(y, file.yearKind).toLowerCase();
  const T = Math.round(file.gapThreshold * 100);
  const provisional = files?.meta.provisional["gr-pell"] ?? null;

  const gapRow = (grouping: string, key: string) => file.groupings.find((g) => g.grouping === grouping)?.groups.find((r) => r.key === key)?.values ?? null;
  const midwest = gapRow("region", "Midwest");
  const town = gapRow("setting", "Town");
  const selective = gapRow("selectivity", "most");

  // Two median lines with the gap shaded between them (a TrendLine "range"), the overall rate as a thin dashed
  // context line in a muted color (hub rule 2: colleges, not students, except the weighted companion below).
  const nationalRange = [{ key: "gap", name: "Gap", color: COLOR, start: lineFrom, lo: v.lines.pellRate, hi: v.lines.neitherRate }];
  const nationalSeries = [
    { key: "pell", name: "Pell recipients", color: COLOR, start: lineFrom, values: v.lines.pellRate },
    { key: "neither", name: "Neither Pell nor a loan", color: COLOR, start: lineFrom, values: v.lines.neitherRate },
    { key: "overall", name: "All students (context)", color: "var(--muted-foreground)", dashed: true, start: lineFrom, values: v.lines.overallRate },
  ];

  const weightedSeries = (x: PellGapValues) => [{ key: "weightedGap", name: "Gap, weighted by cohort size", color: COLOR, start: lineFrom, values: x.lines.weightedGap }];
  const collegeSeries = (x: PellGapValues) => [
    { key: "pell", name: "Pell recipients", color: COLOR, start: lineFrom, values: x.lines.pellRate },
    { key: "neither", name: "Neither Pell nor a loan", color: COLOR, dashed: true, start: lineFrom, values: x.lines.neitherRate },
  ];

  // Share of colleges with a 10+ point gap, per grouping, as a then/now bar list (one tab per grouping).
  const widestViews = file.groupings.map((g) => ({
    key: g.grouping,
    label: g.label,
    content: (
      <Dumbbell
        rows={g.groups.filter((r) => r.values).map((r): DumbbellRow => ({ label: r.label, from: r.values!.gap10Share[0], to: r.values!.gap10Share[1] }))}
        fromLabel={entered(from)}
        toLabel={entered(to)}
        format="pct"
        color={COLOR}
      />
    ),
  }));

  // The 8-year outcome-measures companion: a different measure, its own (earlier) entering class.
  const om8Rows: GroupDotRow[] = [
    { key: "all", label: "All colleges", value: file.om8.national.pell ?? null, cohort: null, secondary: file.om8.national.nonPell, note: `${file.om8.national.n.toLocaleString("en-US")} colleges` },
    ...file.om8.byControl.map((r): GroupDotRow => ({
      key: r.key,
      label: r.label,
      value: r.tooFew ? null : r.pell ?? null,
      cohort: null,
      secondary: r.tooFew ? null : r.nonPell,
      note: r.tooFew ? `Too few colleges to say (${r.n})` : `${r.n.toLocaleString("en-US")} colleges`,
    })),
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
                Pell recipients&apos; <Term term="graduation-rate">graduation rate</Term>
              </>
            }
            values={v.pellRate}
            format="pct"
            from={from}
            to={to}
            kind={file.yearKind}
            counts="median college"
            color={COLOR}
          />
          <TrendStat
            label={
              <>
                Gap at the median college, <Term term="pell-graduation-gap">{NEITHER_LONG} minus Pell</Term>
              </>
            }
            values={v.gap}
            format="pts"
            from={from}
            to={to}
            kind={file.yearKind}
            counts="median college"
            color={COLOR}
          />
          <TrendStat
            label={<>Colleges where the gap is {T}+ points</>}
            values={v.gap10Share}
            format="pct"
            from={from}
            to={to}
            kind={file.yearKind}
            counts="share of colleges"
            color={COLOR}
          />
        </>
      }
      nationalIntro={
        <>
          The median graduation rate for Pell Grant recipients and for <Term term="pell-graduation-gap">{NEITHER_LONG}</Term>, by{" "}
          <Term term="entering-cohort">entering class</Term>, since {entered(lineFrom)}, with the gap shaded between them. The overall rate (all students) is a thin
          dashed line for context. Median college, not weighted by size.
        </>
      }
      national={
        <div className="grid gap-4">
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Graduation rate, Pell recipients vs. {NEITHER_LONG}</figcaption>
            <div className="mt-3">
              <TrendLine
                series={nationalSeries}
                ranges={nationalRange}
                from={lineFrom}
                to={to}
                kind={file.yearKind}
                format="pct"
                provisionalYear={provisional}
                label={`Median graduation rate for Pell recipients and for ${NEITHER_LONG}, by entering class, ${entered(lineFrom)} to ${entered(to)}, with the gap shaded`}
              />
            </div>
          </figure>
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">Counting students instead of colleges:</b> summing graduates over cohorts (not averaging each college equally), Pell
            recipients graduated at {pct(v.weightedPellRate[1])} and {NEITHER_LONG} at {pct(v.weightedNeitherRate[1])} for the {entered(to)}, a gap of{" "}
            {points(v.weightedGap[1])} ({pct(v.weightedPellRate[0])} and {pct(v.weightedNeitherRate[0])}, a gap of {points(v.weightedGap[0])}, for the{" "}
            {entered(from)}). Large universities enroll most students, so the student-weighted gap reads differently from the median college&apos;s.
          </p>
        </div>
      }
      breakdownsIntro={
        <>
          The same shaded pair for each group, on one scale. Switch to <i>Students</i> to weight by each group&apos;s cohort sizes instead of counting every
          college once.
        </>
      }
      links={[{ href: "/trends/movers", label: "Biggest movers: where the Pell gap closed most" }]}
      breakdowns={
        <SmallMultiples
          label="Graduation rate, Pell recipients vs. students with neither, by group"
          from={lineFrom}
          to={to}
          kind={file.yearKind}
          provisionalYear={provisional}
          views={[
            {
              key: "colleges",
              label: "Colleges",
              caption: `Median graduation rate, Pell recipients (solid) and ${NEITHER_LONG} (dashed), by entering class, ${entered(lineFrom)} to ${entered(to)}. Numbers: ${entered(from)} → ${entered(to)}.`,
              format: "pct",
              legend: [
                { name: "Pell recipients", color: COLOR },
                { name: "Neither Pell nor a loan", color: COLOR, dashed: true },
              ],
              groupings: groupingTiles(file.groupings, (x) => ({
                series: collegeSeries(x),
                summary: `Pell ${pct(x.pellRate[0])} → ${pct(x.pellRate[1])} · Gap ${points(x.gap[0])} → ${points(x.gap[1])}`,
              })),
            },
            {
              key: "students",
              label: "Students",
              caption: `Gap between ${NEITHER_LONG} and Pell recipients, summing graduates over each group's cohorts, ${entered(lineFrom)} to ${entered(to)}.`,
              format: "pts",
              axisFormat: "pts",
              legend: [{ name: "Gap, weighted by cohort size", color: COLOR }],
              groupings: groupingTiles(file.groupings, (x) => ({
                series: weightedSeries(x),
                summary: `Gap ${points(x.weightedGap[0])} → ${points(x.weightedGap[1])}`,
              })),
            },
          ]}
        />
      }
      takeaway={
        <>
          <p>
            Across {file.n.toLocaleString("en-US")} colleges, the gap between {NEITHER_LONG} and Pell recipients at the median college {direction(v.gap[0], v.gap[1])}{" "}
            from {points(v.gap[0])} for the {entered(from)} to {points(v.gap[1])} for the {entered(to)}, even though Pell recipients&apos; own graduation rate{" "}
            {direction(v.pellRate[0], v.pellRate[1])} only barely, from {pct(v.pellRate[0])} to {pct(v.pellRate[1])}: the gap widened mainly because {NEITHER_LONG}{" "}
            graduated more often, {pct(v.neitherRate[0])} to {pct(v.neitherRate[1])}.
            {selective && (
              <>
                {" "}
                The exception is the most selective colleges, where the gap narrowed, from {points(selective.gap[0])} to {points(selective.gap[1])}: it was already
                small.
              </>
            )}
          </p>
          {midwest && town && (
            <p>
              The gap widened fastest in the Midwest ({points(midwest.gap[0])} to {points(midwest.gap[1])}) and at colleges in towns ({points(town.gap[0])} to{" "}
              {points(town.gap[1])}) — colleges that also show up among the shrinking colleges of Study 3 (the overlap is worth noting, not a cause).
            </p>
          )}
          <p className="text-muted-foreground">
            Breakdowns show where the gap changed, not why: a college&apos;s mix of programs, aid, and student support all play a part.
          </p>
        </>
      }
      method={[
        <>
          <b className="text-foreground">
            <Term term="pell-graduation-gap">&quot;Neither&quot;</Term>
          </b>{" "}
          means {NEITHER_LONG} — IPEDS&apos;s own comparison group. Students with a subsidized loan but no Pell Grant are in neither group.
        </>,
        <>
          <b className="text-foreground">The 50-student floor.</b> A college needs at least {file.minCohort} students in BOTH groups, in BOTH entering classes, to
          join the panel — on top of the federal rule that already hides any group&apos;s own rate under 30 students.
        </>,
        <>
          <b className="text-foreground">
            <Term term="entering-cohort">Entering-class labeling</Term>.
          </b>{" "}
          A rate for the &quot;{entered(to)}&quot; class describes students who started college then and is measured six years later; it never means the year it was
          published.
        </>,
        <>
          <b className="text-foreground">Yearly lines</b> run from {entered(lineFrom)} over the panel colleges reporting each entering class; a year is left out of
          a line when under {Math.round(MIN_YEAR_COVERAGE * 100)}% of its colleges reported.
        </>,
      ]}
    >
      <section aria-labelledby="widest" className="min-w-0">
        <h2 id="widest" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Where the gap is widest
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Share of colleges in each group where the gap is {T} or more points, {entered(from)} and {entered(to)}.
        </p>
        <div className="mt-5">
          <ViewSwitch label="Group colleges by" views={widestViews} />
        </div>
      </section>

      <section aria-labelledby="om8" className="min-w-0">
        <h2 id="om8" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Eight years, everyone
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          A different measure: the <Term term="outcome-measures">8-year outcome measures</Term> survey counts every entering student, including part-time and
          transfer students, not just first-time, full-time students followed for six years. For the {historyYearLabel(file.om8.year, "cohort").toLowerCase()}{" "}
          class — the newest this survey covers — the share who earned a credential within 8 years, Pell Grant recipients against students without one.
        </p>
        <div className="mt-5 max-w-2xl rounded-3xl border bg-card p-4 sm:p-5">
          <GroupDotPlot
            label="Share earning a credential within 8 years, Pell Grant recipients vs. students without one, national and by control"
            rows={om8Rows}
            overall={null}
            color={COLOR}
            secondaryLabel="students without a Pell Grant"
          />
        </div>
      </section>
    </StudyPage>
  );
}
