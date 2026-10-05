import type { Metadata } from "next";
import Link from "next/link";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { pct } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import { GROUP_FLOOR } from "@/lib/trend-groups";
import { MIN_YEAR_COVERAGE } from "@/lib/trend-panel";
import { studyBySlug } from "@/lib/trend-studies";
import type { TestOptionalValues } from "@/lib/trends";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { TrendLine } from "@/components/charts/TrendLine";
import { SmallMultiples } from "@/components/trends/SmallMultiples";
import { StudyPage } from "@/components/trends/StudyPage";
import { TrendStat } from "@/components/trends/TrendStat";
import { groupingTiles } from "@/components/trends/tiles";
import { Term } from "@/components/ui/info-tip";

const study = studyBySlug("test-optional")!;

export const metadata: Metadata = { title: study.title, description: study.question };

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const EVENTS = [{ year: 2020, label: "Pandemic" }];
const COLOR = study.color;

/**
 * Study 2 (specs/trends/test-optional.md): who still requires the SAT or ACT, who submits scores, and what happened
 * to published score ranges. Every number and year comes from data/history/trends/test-optional.json.
 */
export default async function TestOptionalPage() {
  const [file, files] = await Promise.all([getTrendFile("test-optional"), getHistoryFiles()]);
  const v = file?.national.values;
  if (!file || !v) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const { from, to, lineFrom, blindFrom } = file;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const provisional = files?.meta.provisional.adm ?? null;
  const BREAKS = [{ year: from, label: `Fall ${from}` }];

  const requiredSeries = (x: TestOptionalValues) => [
    { key: "required", name: "Required", color: COLOR, start: lineFrom, values: x.lines.required },
    { key: "blind", name: "Test-blind (not considered)", color: COLOR, dashed: true, start: blindFrom, values: x.lines.blind },
  ];
  const row = (grouping: string, key: string) => file.groupings.find((g) => g.grouping === grouping)?.groups.find((r) => r.key === key)?.values ?? null;
  const southeast = row("region", "Southeast");
  const publicColleges = row("control", "public");
  const mostSelective = row("selectivity", "most");
  const r1 = row("research", "R1");
  const dropped = file.scoreRanges.find((r) => r.key === "dropped") ?? null;
  const kept = file.scoreRanges.find((r) => r.key === "required-both") ?? null;

  return (
    <StudyPage
      study={study}
      file={file}
      headline={
        <>
          <TrendStat label={<>Still require the SAT or ACT</>} values={v.required} format="pct" from={from} to={to} kind="fall" counts="share of colleges" color={COLOR} />
          <TrendStat
            label={
              <>
                Median college&apos;s <Term term="test-submission">SAT submission share</Term>
              </>
            }
            values={v.satSubmitMedian}
            format="pct"
            from={from}
            to={to}
            kind="fall"
            counts="median college"
            color={COLOR}
          />
          <TrendStat label={<>Median college&apos;s ACT submission share</>} values={v.actSubmitMedian} format="pct" from={from} to={to} kind="fall" counts="median college" color={COLOR} />
        </>
      }
      nationalIntro={
        <>
          Share of colleges whose <Term term="test-policy">test policy</Term> requires the SAT or ACT, each fall since {fall(lineFrom)}, with a thinner line for{" "}
          <Term term="test-optional">test-blind</Term> colleges from {fall(blindFrom)} (code 3 changed meaning that year: before, it meant &quot;not required or
          recommended&quot;; from {fall(blindFrom)}, &quot;not considered at all&quot;). Share of colleges, not students.
        </>
      }
      national={
        <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
          <figcaption className="text-sm font-semibold">Share of colleges requiring the SAT or ACT</figcaption>
          <div className="mt-3">
            <TrendLine
              series={requiredSeries(v)}
              from={lineFrom}
              to={to}
              kind="fall"
              format="pct"
              events={EVENTS}
              breaks={BREAKS}
              provisionalYear={provisional}
              label={`Share of ${file.n.toLocaleString("en-US")} colleges requiring the SAT or ACT, ${fall(lineFrom)} to ${fall(to)}, with a thinner line for test-blind colleges from ${fall(blindFrom)}`}
            />
          </div>
        </figure>
      }
      breakdownsIntro={<>The same share-requiring line for each group, on one scale, plus research tier and athletic division.</>}
      breakdowns={
        <SmallMultiples
          label="Share of colleges requiring the SAT or ACT"
          from={lineFrom}
          to={to}
          kind="fall"
          events={EVENTS}
          provisionalYear={provisional}
          views={[
            {
              key: "colleges",
              label: "Colleges",
              caption: `Share of colleges requiring the SAT or ACT, ${fall(lineFrom)} to ${fall(to)}. Numbers: ${fall(from)} → ${fall(to)}.`,
              format: "pct",
              legend: [{ name: "Required", color: COLOR }],
              groupings: groupingTiles(file.groupings, (x) => ({
                series: [{ key: "required", name: "Required", color: COLOR, start: lineFrom, values: x.lines.required }],
                summary: `Required ${pct(x.required[0])} → ${pct(x.required[1])}`,
              })),
            },
          ]}
        />
      }
      takeaway={
        <>
          <p>
            Across {file.n.toLocaleString("en-US")} colleges, the share requiring the SAT or ACT fell from {pct(v.required[0])} in {fall(from)} to{" "}
            {pct(v.required[1])} in {fall(to)}: a gradual decline through the 2010s that the pandemic finished in two years.
            {southeast && publicColleges && (
              <>
                {" "}
                The Southeast and public colleges held out longest: {pct(southeast.required[1])} of Southeast colleges and {pct(publicColleges.required[1])} of
                public colleges still require a test, the highest shares of any group shown here.
              </>
            )}
            {mostSelective && r1 && (
              <>
                {" "}
                Submission collapsed everywhere, but least at the most selective colleges ({pct(mostSelective.satSubmitMedian[1])} still submit an SAT) and R1
                universities ({pct(r1.satSubmitMedian[1])}).
              </>
            )}
          </p>
          <p>
            {dropped && kept && (
              <>
                Published SAT ranges rose where tests became optional (25th percentile {dropped.p25 ? `+${dropped.p25[1] - dropped.p25[0]}` : "—"} points at the{" "}
                {dropped.n.toLocaleString("en-US")} colleges that dropped the requirement) and fell where colleges kept requiring tests (
                {kept.p25 ? `${kept.p25[1] - kept.p25[0]}` : "—"} points at {kept.n.toLocaleString("en-US")} colleges).
              </>
            )}{" "}
            That&apos;s consistent with who chooses to submit a score once it&apos;s optional, not evidence that admitted students got stronger.{" "}
            {file.wentBackToRequiring.length > 0 && (
              <>{file.wentBackToRequiring.length} colleges have already reversed course and require tests again; see the list below.</>
            )}
          </p>
          <p className="text-muted-foreground">
            A <Term term="test-optional">test-optional</Term> or test-blind <Term term="test-policy">policy</Term> changes who submits a score, not just whether a
            score is required: these numbers show where the pattern changed, not why any one college changed policy.
          </p>
        </>
      }
      method={[
        <>
          <b className="text-foreground">Test-blind</b> (code 3) meant &quot;neither required nor recommended&quot; through fall {blindFrom - 1} and &quot;not
          considered at all&quot; from fall {blindFrom} on, when IPEDS dropped &quot;recommended&quot; as a separate answer. The thinner line and the
          optional/blind groups below use only fall {blindFrom} on for that reason.
        </>,
        <>
          <b className="text-foreground">Score ranges.</b> The dumbbell compares colleges with a published SAT 25th and 75th percentile in both {fall(from)} and{" "}
          {fall(to)}, split by what each college&apos;s test policy did over the same two years; each group still needs {GROUP_FLOOR}+ colleges, or it isn&apos;t
          charted (the colleges that went back to requiring tests are named instead).
        </>,
        <>
          <b className="text-foreground">
            <Term term="colleges-or-students">Colleges or students.</Term>
          </b>{" "}
          Shares and medians count each college once. The enrollment-weighted sentence above weights each college by its enrolled first-years.
        </>,
        <>
          <b className="text-foreground">Yearly lines</b> run from {fall(lineFrom)} over the panel colleges reporting each fall; a year is left out of a line when
          under {Math.round(MIN_YEAR_COVERAGE * 100)}% of its colleges reported.
        </>,
      ]}
      links={[
        { href: "/glossary#test-optional", label: "Glossary: test-optional and test-blind" },
        { href: "/#whats-changed", label: "Home: Test-optional went mainstream" },
      ]}
    >
      <section aria-labelledby="who-submits" className="min-w-0">
        <h2 id="who-submits" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Who still submits
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          The median college&apos;s share of enrolled first-years submitting an SAT or ACT score, {fall(lineFrom)} to {fall(to)}. Submission collapsed with the
          requirement, but least at the most selective colleges and R1 universities. The Midwest&apos;s low SAT submission and high ACT submission is the region&apos;s
          longstanding <Term term="act">ACT</Term> preference, not a new pattern.
        </p>
        <div className="mt-5 rounded-3xl border bg-card p-4 sm:p-5">
          <TrendLine
            series={[
              { key: "sat", name: "SAT", color: COLOR, start: lineFrom, values: v.lines.satSubmitMedian },
              { key: "act", name: "ACT", color: COLOR, dashed: true, start: lineFrom, values: v.lines.actSubmitMedian },
            ]}
            from={lineFrom}
            to={to}
            kind="fall"
            format="pct"
            events={EVENTS}
            provisionalYear={provisional}
            label={`Median college's share of enrolled first-years submitting an SAT (solid) or ACT (dashed) score, ${fall(lineFrom)} to ${fall(to)}`}
          />
        </div>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          <b className="text-foreground">Counting students instead of colleges:</b> weighted by each college&apos;s enrolled first-years, {pct(v.satSubmitMedian[0])} of
          enrolled first-years submitted an SAT at the median college in {fall(from)}; averaged across all {file.n.toLocaleString("en-US")} colleges by enrollment, the
          share submitting an SAT was {pct(file.weightedSatSubmit[0])} in {fall(from)} and {pct(file.weightedSatSubmit[1])} in {fall(to)}.
        </p>
      </section>

      <section aria-labelledby="score-ranges" className="min-w-0">
        <h2 id="score-ranges" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          What happened to the ranges
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Published <Term term="sat">SAT</Term> 25th and 75th percentiles, {fall(from)} → {fall(to)}, by what each college&apos;s test policy did. These ranges describe
          only the students who chose to submit scores, not every entering student: a rising range at colleges that dropped the requirement is consistent with who
          chooses to submit, not evidence that admitted students got stronger.
        </p>
        <div className="mt-5 grid gap-6 rounded-3xl border bg-card p-4 sm:grid-cols-2 sm:p-6">
          <div>
            <p className="mb-3 text-sm font-semibold">25th percentile SAT</p>
            <Dumbbell
              format="int"
              color={COLOR}
              fromLabel={fall(from)}
              toLabel={fall(to)}
              rows={file.scoreRanges.map((r) => ({ label: r.label, from: r.p25?.[0] ?? null, to: r.p25?.[1] ?? null }))}
            />
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold">75th percentile SAT</p>
            <Dumbbell
              format="int"
              color={COLOR}
              fromLabel={fall(from)}
              toLabel={fall(to)}
              rows={file.scoreRanges.map((r) => ({ label: r.label, from: r.p75?.[0] ?? null, to: r.p75?.[1] ?? null }))}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {file.scoreRanges.map((r) => `${r.label}: ${r.n.toLocaleString("en-US")} colleges`).join(" · ")}. Colleges with a published SAT 25th and 75th percentile in
          both years.
        </p>
      </section>

      {file.wentBackToRequiring.length > 0 && (
        <section aria-labelledby="went-back" className="min-w-0">
          <h2 id="went-back" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Went back to requiring tests
          </h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            {file.wentBackToRequiring.length} colleges that didn&apos;t require the SAT or ACT in {fall(blindFrom)} require it again by {fall(to)}: too few to chart
            as their own group, but worth naming.
          </p>
          <ul className="mt-4 divide-y rounded-3xl border bg-card">
            {file.wentBackToRequiring.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link href={`/schools/${c.id}`} className="font-semibold hover:text-primary hover:underline">
                  {c.name}
                </Link>
                <span className="shrink-0 text-muted-foreground">{c.policyNow}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </StudyPage>
  );
}
