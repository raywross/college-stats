import type { Metadata } from "next";
import { requireTopic } from "@/lib/profile-data";
import { HISTORY_SERIES } from "@/lib/profile-history";
import { parseHistoryGroup } from "@/lib/history-groups";
import { historyTakeaway } from "@/lib/insights";
import { Panel } from "@/components/profile/Panel";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { OverTimeSection } from "@/components/profile/OverTimeSection";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { HistoryGroupNav } from "@/components/profile/HistoryGroupNav";
import { availableHistoryGroups, pickHistoryGroup, type HistoryGroupKey } from "@/lib/history-groups";
import { historyEvents } from "@/lib/events";
import { WINDOW_YEARS } from "@/lib/history";
import { DOMAINS } from "@/lib/metrics";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "history");
}

// Unlike the other topic pages, this one renders per request: it reads `?group=` so a link from a card ("Over time ·
// Outcomes") lands on that group in the server HTML, without showing Cost first and switching after hydration. The
// data is in memory (loadProfile), so a render costs tens of milliseconds (specs/profile-redesign.md#topic-pages).

const TOPIC = "history";

/** Over time: one chart group at a time with the controls (specs/trends-design.md). 404 without a history shard. */
export default async function HistoryPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const p = await requireTopic(id, TOPIC);
  const { school, history } = p;
  if (!history) return null; // requireTopic already 404s; this narrows the type.

  // The side column lists the chart groups (the other topic pages list their blocks there): the same "which groups
  // have data" rule OverTime uses, and the same group it will show first.
  const { latest } = history.files.meta;
  const changes = historyEvents(history.history).filter((e) => e.year >= latest[e.kind] - WINDOW_YEARS);
  const groups = availableHistoryGroups(history.history.series, changes.length);
  const initialGroup = pickHistoryGroup(parseHistoryGroup(query.group), groups);
  const colors: Record<HistoryGroupKey, string> = {
    cost: DOMAINS.value.color,
    aid: DOMAINS.value.color,
    admissions: DOMAINS.admissions.color,
    scores: DOMAINS.scores.color,
    students: DOMAINS.size.color,
    academics: DOMAINS.size.color,
    outcomes: DOMAINS.value.color,
    changes: "var(--primary)",
  };

  return (
    <TopicPage
      profile={p}
      topic={TOPIC}
      items={[]}
      aside={<HistoryGroupNav unitId={school.unit_id} groups={groups} colors={colors} initial={initialGroup} />}
      sources={<HistorySourceNote keys={HISTORY_SERIES} files={history.files} className="mt-6" />}
    >
      <Panel level={1} domain={null} eyebrow="Over time" title="How it's changed" takeaway={historyTakeaway(history.history, history.files)} school={school} fields={[]}>
        <OverTimeSection school={school} history={history} initialGroup={initialGroup} />
      </Panel>
    </TopicPage>
  );
}
