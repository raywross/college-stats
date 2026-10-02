import type { Metadata } from "next";
import { requireTopic } from "@/lib/profile-data";
import { HISTORY_SERIES } from "@/lib/profile-history";
import { historyTakeaway } from "@/lib/insights";
import { Panel } from "@/components/profile/Panel";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { OverTimeSection } from "@/components/profile/OverTimeSection";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "history");
}

// Rendered on first visit and kept for a day (specs/profile-redesign.md#routes); publishes revalidate sooner.
export const revalidate = 86400;

const TOPIC = "history";

/** Over time: every chart group with its controls (specs/trends-design.md). 404 without a history shard. */
export default async function HistoryPage({ params }: Props) {
  const { id } = await params;
  const p = await requireTopic(id, TOPIC);
  const { school, history } = p;
  if (!history) return null; // requireTopic already 404s; this narrows the type.

  return (
    // The chart groups live inside OverTime (another PR turns them into a segmented control), so no "On this page" list.
    <TopicPage profile={p} topic={TOPIC} items={[]} sources={<HistorySourceNote keys={HISTORY_SERIES} files={history.files} className="mt-6" />}>
      <Panel level={1} domain={null} eyebrow="Over time" title="How it's changed" takeaway={historyTakeaway(history.history, history.files)} school={school} fields={[]}>
        <OverTimeSection school={school} history={history} />
      </Panel>
    </TopicPage>
  );
}
