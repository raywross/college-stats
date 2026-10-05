import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compareHref, compareTopicOf } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, requireComparison } from "@/lib/compare-data";
import { METRICS, TEST_POLICY_LABELS, admitRatesBySex, satTotal } from "@/lib/metrics";
import { compact, pct, pctSmart } from "@/lib/format";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import type { School } from "@/lib/types";
import { Panel, Block } from "@/components/profile/Panel";
import { CompareTopicPage, COMPARE_BLOCK_SCROLL } from "@/components/compare/CompareTopicPage";
import { CompareMetric } from "@/components/compare/CompareMetric";
import { ScoreCompare } from "@/components/compare/ScoreCompare";
import { AdmissionFactorsGrid, anyAdmissionFactorReported } from "@/components/compare/AdmissionFactorsGrid";
import { InfoTip } from "@/components/ui/info-tip";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "admissions";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/** Whether a college reports anything this page shows, beyond the per-factor grid (checked separately). */
function reportsAdmissions(s: School): boolean {
  const a = s.admissions;
  return (
    a.acceptance_rate !== null ||
    a.applicants !== null ||
    a.admitted !== null ||
    METRICS.yield.get(s) !== null ||
    !!a.by_sex ||
    satTotal(s) !== null ||
    a.act_composite_25_75 !== null ||
    a.test_submission_rate_sat !== null ||
    a.test_submission_rate_act !== null ||
    !!a.test_policy
  );
}

/**
 * Getting in, compared (specs/compare-redesign.md#topic-pages): the funnel, admit rates by sex, test scores and
 * policy, and what each college weighs, with a link to every admissions row in the full table.
 */
export default async function CompareAdmissionsPage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const { data, ids, schools } = comparison;
  const { citeField } = data;
  const topic = compareTopicOf(TOPIC);

  const hasData = schools.some(reportsAdmissions) || anyAdmissionFactorReported(schools);
  // The year named in the title: the applicants field's lineage year, the same convention the profile page uses.
  const year = citeField("admissions.applicants").year;
  const title = year ? `${topic.label}, ${year.toLowerCase()}` : topic.label;

  const items = hasData
    ? [
        { id: "funnel", label: "The funnel" },
        { id: "by-sex", label: "Men and women" },
        { id: "scores", label: "Test scores" },
        { id: "factors", label: "What they look at" },
      ]
    : [];

  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={items}>
      <Panel level={1} domain={topic.domain} eyebrow={topic.eyebrow} title={title} takeaway={topic.description} fields={[]}>
        {!hasData ? (
          <p className="text-muted-foreground">None of these colleges reports admissions figures.</p>
        ) : (
          <div className="space-y-8 sm:space-y-10">
            <Block id="funnel" title="The funnel" className={COMPARE_BLOCK_SCROLL}>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <CompareMetric
                  label="Acceptance rate"
                  term="acceptance-rate"
                  schools={schools}
                  get={METRICS.acceptance.get}
                  format={pctSmart}
                  flag={{ which: "min", text: "Most selective" }}
                  cited={citeField("admissions.acceptance_rate")}
                />
                <CompareMetric
                  label="Applicants"
                  term="applicants"
                  schools={schools}
                  get={METRICS.applicants.get}
                  format={compact}
                  flag={{ which: "max", text: "Most" }}
                  cited={citeField("admissions.applicants")}
                />
                <CompareMetric
                  label="Admitted"
                  term="admitted"
                  schools={schools}
                  get={(s) => s.admissions.admitted}
                  format={compact}
                  flag={{ which: "max", text: "Most" }}
                  cited={citeField("admissions.admitted")}
                />
                <CompareMetric
                  label="Yield rate"
                  term="yield"
                  schools={schools}
                  get={METRICS.yield.get}
                  format={(v) => pct(v)}
                  max={1}
                  flag={{ which: "max", text: "Highest" }}
                  cited={citeField("derived.yield")}
                />
              </div>
            </Block>

            <Block id="by-sex" title="Men and women" className={COMPARE_BLOCK_SCROLL}>
              <p className="mb-4 text-sm text-muted-foreground">
                Acceptance rate for men and women who applied, where a college reports admissions by sex.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <CompareMetric
                  label="Women admitted"
                  term="admit-rate-by-sex"
                  schools={schools}
                  get={(s) => admitRatesBySex(s).women}
                  format={pctSmart}
                  max={1}
                  cited={citeField("derived.admit_rate_women")}
                />
                <CompareMetric
                  label="Men admitted"
                  term="admit-rate-by-sex"
                  schools={schools}
                  get={(s) => admitRatesBySex(s).men}
                  format={pctSmart}
                  max={1}
                  cited={citeField("derived.admit_rate_men")}
                />
              </div>
            </Block>

            <Block id="scores" title="Test scores" className={COMPARE_BLOCK_SCROLL}>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <ScoreCompare schools={schools} test="sat" />
                  <ScoreCompare schools={schools} test="act" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <CompareMetric
                    label="Submitted SAT"
                    term="test-submission"
                    schools={schools}
                    get={(s) => s.admissions.test_submission_rate_sat}
                    format={(v) => pct(v)}
                    max={1}
                    cited={citeField("admissions.test_submission_rate_sat")}
                  />
                  <CompareMetric
                    label="Submitted ACT"
                    term="test-submission"
                    schools={schools}
                    get={(s) => s.admissions.test_submission_rate_act}
                    format={(v) => pct(v)}
                    max={1}
                    cited={citeField("admissions.test_submission_rate_act")}
                  />
                </div>
                <div className="border-t pt-4">
                  <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    Test policy <InfoTip term="test-policy" cited={citeField("admissions.test_policy")} />
                  </h4>
                  <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                    {schools.map((s, i) => (
                      <li key={s.unit_id} className="flex items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                        <span className="font-semibold">{shortName(s)}</span>
                        <span className="text-muted-foreground">{s.admissions.test_policy ? TEST_POLICY_LABELS[s.admissions.test_policy] : "Not reported"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Block>

            <Block id="factors" title="What they look at" className={COMPARE_BLOCK_SCROLL}>
              <AdmissionFactorsGrid schools={schools} citeField={citeField} />
            </Block>

            <Link
              href={compareHref(ids, "table", { hash: "admissions" })}
              className="group flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
            >
              <span className="text-sm font-semibold group-hover:text-primary">All admissions numbers in the table</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          </div>
        )}
      </Panel>
    </CompareTopicPage>
  );
}
