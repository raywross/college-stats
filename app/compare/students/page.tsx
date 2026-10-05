import type { Metadata } from "next";
import { compareTopicOf } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, requireComparison } from "@/lib/compare-data";
import { Panel } from "@/components/profile/Panel";
import { CompareTopicPage } from "@/components/compare/CompareTopicPage";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "students";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/** Students & campus, compared. A placeholder in the compare frame until the page is built (specs/compare-redesign.md). */
export default async function CompareStudentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const topic = compareTopicOf(TOPIC);
  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={[]}>
      <Panel level={1} domain={topic.domain} eyebrow={topic.eyebrow} title={topic.label} fields={[]}>
        <p className="text-muted-foreground">This page is being built.</p>
      </Panel>
    </CompareTopicPage>
  );
}
