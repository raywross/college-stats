import type { Metadata } from "next";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { pct, points } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import { MIN_YEAR_COVERAGE } from "@/lib/trend-panel";
import { studyBySlug } from "@/lib/trend-studies";
import type { MenAndWomenValues } from "@/lib/trends";
import { TrendLine } from "@/components/charts/TrendLine";
import { SmallMultiples } from "@/components/trends/SmallMultiples";
import { StudyPage } from "@/components/trends/StudyPage";
import { TrendStat } from "@/components/trends/TrendStat";
import { direction, groupingTiles } from "@/components/trends/tiles";
import { Term } from "@/components/ui/info-tip";

const study = studyBySlug("men-and-women")!;

export const metadata: Metadata = { title: study.title, description: study.question };

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const EVENTS = [{ year: 2020, label: "Pandemic" }];
const COLOR = study.color;

/**
 * Study 1 (specs/national-trends.md#study-1-men-and-women-in-admissions), the worked example of a study page: every
 * number and year comes from data/history/trends/men-and-women.json; only the sentences are written here.
 */
export default async function MenAndWomenPage() {
  const [file, files] = await Promise.all([getTrendFile("men-and-women"), getHistoryFiles()]);
  const v = file?.national.values;
  if (!file || !v) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const { from, to, lineFrom } = file;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  /** The "notably higher" bar in points (3). */
  const T = Math.round(file.threshold * 100);
  const provisional = files?.meta.provisional.adm ?? null;
  // Women's line solid and men's dashed, one hue (as on college pages): neither is the "main" one.
  const shareSeries = (x: MenAndWomenValues) => [
    { key: "women", name: `Women ${T}+ pts higher`, color: COLOR, start: lineFrom, values: x.lines.womenHigher },
    { key: "men", name: `Men ${T}+ pts higher`, color: COLOR, dashed: true, start: lineFrom, values: x.lines.menHigher },
  ];
  const row = (grouping: string, key: string) => file.groupings.find((g) => g.grouping === grouping)?.groups.find((r) => r.key === key)?.values ?? null;
  const northeast = row("region", "Northeast");
  const west = row("region", "West");
  const nationalWomen = direction(v.womenHigher[0], v.womenHigher[1]);
  const westReversed = west && direction(west.womenHigher[0], west.womenHigher[1]) !== nationalWomen && nationalWomen !== "held steady";

  return (
    <StudyPage
      study={study}
      file={file}
      headline={
        <>
          <TrendStat label={<>Admit women at a notably higher rate</>} values={v.womenHigher} format="pct" from={from} to={to} kind="fall" counts="share of colleges" color={COLOR} />
          <TrendStat label={<>Admit men at a notably higher rate</>} values={v.menHigher} format="pct" from={from} to={to} kind="fall" counts="share of colleges" color={COLOR} />
          <TrendStat
            label={
              <>
                Gap at the median college, <Term term="admit-rate-by-sex">men minus women</Term>
              </>
            }
            values={v.medianGap}
            format="pts"
            from={from}
            to={to}
            kind="fall"
            counts="median college"
          />
        </>
      }
      nationalIntro={
        <>
          The share of colleges whose <Term term="admit-rate-by-sex">acceptance rates for men and women</Term> differ by {T} or more points, either way,
          each fall since {fall(lineFrom)}. Share of colleges, not students.
        </>
      }
      national={
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Share of colleges admitting one sex at a rate {T}+ points higher</figcaption>
            <div className="mt-3">
              <TrendLine
                series={shareSeries(v)}
                from={lineFrom}
                to={to}
                kind="fall"
                format="pct"
                events={EVENTS}
                provisionalYear={provisional}
                label={`Share of ${file.n} colleges admitting women or men at a rate ${T} or more points higher, ${fall(lineFrom)} to ${fall(to)}`}
              />
            </div>
          </figure>
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Gap at the median college, men minus women</figcaption>
            <div className="mt-3">
              <TrendLine
                series={[{ key: "gap", name: "Median gap", color: COLOR, start: lineFrom, values: v.lines.medianGap }]}
                from={lineFrom}
                to={to}
                kind="fall"
                format="pts"
                axisFormat="pts"
                events={EVENTS}
                provisionalYear={provisional}
                label={`Median college's men's minus women's acceptance rate, ${fall(lineFrom)} to ${fall(to)}`}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Below zero: women were admitted at a higher rate than men.</p>
          </figure>
          <p className="text-sm text-muted-foreground lg:col-span-2">
            <b className="text-foreground">Counting applicants instead of colleges:</b> weighted by each college&apos;s total applicants, men were admitted at{" "}
            {pct(v.weightedMen[1])} and women at {pct(v.weightedWomen[1])} in {fall(to)} ({pct(v.weightedMen[0])} and {pct(v.weightedWomen[0])} in {fall(from)}).
          </p>
        </div>
      }
      breakdownsIntro={
        <>
          The same lines for each group, on one scale. Switch to <i>Students</i> to weight each college by its applicants.
        </>
      }
      breakdowns={
        <SmallMultiples
          label={`Share of colleges admitting women or men at a rate ${T} or more points higher`}
          from={lineFrom}
          to={to}
          kind="fall"
          events={EVENTS}
          provisionalYear={provisional}
          views={[
            {
              key: "colleges",
              label: "Colleges",
              caption: `Share of colleges admitting women (solid) or men (dashed) at a rate ${T}+ points higher, ${fall(lineFrom)} to ${fall(to)}. Numbers: ${fall(from)} → ${fall(to)}.`,
              format: "pct",
              legend: [
                { name: `Women ${T}+ pts higher`, color: COLOR },
                { name: `Men ${T}+ pts higher`, color: COLOR, dashed: true },
              ],
              groupings: groupingTiles(file.groupings, (x) => ({
                series: shareSeries(x),
                summary: `Women ${pct(x.womenHigher[0])} → ${pct(x.womenHigher[1])} · Men ${pct(x.menHigher[0])} → ${pct(x.menHigher[1])}`,
              })),
            },
            {
              key: "students",
              label: "Students",
              caption: `Men's minus women's acceptance rate, averaged with each college's total applicants as the weight, ${fall(lineFrom)} to ${fall(to)}. Below zero: women admitted at a higher rate.`,
              format: "pts",
              axisFormat: "pts",
              legend: [{ name: "Gap, weighted by applicants", color: COLOR }],
              groupings: groupingTiles(file.groupings, (x) => ({
                series: [{ key: "gap", name: "Gap, weighted by applicants", color: COLOR, start: lineFrom, values: x.lines.weightedGap }],
                summary: `Gap ${points(x.weightedMen[0] - x.weightedWomen[0])} → ${points(x.weightedMen[1] - x.weightedWomen[1])}`,
              })),
            },
          ]}
        />
      }
      takeaway={
        <>
          <p>
            Across {file.n.toLocaleString("en-US")} colleges, the share admitting men at a notably higher rate {direction(v.menHigher[0], v.menHigher[1])} from{" "}
            {pct(v.menHigher[0])} in {fall(from)} to {pct(v.menHigher[1])} in {fall(to)}, and the share admitting women at a notably higher rate {nationalWomen}{" "}
            from {pct(v.womenHigher[0])} to {pct(v.womenHigher[1])}.
            {northeast && (
              <>
                {" "}
                In the Northeast, colleges favoring women went from {pct(northeast.womenHigher[0])} to {pct(northeast.womenHigher[1])}.
              </>
            )}
            {westReversed && west && (
              <>
                {" "}
                The West moved the other way: {pct(west.womenHigher[0])} to {pct(west.womenHigher[1])}.
              </>
            )}
          </p>
          <p className="text-muted-foreground">
            A gap can reflect who applies as much as how colleges choose: these numbers show where the gap changed, not why.
          </p>
        </>
      }
      method={[
        <>
          <b className="text-foreground">Notably higher</b> means a gap of {T} or more percentage points, the bar college pages use. Applicants by sex aren&apos;t in
          the history yet, so a college needs {file.minApplicants.toLocaleString("en-US")}+ applicants in total at both ends instead of the college pages&apos; 200 of
          each sex.
        </>,
        <>
          <b className="text-foreground">
            <Term term="colleges-or-students">Colleges or students.</Term>
          </b>{" "}
          Shares and medians count each college once. The <i>Students</i> view and the applicant sentence weight each college by its total applicants.
        </>,
        <>
          <b className="text-foreground">Yearly lines</b> run from {fall(lineFrom)} over the panel colleges reporting each fall; a year is left out of a line when
          under {Math.round(MIN_YEAR_COVERAGE * 100)}% of its colleges reported.
        </>,
      ]}
    />
  );
}
