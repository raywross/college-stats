import type { ReactNode } from "react";
import { HoverPrefetchLink } from "@/components/ui/hover-prefetch-link";
import { BookMarked } from "lucide-react";
import type { School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import { isEditedSource, yearLabel, type AnyCitedSource, type CitedSource } from "@/lib/lineage";
import { getData } from "@/lib/data";
import { cn } from "@/lib/utils";
import { SourceListItems } from "./SourceListItems";
import { SourceItem, type SourceItemSource } from "./SourceItem";

export { SourceItem } from "./SourceItem";

/** A source cut to what SourceItem shows (round 5: the rest of a citation never reaches the payload). */
const itemOf = (s: AnyCitedSource): SourceItemSource => ({ key: s.key, label: s.label, url: s.url, year: s.year });

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

export async function SourceLine({ sources, prefix = "Source", className, extra }: { sources: AnyCitedSource[]; prefix?: string; className?: string; extra?: ReactNode }) {
  const { getMeta } = await getData();
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <BookMarked className="size-3.5 shrink-0" aria-hidden />
      <span>{sources.length > 1 || extra ? `${prefix}s` : prefix}:</span>
      {sources.map((s, i) => (
        <SourceItem key={`${s.key}${s.url}${s.year}`} s={itemOf(s)} last={i === sources.length - 1 && !extra} />
      ))}
      {extra}
      <span aria-hidden>·</span>
      <HoverPrefetchLink href="/data" className="font-medium hover:text-primary hover:underline">
        About the data
      </HoverPrefetchLink>
      <span className="sr-only">(retrieved {getMeta().retrieved})</span>
    </p>
  );
}

/** Numbered list of every source behind a profile, for the bottom of the page (and print). */
export async function SourceList({ school, fields }: { school: School; fields: readonly FieldPath[] }) {
  const { getMeta, sourcesForFields } = await getData();
  // One entry per dataset or document, listing every year used from it.
  const grouped = new Map<string, CitedSource & { years: string[] }>();
  const cited = sourcesForFields(fields, school);
  // Admin edits aren't a dataset with years: one line below the list says some values were edited.
  const edited = cited.some(isEditedSource);
  for (const s of cited.filter((c) => !isEditedSource(c))) {
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
      {/* The rows are a client component handed only their strings: the same markup, a fifth of the payload (round 5). */}
      <SourceListItems
        sources={sources.map((s) => ({ id: `${s.key}${s.url}`, label: s.label, url: s.url, publisher: s.publisher, years: s.years.join("; "), retrieved: s.retrieved }))}
      />
      {edited && (
        <p className="mt-4 rounded-2xl border bg-card p-4 text-sm">
          <span className="font-semibold">Some values edited by Quad</span>
          <span className="text-muted-foreground">
            {" "}
            · where a source&apos;s value was missing or wrong, Quad&apos;s editors set it by hand. Each one&apos;s ⓘ says when.{" "}
            <HoverPrefetchLink href="/data#edits" className="font-semibold text-primary hover:underline">
              About edits
            </HoverPrefetchLink>
          </span>
        </p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        IPEDS unit ID {school.unit_id} · Data retrieved {meta.retrieved}. Tap any <span className="font-semibold">ⓘ</span> to see
        where that number came from and what year it describes. National ranks and medians include every 4-year college that
        reports the measure.{" "}
        <HoverPrefetchLink href="/data" className="font-semibold text-primary hover:underline">
          How we source and calculate everything
        </HoverPrefetchLink>
      </p>
    </section>
  );
}
