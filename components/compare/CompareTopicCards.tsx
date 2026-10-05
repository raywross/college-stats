import { COMPARE_TOPICS } from "@/lib/compare-topics";
import type { Comparison } from "@/lib/compare-data";
import { CARD_TITLES, applicationsSince, cardRows, cardYearField, type CardTopic } from "@/lib/compare-cards";
import { compareTakeaway } from "@/lib/compare-insights";
import { sinceLabel } from "@/lib/profile-cards";
import { CompareTopicCard } from "./CompareTopicCard";
import { CompareCardRows } from "./CompareCardRows";

/**
 * The overview's topic cards (specs/compare-redesign.md#overview-page): one per topic page in COMPARE_TOPICS order (the
 * table has its own link card below), two columns from `sm` and stacked on phones. Each compares its headline figures
 * across the colleges (lib/compare-cards.ts) under a one-sentence takeaway (lib/compare-insights.ts) and links to its
 * page; a card none of the colleges has a figure for is left out (owner assumption 8).
 */
export function CompareTopicCards({ comparison }: { comparison: Comparison }) {
  const { data, ids, schools } = comparison;
  const { citeField } = data;
  const cards = COMPARE_TOPICS.flatMap((t) => {
    if (t.key === "table") return [];
    const rows = cardRows(t.key, schools);
    return rows.length ? [{ topic: t.key, rows }] : [];
  });
  if (!cards.length) return null;

  /** The eyebrow's year: the release of the card's headline figure, or Over time's first fall. */
  const yearOf = (topic: CardTopic): string | null => {
    if (topic === "history") {
      const since = applicationsSince(schools);
      return since === null ? null : sinceLabel(since, "fall");
    }
    // A derived figure (average cost) takes its inputs' release.
    const cited = citeField(cardYearField(topic));
    return cited.year ?? cited.inputs?.[0]?.year ?? null;
  };

  return (
    <section aria-label="Topics" className="grid gap-4 sm:grid-cols-2">
      {cards.map(({ topic, rows }) => (
        <CompareTopicCard key={topic} topic={topic} ids={ids} title={CARD_TITLES[topic]} takeaway={compareTakeaway(topic, schools)} year={yearOf(topic)}>
          <CompareCardRows rows={rows} schools={schools} citeField={citeField} />
        </CompareTopicCard>
      ))}
    </section>
  );
}
