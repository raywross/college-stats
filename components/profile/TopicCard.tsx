import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { DOMAINS } from "@/lib/metrics";
import { topicHref, topicOf, type TopicKey } from "@/lib/profile-topics";
import { CARD_FOOTERS } from "@/lib/profile-cards";
import type { Cited } from "@/lib/lineage";
import type { TermKey } from "@/lib/glossary";
import { MetricLabel } from "@/components/ui/info-tip";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { cn } from "@/lib/utils";

/**
 * The shell of an overview topic card (specs/profile-redesign.md#overview-page): eyebrow with the domain color and an
 * optional year, title, the takeaway sentence, the card's figures, and a footer link. The whole card is the link: an
 * overlay anchor sits under the body, which lets pointer events through except on anything interactive (the (i)
 * popovers, links, and rows marked `data-live`, such as a chip row that swipes on phones).
 */
export function TopicCard({
  topic,
  unitId,
  title,
  takeaway,
  year,
  children,
  className,
}: {
  topic: TopicKey;
  unitId: string;
  title: string;
  takeaway?: string;
  /** Appended to the eyebrow, from lineage ("Fall 2024", "since 2013–14"); never a literal. */
  year?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const t = topicOf(topic);
  const color = t.domain ? DOMAINS[t.domain].color : "var(--primary)";
  const href = topicHref(unitId, topic);
  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-3xl border bg-card p-4 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 sm:p-5",
        className
      )}
    >
      <TrackedLink
        href={href}
        event="profile_card_opened"
        properties={{ unit_id: unitId, topic, from: "card" }}
        className="absolute inset-0 z-10 rounded-3xl"
        aria-label={`${t.label}, in detail`}
      />
      <div className="pointer-events-none relative z-20 flex flex-1 flex-col [&_[data-live]]:pointer-events-auto [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color }}>
          <span className="h-1.5 w-5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-foreground/70">
            {t.eyebrow}
            {year && <span className="font-semibold tracking-[0.12em] text-muted-foreground"> · {year}</span>}
          </span>
        </p>
        <h2 className="mt-2 font-display text-xl font-extrabold tracking-tight group-hover:text-primary sm:text-2xl">{title}</h2>
        {takeaway && <p className="mt-1.5 text-sm text-muted-foreground">{takeaway}</p>}
        <div className="mt-4 flex flex-1 flex-col">{children}</div>
        <p className="mt-4 flex items-center justify-between gap-3 text-sm font-bold text-primary">
          <span className="group-hover:underline">{CARD_FOOTERS[topic]}</span>
          <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </p>
      </div>
    </article>
  );
}

/** A compact row of supporting figures under a card's headline; the columns adapt to the card's width. */
export function CardStats({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-4 grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-x-3 gap-y-4 border-t pt-4", className)}>{children}</div>;
}

/** One supporting figure: a cited label, the value, and a short line under it. */
export function CardStat({
  label,
  term,
  cited,
  value,
  sub,
  valueClassName,
  children,
  className,
}: {
  label: string;
  term?: TermKey;
  cited: Cited;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  /** Anything under the value (a mini chart). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <MetricLabel term={term} cited={cited} className="flex-wrap text-[11px] font-semibold text-muted-foreground">
        {label}
      </MetricLabel>
      <p className={cn("mt-0.5 font-display text-xl font-extrabold", valueClassName)}>{value}</p>
      {children}
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** A card's headline figure: the big number with its cited caption, and optionally a ring beside it. */
export function CardHeadline({ value, caption, aside, className }: { value: ReactNode; caption: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      {aside}
      <div className="min-w-0 flex-1">
        <p className="font-display text-4xl font-extrabold tracking-tight">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}
