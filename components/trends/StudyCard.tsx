import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { formatBy } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import type { StudyDef } from "@/lib/trend-studies";
import type { TrendCard } from "@/lib/trends";

/**
 * A study's card on /trends (specs/national-trends.md#where-it-appears): headline number, a sparkline of its national
 * line, one sentence, and a link. Everything but the title and color comes from data/history/trends/index.json.
 */
export function StudyCard({ study, card }: { study: StudyDef; card: TrendCard }) {
  // The first series is the headline (the study's color); others are context in neutral ink.
  const colors = [study.color, "var(--muted-foreground)"];
  return (
    <Link
      href={`/trends/${study.slug}`}
      className="group flex min-w-0 flex-col rounded-3xl border bg-card p-4 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 sm:p-6"
    >
      <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Study {study.number}</p>
      <h3 className="mt-1 font-display text-xl font-bold tracking-tight">{study.title}</h3>
      <p className="mt-4 font-display text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">{formatBy(card.headline.format, card.headline.value)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {card.headline.caption}, {historyYearLabel(card.to, card.yearKind).toLowerCase()}
      </p>
      <div className="mt-4">
        <Sparkline
          label={`${card.spark.series.map((s) => s.name).join(" and ")}, ${historyYearLabel(card.spark.start, card.spark.kind).toLowerCase()} to ${historyYearLabel(card.to, card.yearKind).toLowerCase()}`}
          start={card.spark.start}
          kind={card.spark.kind}
          format={card.spark.format}
          series={card.spark.series.map((s, i) => ({ name: s.name, values: s.values, color: colors[Math.min(i, colors.length - 1)], dashed: i > 0 }))}
        />
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {card.spark.series.map((s, i) => (
            <li key={s.name} className="inline-flex items-center gap-1.5">
              <svg width="16" height="4" aria-hidden className="shrink-0">
                <line x1="1" x2="15" y1="2" y2="2" stroke={colors[Math.min(i, colors.length - 1)]} strokeWidth={2} strokeDasharray={i > 0 ? "4 3" : undefined} strokeLinecap="round" />
              </svg>
              {s.name}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-4 flex-1 text-sm text-muted-foreground">{card.sentence}</p>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {card.n.toLocaleString("en-US")} colleges · {historyYearLabel(card.from, card.yearKind)} → {historyYearLabel(card.to, card.yearKind).toLowerCase()}
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary">
        Read the study <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
