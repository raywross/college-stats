import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DOMAINS } from "@/lib/metrics";
import { COMPARE_TOPICS, compareHref } from "@/lib/compare-topics";
import type { Comparison } from "@/lib/compare-data";

/**
 * The overview's way into the six topic pages. Interim: a link per topic (label and what the page holds) until the
 * compared topic cards land (specs/compare-redesign.md#overview-page); the table has its own link card below.
 */
export function CompareTopicCards({ comparison }: { comparison: Comparison }) {
  const topics = COMPARE_TOPICS.filter((t) => t.key !== "table");
  return (
    <section aria-labelledby="compare-in-detail">
      <h2 id="compare-in-detail" className="mb-4 font-display text-xl font-extrabold tracking-tight sm:text-2xl">
        In detail
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((t) => {
          const color = t.domain ? DOMAINS[t.domain].color : "var(--primary)";
          return (
            <li key={t.key}>
              <Link
                href={compareHref(comparison.ids, t.key)}
                className="group flex h-full items-start gap-3 rounded-3xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 sm:p-5"
              >
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg font-bold group-hover:text-primary">{t.label}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{t.description}</span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
