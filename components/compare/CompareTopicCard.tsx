import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { DOMAINS } from "@/lib/metrics";
import { compareHref, compareTopicOf } from "@/lib/compare-topics";
import { CARD_FOOTERS, type CardTopic } from "@/lib/compare-cards";
import { cn } from "@/lib/utils";

/**
 * The shell of a compare overview topic card (specs/compare-redesign.md#overview-page), the profile's TopicCard for a
 * set of colleges: eyebrow with the topic's domain color and a year from lineage, title, the comparative takeaway, the
 * compared rows, and a footer naming what the topic page holds. The whole card is the link: an overlay anchor sits under
 * the body, which lets pointer events through except on anything interactive (the (i) popovers, links, and anything
 * marked `data-live`). Phones get the domain color and an arrow beside the title instead of the eyebrow and the footer
 * (which wraps to two lines there), so six stacked cards fit the overview's phone budget (4,000px).
 */
export function CompareTopicCard({
  topic,
  ids,
  title,
  takeaway,
  year,
  children,
  className,
}: {
  topic: CardTopic;
  /** The compared colleges' ids, for the link to the topic page. */
  ids: readonly string[];
  title: string;
  takeaway?: string;
  /** Appended to the eyebrow, from lineage ("Fall 2024", "since fall 2014"); never a literal. */
  year?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const t = compareTopicOf(topic);
  const color = t.domain ? DOMAINS[t.domain].color : "var(--primary)";
  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-3xl border bg-card p-3.5 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 sm:p-4",
        className
      )}
    >
      <Link href={compareHref(ids, topic)} className="absolute inset-0 z-10 rounded-3xl" aria-label={`${t.label}, compared in detail`} />
      <div className="pointer-events-none relative z-20 flex flex-1 flex-col [&_[data-live]]:pointer-events-auto [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        {/* Phones drop the eyebrow, as page headers do there (specs/mobile.md); each row's (i) still names its year. */}
        <p className="hidden items-center gap-2 text-[11px] leading-4 font-bold tracking-[0.18em] uppercase sm:flex" style={{ color }}>
          <span className="h-1.5 w-5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-foreground/70">
            {t.eyebrow}
            {year && <span className="font-semibold tracking-[0.12em] text-muted-foreground"> · {year}</span>}
          </span>
        </p>
        <h2 className="flex items-center gap-2 font-display text-xl leading-tight font-extrabold tracking-tight group-hover:text-primary sm:mt-1">
          <span className="h-1.5 w-4 shrink-0 rounded-full sm:hidden" style={{ backgroundColor: color }} aria-hidden />
          <span className="min-w-0 flex-1">{title}</span>
          <ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5 sm:hidden" aria-hidden />
        </h2>
        {takeaway && <p className="mt-0.5 text-sm text-muted-foreground sm:mt-1">{takeaway}</p>}
        <div className="mt-2.5 flex-1 sm:mt-3">{children}</div>
        <p className="mt-3 hidden items-center justify-between gap-3 text-sm font-bold text-primary sm:flex">
          <span className="group-hover:underline">{CARD_FOOTERS[topic]}</span>
          <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </p>
      </div>
    </article>
  );
}
