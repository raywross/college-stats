import { Fragment } from "react";
import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import { majorUnitCitation } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { getData } from "@/lib/data";
import { shortName } from "@/lib/brand";
import type { ReadingBlock, ReadingLine, ReadingPart } from "@/lib/chances/reading";
import { readingWithMajor } from "@/lib/chances/reading-major";
import { majorUnitById } from "@/lib/chances/major-admission";
import { InfoTip, SourceTip, Term } from "@/components/ui/info-tip";

type CiteField = (path: FieldPath, school?: School) => Cited;

/** A line's citations: one per distinct source and year, so a line with two shares from one filing shows one (i). */
export function lineCitations(line: ReadingLine, school: School, citeField: CiteField): Cited[] {
  const out = new Map<string, Cited>();
  // A major line cites each unit it quotes, not whichever unit the college's first citation would name.
  const wanted = line.unitCites ?? line.cites.map((path) => ({ path, unitId: null }));
  for (const { path, unitId } of wanted) {
    const base = citeField(path, school);
    const unit = unitId ? majorUnitById(unitId) : null;
    const unitCite = unit ? majorUnitCitation(path, unit, school) : null;
    const cited = unitCite ? { ...base, ...unitCite.source, quote: unitCite.quote } : base;
    out.set(`${cited.key}|${cited.url ?? ""}|${cited.year ?? ""}`, cited);
  }
  return [...out.values()];
}

function Part({ part }: { part: ReadingPart }) {
  const inner = part.style === "strong" ? <strong className="font-bold">{part.text}</strong> : part.style === "em" ? <em className="font-semibold">{part.text}</em> : part.text;
  return part.term ? <Term term={part.term}>{inner}</Term> : <>{inner}</>;
}

/**
 * "How Vanderbilt reads a record" (specs/chances/how-colleges-read.md): a short paragraph at the top of "What they
 * look at" that does the reading the factor grid, GPA bar, units box, and test-policy line leave to the family. Each
 * sentence comes from the college's own filings (lib/chances/reading.ts) and carries an (i) with the filing's
 * edition. Hidden when fewer than two sentences would show. Nothing here is a score or a ranking.
 */
export async function ReadingTheRecord({ school, block, className }: { school: School; block?: ReadingBlock | null; className?: string }) {
  const reading = block === undefined ? readingWithMajor(school, { name: shortName(school) }) : block;
  if (!reading) return null;
  const { citeField } = await getData();
  return (
    <section aria-label={reading.title} className={`rounded-3xl border bg-card p-4 sm:p-6 ${className ?? ""}`}>
      <h3 className="mb-2 flex items-center gap-1.5 font-display text-lg font-bold">
        {reading.title} <InfoTip term="holistic-admission" />
      </h3>
      <p className="max-w-3xl text-sm leading-relaxed sm:text-base">
        {reading.lines.map((line) => (
          <Fragment key={line.key}>
            {line.parts.map((part, i) => (
              <Part key={i} part={part} />
            ))}
            {lineCitations(line, school, citeField).map((cited) => (
              <SourceTip key={`${cited.path}|${cited.url}`} cited={cited} className="mx-0.5" />
            ))}
            {line.href && (
              <>
                {" "}
                <a href={line.href} className="text-sm text-primary underline-offset-2 hover:underline">
                  See the years by subject
                </a>
              </>
            )}{" "}
          </Fragment>
        ))}
      </p>
    </section>
  );
}
