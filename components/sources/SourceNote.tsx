import Link from "next/link";
import { BookMarked, ExternalLink } from "lucide-react";
import type { School, Topic } from "@/lib/types";
import { getMeta, sourcesFor } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * Inline citation: "Source: IPEDS Admissions survey, Fall 2023 (NCES)".
 * Each source links to its dataset; "About the data" links to /sources.
 */
export function SourceNote({
  topics,
  school,
  className,
  prefix = "Source",
  includeCds,
}: {
  topics: Topic[];
  school?: School;
  className?: string;
  prefix?: string;
  /** Also cite the school's own Common Data Set (for CDS-only panels). */
  includeCds?: boolean;
}) {
  const sources = sourcesFor(topics, school, { includeCds });
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <BookMarked className="size-3.5 shrink-0" aria-hidden />
      <span>{sources.length > 1 ? `${prefix}s` : prefix}:</span>
      {sources.map((s, i) => (
        <span key={`${s.key}${s.url}`}>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary"
          >
            {s.label}
            <ExternalLink className="size-2.5" aria-hidden />
          </a>
          , {s.edition}
          {i < sources.length - 1 ? ";" : ""}
        </span>
      ))}
      <span aria-hidden>·</span>
      <Link href="/sources" className="font-medium hover:text-primary hover:underline">
        About the data
      </Link>
      <span className="sr-only">(retrieved {getMeta().retrieved})</span>
    </p>
  );
}

/** Full list for the bottom of a profile: every source used, with publisher and link. */
export function SourceList({ school, topics }: { school: School; topics: Topic[] }) {
  const sources = sourcesFor(topics, school, { includeCds: true });
  const meta = getMeta();
  return (
    <section aria-labelledby="sources-heading" className="rounded-3xl border bg-surface-2 p-5 sm:p-6">
      <h2 id="sources-heading" className="flex items-center gap-2 font-display text-lg font-bold">
        <BookMarked className="size-5 text-primary" aria-hidden /> Sources for this profile
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {sources.map((s) => (
          <li key={`${s.key}${s.url}`} className="rounded-2xl border bg-card p-4 text-sm">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-primary">
              {s.label} <ExternalLink className="size-3" aria-hidden />
            </a>
            <p className="text-xs text-muted-foreground">
              {s.publisher} · {s.edition}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        IPEDS unit ID {school.unit_id} · Data retrieved {meta.retrieved}. National ranks and medians include every 4-year
        college that reports the measure.{" "}
        <Link href="/sources" className="font-semibold text-primary hover:underline">
          How we source and calculate everything
        </Link>
      </p>
    </section>
  );
}
