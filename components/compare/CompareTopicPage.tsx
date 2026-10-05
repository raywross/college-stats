import type { ReactNode } from "react";
import { toIndexEntry } from "@/lib/data";
import { DOMAINS, METRICS, type MetricKey } from "@/lib/metrics";
import { keyDifferences, type Difference } from "@/lib/insights";
import { COMPARE_TOPIC_FIELDS, TOPIC_DIFF_METRICS, compareTopicOf, type CompareTopicKey } from "@/lib/compare-topics";
import type { Comparison } from "@/lib/compare-data";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { BaselineNote } from "@/components/ui/BaselineNote";
import { InfoTip } from "@/components/ui/info-tip";
import { OnThisPage, type PageItem } from "@/components/profile/OnThisPage";
import { CompareHeader } from "./CompareHeader";
import { CompareTopicNav } from "./CompareTopicNav";

/**
 * The compare band's height from `md` (school chips + topic pills): CompareHeader is exactly this tall there
 * (`md:h-[9.5rem]`, a literal class, so change both together). The table's sticky header row sits under it.
 */
export const COMPARE_BAND = "9.5rem";

/** Blocks with ids land below the site header and the compare band when linked to: pass it to `Block` (in place of BLOCK_SCROLL). */
export const COMPARE_BLOCK_SCROLL = "scroll-mt-[calc(env(safe-area-inset-top,0px)+var(--header-h)+9.5rem)]";

/** Key differences sentences with their gap bars, numbered in the metric's domain color (the overview's list). */
export function KeyDifferenceList({ diffs }: { diffs: Difference[] }) {
  return (
    <ol className="space-y-3">
      {diffs.map((d, i) => (
        <li key={d.metric} className="flex animate-rise gap-3" style={{ animationDelay: `${i * 60}ms` }}>
          <span
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white"
            style={{ backgroundColor: DOMAINS[METRICS[d.metric].domain].color }}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{d.headline}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full origin-left animate-grow-x rounded-full"
                  style={{ width: `${Math.max(6, d.magnitude * 100)}%`, backgroundColor: DOMAINS[METRICS[d.metric].domain].color }}
                />
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {METRICS[d.metric].label}
                <InfoTip term={METRICS[d.metric].term} />
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A compare topic page's frame (specs/compare-redesign.md#topic-pages), the profile's TopicPage for a set of colleges:
 * the compare band with the pills, the topic's own Key differences (up to three, from TOPIC_DIFF_METRICS), "On this
 * page" (a sticky side column from `lg`), the content, the page's source footnote and baseline note, and previous/next
 * topic links.
 */
export function CompareTopicPage({
  comparison,
  topic,
  items,
  children,
  sources,
  differences,
}: {
  comparison: Comparison;
  topic: CompareTopicKey;
  /** The page's blocks, by id, for "On this page"; blocks that didn't render drop out on the client. */
  items: PageItem[];
  children: ReactNode;
  /** Replaces the default MultiSourceNote of COMPARE_TOPIC_FIELDS[topic] (the history page cites its history editions). */
  sources?: ReactNode;
  /** `false` leaves out the Key differences opener. */
  differences?: boolean;
}) {
  const { ids, schools } = comparison;
  const metrics: readonly MetricKey[] = topic === "table" ? [] : TOPIC_DIFF_METRICS[topic];
  const diffs = differences === false || metrics.length === 0 ? [] : keyDifferences(schools).filter((d) => metrics.includes(d.metric)).slice(0, 3);
  const fields = COMPARE_TOPIC_FIELDS[topic];
  const hasList = items.length >= 2;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 pb-12 sm:px-6">
      <CompareHeader schools={schools.map(toIndexEntry)} current={topic} />
      {diffs.length > 0 && (
        <section className="mt-5 rounded-3xl border bg-card p-4 sm:mt-8 sm:p-5">
          <h2 className="mb-4 font-display text-lg font-extrabold tracking-tight">Key differences on {compareTopicOf(topic).label}</h2>
          <KeyDifferenceList diffs={diffs} />
        </section>
      )}
      <div className={hasList ? "pt-5 sm:pt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10" : "pt-5 sm:pt-8"}>
        {hasList && (
          <div className="lg:order-last">
            {/* OnThisPage's own sticky column clears the profile's shorter band; this one clears the compare band. */}
            <div className="lg:sticky" style={{ top: `calc(env(safe-area-inset-top, 0px) + var(--header-h) + ${COMPARE_BAND} + 1rem)` }}>
              <OnThisPage items={items} className="mb-5 lg:mb-0" />
            </div>
          </div>
        )}
        <div className="min-w-0 lg:order-first">
          {children}
          {sources ?? (fields.length > 0 && <MultiSourceNote schools={schools} fields={fields} className="mt-6" />)}
          <BaselineNote className="mt-2" />
          <CompareTopicNav ids={ids} current={topic} />
        </div>
      </div>
    </div>
  );
}
