import type { Metadata } from "next";
import { requireTopic } from "@/lib/profile-data";
import { TOPIC_FIELDS } from "@/lib/profile-topics";
import { DOMAINS } from "@/lib/metrics";
import { money, pct } from "@/lib/format";
import { fastestGrowingField } from "@/lib/majors";
import { WINDOW_YEARS, historyYearLabel, majorSeriesKey } from "@/lib/history";
import { FORM_LABELS } from "@/lib/finances";
import { Panel, Block } from "@/components/profile/Panel";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { Majors } from "@/components/school/Majors";
import { FieldOfStudy } from "@/components/school/FieldOfStudy";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "academics");
}

// Rendered on first visit and kept for a day (specs/profile-redesign.md#routes); publishes revalidate sooner.
export const revalidate = 86400;
// An empty list makes Next render each college's page on first visit and keep it (ISR); without it the route is
// dynamic on every request (node_modules/next/dist/docs: generateStaticParams, "All paths at runtime").
export async function generateStaticParams() {
  return [];
}

const TOPIC = "academics";

/** Majors and faculty: popular and top-earning majors, student-to-faculty ratio, faculty, spending and endowment. */
export default async function AcademicsPage({ params }: Props) {
  const { id } = await params;
  const p = await requireTopic(id, TOPIC);
  const { data, school, detail, history, ratio, ratioVs, finances, instructionKey, endowmentKey, instructionRank, endowmentRank, fullTimeShare, facultySalaryValue, majorsTop, hasTopPrograms } = p;
  const { citeField, distribution, metricMedian } = data;
  // Majors (specs/data-expansion/majors.md): the fastest-growing field over the 10 years ending with the newest C{Y}_A.
  const caFiles = history?.files.meta.files["c-a"];
  const caEnd = caFiles?.length ? caFiles[caFiles.length - 1].year : null;
  const majorGrowth = history && caEnd !== null ? fastestGrowingField(history.history.series, [caEnd - WINDOW_YEARS, caEnd]) : null;

  const items = [
    { id: "majors", label: "Popular majors" },
    { id: "earnings-by-major", label: "Top-earning majors" },
    { id: "ratio", label: "Students per faculty" },
    { id: "faculty", label: "Faculty" },
    { id: "finances", label: "Spending and endowment" },
  ];

  const takeaway =
    [
      majorsTop?.length ? `The most popular major is ${majorsTop[0].title} (${pct(majorsTop[0].share)} of graduates).` : null,
      ratio !== null ? `${ratio} students for every faculty member${ratioVs ? `, ${ratioVs.word} than at ${pct(ratioVs.share)} of colleges` : ""}.` : null,
      fullTimeShare !== null ? `${pct(fullTimeShare)} of faculty are full-time.` : null,
      finances?.instruction_per_student != null ? `Spends ${money(finances.instruction_per_student)} a year on instruction per student.` : null,
    ]
      .filter(Boolean)
      .join(" ") || "How this college invests in students.";

  return (
    <TopicPage profile={p} topic={TOPIC} items={items}>
      <Panel level={1} domain="size" eyebrow="Academics" title="Majors and faculty" takeaway={takeaway} school={school} fields={TOPIC_FIELDS[TOPIC]}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Majors
            id="majors"
            school={school}
            detail={detail}
            cited={citeField("academics.majors_top", school)}
            citedPrograms={citeField("detail.majors", school)}
            citedEarnings={citeField("detail.programs", school)}
            growth={majorGrowth}
            growthNote={
              majorGrowth && history ? (
                <HistorySourceNote keys={["bachelors", majorSeriesKey(majorGrowth.family)]} files={history.files} range={[majorGrowth.from.year, majorGrowth.to.year]} />
              ) : null
            }
            color={DOMAINS.size.color}
          />
          {hasTopPrograms && <FieldOfStudy id="earnings-by-major" detail={detail} cited={citeField("detail.programs", school)} />}
          {ratio !== null && (
            <Block id="ratio">
              <DistributionStrip
                label="Students per faculty member vs. every college"
                term="student-faculty-ratio"
                dist={distribution("studentFaculty")}
                value={ratio}
                rank={ratioVs?.share ?? null}
                rankPhrase={`${ratioVs?.word ?? "fewer"} students per faculty member than`}
                format="ratio"
                color={DOMAINS.size.color}
                lowLabel="Fewer students per faculty"
                highLabel="More students per faculty"
              />
              <p className="mt-4 text-xs text-muted-foreground">
                Not the average class size: faculty also teach graduate students and do research, and large lectures can sit alongside small seminars.
                <InfoTip term="student-faculty-ratio" className="ml-1" />
              </p>
            </Block>
          )}
          {fullTimeShare !== null && (
            <Block id="faculty">
              <BenchmarkBar
                    label="Full-time faculty"
                    term="full-time-faculty"
                    cited={citeField("academics.faculty.full_time_share", school)}
                    value={fullTimeShare}
                    median={metricMedian("facultyFullTime") ?? undefined}
                    scale={[0, 1]}
                    format={(v) => pct(v)}
                color={DOMAINS.size.color}
              />
            </Block>
          )}
          {facultySalaryValue !== null && (
            <Block id={fullTimeShare === null ? "faculty" : undefined}>
              <MetricLabel term="nine-month-equated-salary" cited={citeField("academics.faculty", school)} className="text-sm font-medium">
                Average faculty salary
              </MetricLabel>
              <p className="mt-2 font-display text-3xl font-extrabold">{money(facultySalaryValue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">9-month equated, all ranks combined. Pay tracks local cost of living as much as a college&apos;s generosity.</p>
            </Block>
          )}
        </div>
        {finances && (
          <Block id="finances" className="mt-4">
            <h4 className="mb-1 flex items-center gap-1 font-display text-base font-bold">
              Spending and endowment <InfoTip term="gasb-fasb" />
            </h4>
            <p className="mb-4 text-xs text-muted-foreground">
              Fiscal {finances.fiscal_year !== null ? historyYearLabel(finances.fiscal_year, "academic") : "year"}. Compared only against other {FORM_LABELS[finances.form]}: public and
              private colleges report finances on different accounting forms that aren&apos;t comparable.
              {finances.form === "gasb" &&
                " Many public universities' endowments sit mostly in a separate foundation this survey doesn't count, so this likely understates what's actually available."}
            </p>
            {finances.instruction_per_student != null && instructionKey && (
              <DistributionStrip
                label="Instruction spending per student"
                term="instruction-expenses"
                dist={distribution(instructionKey)}
                value={finances.instruction_per_student}
                rank={instructionRank}
                rankPhrase="more than"
                format="money"
                color={DOMAINS.value.color}
                lowLabel="Less"
                highLabel="More"
              />
            )}
            {finances.endowment_per_student != null && endowmentKey && (
              <div className="mt-4">
                <DistributionStrip
                  label="Endowment per student"
                  term="endowment"
                  dist={distribution(endowmentKey)}
                  value={finances.endowment_per_student}
                  rank={endowmentRank}
                  rankPhrase="more than"
                  format="money"
                  color={DOMAINS.value.color}
                  lowLabel="Less"
                  highLabel="More"
                />
              </div>
            )}
          </Block>
        )}
      </Panel>
    </TopicPage>
  );
}
