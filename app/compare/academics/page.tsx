import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { School, FinanceForm } from "@/lib/types";
import type { TermKey } from "@/lib/glossary";
import type { Cited } from "@/lib/lineage";
import { compareHref, compareTopicOf } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, loadCompareDetails, loadCompareHistories, requireComparison } from "@/lib/compare-data";
import { familiesOffered, fieldStat, type FieldStat } from "@/lib/field-compare";
import { majorFamilyName } from "@/lib/majors";
import { cipFamilyTitle, cipTitle } from "@/lib/cip";
import { WINDOW_YEARS, historyYearLabel } from "@/lib/history";
import { METRICS } from "@/lib/metrics";
import { FORM_SHORT, INSTRUCTION_METRIC, endowmentMetricFor } from "@/lib/finances";
import { money, pct } from "@/lib/format";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { Panel, Block } from "@/components/profile/Panel";
import { CompareTopicPage, COMPARE_BLOCK_SCROLL } from "@/components/compare/CompareTopicPage";
import { CompareMetric } from "@/components/compare/CompareMetric";
import { YourMajor } from "@/components/compare/YourMajor";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { InfoTip, MetricLabel, Term } from "@/components/ui/info-tip";
import type { PageItem } from "@/components/profile/OnThisPage";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "academics";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/**
 * Academics, compared (specs/compare-redesign.md#topic-pages): faculty, spending and endowment (bars only within one
 * accounting form), degrees awarded and top majors, and "Your major" moved from the single compare page.
 */
export default async function CompareAcademicsPage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const { schools } = comparison;
  const { citeField } = comparison.data;
  const topic = compareTopicOf(TOPIC);
  const idsKey = comparison.ids.join(",");

  // "Your major" (specs/data-expansion/majors.md, field-of-study.md): broad fields (2-digit CIP families) that at
  // least one compared college awards bachelor's in. Every offered field is computed here (lib/field-compare.ts), so
  // the client section swaps fields in place; `?major=` picks the first one shown.
  const [details, histories] = await Promise.all([loadCompareDetails(idsKey), loadCompareHistories(idsKey)]);
  const caFiles = comparison.historyFiles?.meta.files["c-a"];
  const caEnd = caFiles?.length ? caFiles[caFiles.length - 1].year : null;
  const caWindow: [number, number] | null = caEnd !== null ? [caEnd - WINDOW_YEARS, caEnd] : null;
  const majorOptions = familiesOffered(schools)
    .map((family) => ({ family, title: majorFamilyName(family) ?? cipFamilyTitle(family) ?? family }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const majorStats: Record<string, FieldStat[]> = Object.fromEntries(
    majorOptions.map(({ family }) => [
      family,
      schools.map((s, i) =>
        fieldStat(
          family,
          s,
          details[i]?.tables.majors?.rows,
          details[i]?.tables.programs?.rows,
          histories[i]?.series ?? null,
          caWindow,
          cipTitle,
          (y) => historyYearLabel(y, "academic"),
        ),
      ),
    ]),
  );
  const rawMajor = (typeof params.major === "string" ? params.major : "").slice(0, 2);
  const selectedMajor = majorStats[rawMajor] ? rawMajor : null;

  // Finances (specs/data-expansion/finances.md): public (GASB) and private nonprofit (FASB) colleges report on
  // different accounting forms that aren't directly comparable, so instruction spending and endowment show as bars
  // only when every compared college that reports finances shares one form; otherwise each college's own figure and
  // form appear as text, the same strings the "All the numbers" table shows.
  const forms = new Set(schools.map((s) => s.finances?.form).filter((f): f is FinanceForm => f != null));
  const sameForm = forms.size <= 1;
  const reportingSchool = schools.find((s) => s.finances != null);
  const sharedForm = sameForm ? (reportingSchool?.finances?.form ?? null) : null;
  const instructionMetric = sharedForm ? METRICS[INSTRUCTION_METRIC[sharedForm]] : null;
  const endowmentKey = sameForm && reportingSchool ? endowmentMetricFor(reportingSchool) : null;
  const endowmentMetric = endowmentKey ? METRICS[endowmentKey] : null;

  const instructionText = (s: School): string | null => {
    const f = s.finances;
    return f?.instruction_per_student == null ? null : `${money(f.instruction_per_student)} (${FORM_SHORT[f.form]})`;
  };
  const endowmentText = (s: School): string | null => {
    const f = s.finances;
    return f?.endowment_per_student == null ? null : `${money(f.endowment_per_student)} (${FORM_SHORT[f.form]})`;
  };
  const popularMajorsText = (s: School): string | null =>
    s.academics?.majors_top?.length ? s.academics.majors_top.slice(0, 3).map((m) => `${m.title} ${pct(m.share)}`).join(" · ") : null;

  const hasAcademicsData =
    majorOptions.length > 0 ||
    schools.some(
      (s) =>
        s.academics?.student_faculty_ratio != null ||
        s.academics?.faculty?.full_time_share != null ||
        s.academics?.faculty?.avg_salary_9mo != null ||
        s.finances != null ||
        s.academics?.bachelors_awarded != null ||
        (s.academics?.majors_top?.length ?? 0) > 0,
    );

  const items: PageItem[] = hasAcademicsData
    ? [
        { id: "faculty", label: "Faculty" },
        { id: "spending", label: "Spending and endowment" },
        { id: "degrees", label: "Degrees awarded" },
        ...(majorOptions.length > 0 ? [{ id: "your-major", label: "Your major" }] : []),
      ]
    : [];

  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={items}>
      <Panel
        level={1}
        domain={topic.domain}
        eyebrow={topic.eyebrow}
        title={topic.label}
        takeaway="How these colleges teach, spend per student, and what their graduates major in."
        fields={[]}
      >
        {hasAcademicsData ? (
          <div className="space-y-6">
            <Block id="faculty" className={COMPARE_BLOCK_SCROLL} title="Faculty">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <CompareMetric
                  label="Students per faculty member"
                  term={METRICS.studentFaculty.term}
                  schools={schools}
                  get={METRICS.studentFaculty.get}
                  format={METRICS.studentFaculty.format}
                  flag={{ which: "min", text: "Fewest" }}
                  cited={citeField(METRICS.studentFaculty.field)}
                />
                <CompareMetric
                  label={METRICS.facultyFullTime.label}
                  term={METRICS.facultyFullTime.term}
                  schools={schools}
                  get={METRICS.facultyFullTime.get}
                  format={METRICS.facultyFullTime.format}
                  cited={citeField(METRICS.facultyFullTime.field)}
                />
                <CompareMetric
                  label={METRICS.facultySalary.label}
                  term={METRICS.facultySalary.term}
                  schools={schools}
                  get={METRICS.facultySalary.get}
                  format={METRICS.facultySalary.format}
                  flag={{ which: "max", text: "Highest" }}
                  cited={citeField(METRICS.facultySalary.field)}
                />
              </div>
            </Block>

            <Block
              id="spending"
              className={COMPARE_BLOCK_SCROLL}
              title={
                <>
                  Spending and endowment <InfoTip term="gasb-fasb" />
                </>
              }
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sameForm ? (
                  <>
                    {instructionMetric && (
                      <CompareMetric
                        label={instructionMetric.label}
                        term={instructionMetric.term}
                        schools={schools}
                        get={instructionMetric.get}
                        format={instructionMetric.format}
                        flag={{ which: "max", text: "Highest" }}
                        cited={citeField(instructionMetric.field)}
                      />
                    )}
                    {endowmentMetric && (
                      <CompareMetric
                        label={endowmentMetric.label}
                        term={endowmentMetric.term}
                        schools={schools}
                        get={endowmentMetric.get}
                        format={endowmentMetric.format}
                        flag={{ which: "max", text: "Highest" }}
                        cited={citeField(endowmentMetric.field)}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <TextRows label="Instruction spending per student" term="instruction-expenses" cited={citeField("finances")} schools={schools} value={instructionText} />
                    <TextRows label="Endowment per student" term="endowment" cited={citeField("finances")} schools={schools} value={endowmentText} />
                  </>
                )}
                <CompareMetric
                  label="Tuition share of core revenue"
                  term="gasb-fasb"
                  schools={schools}
                  get={(s) => s.finances?.tuition_share_of_revenue ?? null}
                  format={(v) => pct(v)}
                  cited={citeField("finances")}
                />
              </div>
              {!sameForm && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Shown as figures, not bars: public and private nonprofit colleges report finances on different accounting forms, so dollar amounts aren&apos;t directly comparable
                  across them.
                </p>
              )}
            </Block>

            <Block id="degrees" className={COMPARE_BLOCK_SCROLL} title="Degrees awarded">
              <div className="grid gap-4 md:grid-cols-2">
                <CompareMetric
                  label={METRICS.bachelors.label}
                  term={METRICS.bachelors.term}
                  schools={schools}
                  get={METRICS.bachelors.get}
                  format={METRICS.bachelors.format}
                  cited={citeField(METRICS.bachelors.field)}
                />
                <TextRows label="Most popular majors" term="cip-code" cited={citeField("academics.majors_top")} schools={schools} value={popularMajorsText} />
              </div>
            </Block>

            {majorOptions.length > 0 && (
              <Block id="your-major" className={COMPARE_BLOCK_SCROLL} title="Your major">
                <div className="space-y-4">
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    Pick a field of study to see which of these colleges award bachelor&apos;s degrees in it, how many, and what graduates earn{" "}
                    <Term term="earnings-after-completion">after completion</Term>.
                  </p>
                  <YourMajor
                    ids={idsKey}
                    schools={schools.map((s, i) => ({ id: s.unit_id, name: shortName(s), slot: i }))}
                    options={majorOptions}
                    stats={majorStats}
                    initial={selectedMajor}
                  />
                  <MultiSourceNote schools={schools} fields={["academics.bachelors_by_family", "detail.majors", "detail.programs"]} />
                  {comparison.historyFiles && caWindow && <HistorySourceNote keys={["bachelors"]} files={comparison.historyFiles} range={caWindow} />}
                </div>
              </Block>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None of these colleges reports academics figures.</p>
        )}
      </Panel>

      <Link
        href={compareHref(comparison.ids, "table", { hash: "academics" })}
        className="group mt-6 flex items-center justify-between gap-3 rounded-3xl border bg-card p-4 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 sm:p-5"
      >
        All academics numbers in the table
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </Link>
    </CompareTopicPage>
  );
}

/** One label with its citation, then each college's name and a text value ("Not reported" when null). */
function TextRows({
  label,
  term,
  cited,
  schools,
  value,
}: {
  label: string;
  term: TermKey;
  cited: Cited;
  schools: School[];
  value: (s: School) => string | null;
}) {
  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-5">
      <MetricLabel term={term} cited={cited} className="mb-4 font-display text-base font-bold">
        {label}
      </MetricLabel>
      <div className="space-y-3">
        {schools.map((s, i) => {
          const v = value(s);
          return (
            <div key={s.unit_id} className="space-y-0.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                {shortName(s)}
              </span>
              <p className="text-sm font-medium">{v ?? <span className="font-normal text-muted-foreground">Not reported</span>}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
