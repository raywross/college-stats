import { Fragment } from "react";
import type { School } from "@/lib/types";
import { getData } from "@/lib/data";
import { shortName } from "@/lib/brand";
import type { ReadingBlock, ReadingPart } from "@/lib/chances/reading";
import { readingWithMajor } from "@/lib/chances/reading-major";
import { lineCitations } from "@/lib/chances/reading-cites";
import { InfoTip, SourceTip, Term } from "@/components/ui/info-tip";

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
            {lineCitations(line, school, citeField).map((cited, i) => (
              <SourceTip key={`${cited.path}|${i}`} cited={cited} className="mx-0.5" />
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
