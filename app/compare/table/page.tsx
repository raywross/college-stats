import type { Metadata } from "next";
import { shortName } from "@/lib/brand";
import { compareAidRows } from "@/lib/cds/financial-aid-compare";
import { costByIncomeRows } from "@/lib/compare-cost-rows";
import { estimatesShown } from "@/lib/cost-curve";
import { TABLE_GROUPS, compareTopicOf, type CompareTableGroup } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, requireComparison } from "@/lib/compare-data";
import { Panel } from "@/components/profile/Panel";
import { CompareTopicPage } from "@/components/compare/CompareTopicPage";
import { CompareTable } from "@/components/compare/CompareTable";
import { DifferencesOnly } from "@/components/compare/DifferencesOnly";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "table";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/**
 * All the numbers (specs/compare-redesign.md#topic-pages): every row the single page's table had, grouped under the
 * topic pills with an anchor per group (`#cost`), and a "Differences only" switch. Also the comparison's accessible view.
 */
export default async function CompareTablePage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const { data, schools } = comparison;
  // CDS financial aid rows (specs/data-expansion/cds-financial-aid.md#compare) close Cost & aid; they need the federal aid year.
  const aidRows = compareAidRows(data.citeField("aid.cohort").year);
  // Cost by income (specs/product/cost-by-income.md): where need-based aid ends, merit, and published promises. The table adds a
  // cell's own year itself, so these rows leave the promise's award year out of the text. Estimates follow the pilot's gate.
  const curveRows = costByIncomeRows(estimatesShown(), { withYear: false });
  const groups: CompareTableGroup[] = TABLE_GROUPS.map((g) => (g.topic === "cost" ? { ...g, rows: [...g.rows, ...curveRows, ...aidRows] } : g));
  const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(schools.map(shortName));
  const topic = compareTopicOf(TOPIC);

  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={groups.map((g) => ({ id: g.topic, label: g.title }))}>
      <Panel
        level={1}
        domain={topic.domain}
        eyebrow={topic.eyebrow}
        title="Every figure, side by side"
        takeaway={`Everything we have for ${names}, grouped like the topic pages. Differences only hides the rows where they match or only one reports.`}
        fields={[]}
      >
        <DifferencesOnly>
          <CompareTable schools={schools} citeField={data.citeField} groups={groups} />
        </DifferencesOnly>
      </Panel>
    </CompareTopicPage>
  );
}
