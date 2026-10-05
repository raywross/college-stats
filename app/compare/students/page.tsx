import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compareHref, compareTopicOf } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, loadCompareDetails, requireComparison } from "@/lib/compare-data";
import { METRICS } from "@/lib/metrics";
import { compact, num, pct } from "@/lib/format";
import { comparedChecklist } from "@/lib/lgbtq-policy";
import { Panel, Block } from "@/components/profile/Panel";
import { CompareTopicPage, COMPARE_BLOCK_SCROLL } from "@/components/compare/CompareTopicPage";
import { CompareMetric } from "@/components/compare/CompareMetric";
import { RaceCompare } from "@/components/compare/RaceCompare";
import { CampusChips } from "@/components/compare/CampusChips";
import { LgbtqPolicyTable } from "@/components/compare/LgbtqPolicyTable";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "students";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/**
 * Students & campus, compared (specs/compare-redesign.md#topic-pages): who's on campus, race and ethnicity, where
 * they come from and transfers, campus chips, and the LGBTQ+ policy checklist.
 */
export default async function CompareStudentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const { ids, schools, data } = comparison;
  const { citeField } = data;
  const topic = compareTopicOf(TOPIC);

  // LGBTQ+ policy checklist (lib/lgbtq-policy.ts; specs/lgbtq-life.md "Where it appears"): never the gender-identity counts.
  const details = await loadCompareDetails(ids.join(","));
  const lgbtqRows = comparedChecklist(schools, details);

  const items = [
    { id: "who", label: "Who's on campus" },
    { id: "about", label: "Who they are" },
    { id: "race", label: "Race & ethnicity" },
    { id: "residence", label: "Where they're from" },
    { id: "campus", label: "Campus" },
    { id: "lgbtq", label: "LGBTQ+ policies" },
  ];

  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={items}>
      <Panel level={1} domain={topic.domain} eyebrow={topic.eyebrow} title={topic.label} takeaway={topic.description} fields={[]}>
        <div className="space-y-8 sm:space-y-10">
          <Block id="who" className={COMPARE_BLOCK_SCROLL} title="Who's on campus">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <CompareMetric
                label="Undergrads"
                term="undergrad-enrollment"
                schools={schools}
                get={METRICS.enrollment.get}
                format={compact}
                flag={{ which: "max", text: "Largest" }}
                cited={citeField("demographics.undergrad_enrollment")}
              />
              <CompareMetric
                label="Pell Grant share"
                term="pell-grant"
                schools={schools}
                get={METRICS.pell.get}
                format={(v) => pct(v)}
                max={1}
                flag={{ which: "max", text: "Highest" }}
                cited={citeField("demographics.pell_grant_percent")}
              />
              <CompareMetric
                label="First-gen share"
                term="first-gen"
                schools={schools}
                get={METRICS.firstGen.get}
                format={(v) => pct(v)}
                max={1}
                flag={{ which: "max", text: "Highest" }}
                cited={citeField("demographics.first_gen_percent")}
              />
              <CompareMetric
                label="Diversity index"
                term="diversity-index"
                schools={schools}
                get={METRICS.diversity.get}
                format={(v) => v.toFixed(2)}
                max={1}
                flag={{ which: "max", text: "Most" }}
                cited={citeField("derived.diversity_index")}
              />
            </div>
          </Block>

          {/* Descriptive, not better or worse, so no flags (specs/compare-redesign.md#students). */}
          <Block id="about" className={COMPARE_BLOCK_SCROLL} title="Who they are">
            <div className="grid gap-4 md:grid-cols-3">
              <CompareMetric
                label="Men"
                term="gender-balance"
                schools={schools}
                get={METRICS.menShare.get}
                format={(v) => pct(v)}
                max={1}
                cited={citeField("demographics.men_share")}
              />
              <CompareMetric
                label="Part-time students"
                term="part-time-student"
                schools={schools}
                get={METRICS.partTime.get}
                format={(v) => pct(v)}
                max={1}
                cited={citeField("demographics.part_time_share")}
              />
              <CompareMetric
                label="Students 25 and older"
                term="adult-students"
                schools={schools}
                get={METRICS.adults.get}
                format={(v) => pct(v)}
                max={1}
                cited={citeField("demographics.age_25_plus_share")}
              />
            </div>
          </Block>

          <RaceCompare schools={schools} cited={citeField("demographics.racial_diversity")} />

          <Block id="residence" className={COMPARE_BLOCK_SCROLL} title="Where they're from">
            <div className="space-y-4">
              <CompareMetric
                variant="row"
                label="First-years from in state"
                term="in-state-student"
                schools={schools}
                get={(s) => s.demographics.residence?.in_state ?? null}
                format={(v) => pct(v)}
                max={1}
                cited={citeField("demographics.residence")}
              />
              <CompareMetric
                variant="row"
                label="First-years from other states"
                term="in-state-student"
                schools={schools}
                get={(s) => s.demographics.residence?.out_of_state ?? null}
                format={(v) => pct(v)}
                max={1}
                cited={citeField("demographics.residence")}
              />
              <CompareMetric
                variant="row"
                label="First-years from abroad"
                term="in-state-student"
                schools={schools}
                get={(s) => s.demographics.residence?.international ?? null}
                format={(v) => pct(v)}
                max={1}
                cited={citeField("demographics.residence")}
              />
              <div className="space-y-4 border-t pt-4">
                <CompareMetric
                  variant="row"
                  label="New transfer students this fall"
                  term="transfer-in"
                  schools={schools}
                  get={(s) => s.demographics.transfer_in?.count ?? null}
                  format={num}
                  cited={citeField("demographics.transfer_in")}
                />
                <CompareMetric
                  variant="row"
                  label="Transfers, share of new undergraduates"
                  term="transfer-in"
                  schools={schools}
                  get={(s) => s.demographics.transfer_in?.share_of_new ?? null}
                  format={(v) => pct(v)}
                  max={1}
                  cited={citeField("demographics.transfer_in")}
                />
              </div>
            </div>
          </Block>

          <CampusChips schools={schools} citeField={citeField} />

          <LgbtqPolicyTable schools={schools} rows={lgbtqRows} />

          <p className="text-sm">
            <Link
              href={compareHref(ids, "table", { hash: "students" })}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              All student numbers in the table <ArrowRight className="size-3.5" />
            </Link>
          </p>
        </div>
      </Panel>
    </CompareTopicPage>
  );
}
