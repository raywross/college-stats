import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DOMAINS } from "@/lib/metrics";
import { PROFILE_TOPICS, topicHref, type TopicKey } from "@/lib/profile-topics";

/**
 * Interim list of the topic pages on the overview, between the bento and similar schools. The redesign's topic
 * cards (specs/profile-redesign.md#overview-page) replace it.
 */
export function TopicLinks({ unitId, available }: { unitId: string; available: readonly TopicKey[] }) {
  const topics = PROFILE_TOPICS.filter((t) => available.includes(t.key));
  if (!topics.length) return null;
  return (
    <section aria-label="In detail">
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">In detail</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((t) => {
          const color = t.domain ? DOMAINS[t.domain].color : "var(--primary)";
          return (
            <li key={t.key}>
              <Link
                href={topicHref(unitId, t.key)}
                className="group flex h-full flex-col rounded-3xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 sm:p-5"
              >
                <span className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase" style={{ color }}>
                  <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-foreground/70">{t.eyebrow}</span>
                </span>
                <span className="mt-2 font-display text-lg font-bold group-hover:text-primary">{t.label}</span>
                <span className="mt-1 text-sm text-muted-foreground">{t.description}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary">
                  {t.label}, in detail <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
