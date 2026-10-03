import type { ReactNode } from "react";
import Link from "next/link";
import { BookMarked, ExternalLink } from "lucide-react";
import type { School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import { yearLabel, type CitedSource } from "@/lib/lineage";
import { getData } from "@/lib/data";
import { cn } from "@/lib/utils";

/** One linked source: "IPEDS Admissions survey, Fall 2024". */
export function SourceItem({ s, last }: { s: CitedSource; last: boolean }) {
  return (
    <span>
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary"
      >
        {s.label}
        <ExternalLink className="size-2.5" aria-hidden />
      </a>
      , {yearLabel(s)}
      {last ? "" : ";"}
    </span>
  );
}

/**
 * Section footnote: every source behind the values a section shows, each with
 * the year it describes. `fields` are registered paths (lib/fields.ts); derived
 * values cite their inputs. See specs/data-lineage.md.
 */
export async function SourceNote({
  fields,
  school,
  className,
  prefix = "Source",
}: {
  fields: readonly FieldPath[];
  school?: School;
  className?: string;
  prefix?: string;
}) {
  const { sourcesForFields } = await getData();
  const sources = sourcesForFields(fields, school);
  return <SourceLine sources={sources} prefix={prefix} className={className} />;
}

export async function SourceLine({ sources, prefix = "Source", className, extra }: { sources: CitedSource[]; prefix?: string; className?: string; extra?: ReactNode }) {
  const { getMeta } = await getData();
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <BookMarked className="size-3.5 shrink-0" aria-hidden />
      <span>{sources.length > 1 || extra ? `${prefix}s` : prefix}:</span>
      {sources.map((s, i) => (
        <SourceItem key={`${s.key}${s.url}${s.year}`} s={s} last={i === sources.length - 1 && !extra} />
      ))}
      {extra}
      <span aria-hidden>·</span>
      <Link href="/data" className="font-medium hover:text-primary hover:underline">
        About the data
      </Link>
      <span className="sr-only">(retrieved {getMeta().retrieved})</span>
    </p>
  );
}

/** Numbered list of every source behind a profile, for the bottom of the page (and print). */
export async function SourceList({ school, fields }: { school: School; fields: readonly FieldPath[] }) {
  const { getMeta, sourcesForFields } = await getData();
  // One entry per dataset or document, listing every year used from it.
  const grouped = new Map<string, CitedSource & { years: string[] }>();
  for (const s of sourcesForFields(fields, school)) {
    const g = grouped.get(`${s.key}|${s.url}`);
    if (g) g.years.push(yearLabel(s));
    else grouped.set(`${s.key}|${s.url}`, { ...s, years: [yearLabel(s)] });
  }
  const sources = [...grouped.values()];
  const meta = getMeta();
  return (
    <section aria-labelledby="sources-heading" className="rounded-3xl border bg-surface-2 p-5 sm:p-6">
      <h2 id="sources-heading" className="flex items-center gap-2 font-display text-lg font-bold">
        <BookMarked className="size-5 text-primary" aria-hidden /> Sources for this profile
      </h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {sources.map((s, i) => (
          <li key={`${s.key}${s.url}`} className="flex gap-3 rounded-2xl border bg-card p-4 text-sm">
            <span className="font-display font-bold text-muted-foreground tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-primary">
                {s.label} <ExternalLink className="size-3" aria-hidden />
              </a>
              <p className="text-xs text-muted-foreground">
                {s.publisher} · {s.years.join("; ")} · retrieved {s.retrieved}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        IPEDS unit ID {school.unit_id} · Data retrieved {meta.retrieved}. Tap any <span className="font-semibold">ⓘ</span> to see
        where that number came from and what year it describes. National ranks and medians include every 4-year college that
        reports the measure.{" "}
        <Link href="/data" className="font-semibold text-primary hover:underline">
          How we source and calculate everything
        </Link>
      </p>
    </section>
  );
}
