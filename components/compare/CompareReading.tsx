import { Fragment } from "react";
import type { School } from "@/lib/types";
import type { Dataset } from "@/lib/data";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { readingLines, type ReadingPart as ReadingPartData } from "@/lib/chances/reading";
import { SourceTip, Term } from "@/components/ui/info-tip";
import { lineCitations } from "@/components/school/ReadingTheRecord";

const KEYS = new Set(["emphasis", "crowding", "weighted"]);

function Part({ part }: { part: ReadingPartData }) {
  const inner = part.style === "strong" ? <strong className="font-bold">{part.text}</strong> : part.style === "em" ? <em className="font-semibold">{part.text}</em> : part.text;
  return part.term ? <Term term={part.term}>{inner}</Term> : <>{inner}</>;
}

/** True when any compared college has an emphasis or GPA-crowding sentence (the block's empty-state check). */
export function hasReading(schools: readonly School[]): boolean {
  return schools.some((s) => readingLines(s).some((l) => KEYS.has(l.key)));
}

/** The Getting in page's "How they read a record": each college's emphasis and GPA-crowding sentences, side by side. */
export function CompareReading({ schools, citeField }: { schools: School[]; citeField: Dataset["citeField"] }) {
  return (
    <ul className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      {schools.map((s, i) => {
        const lines = readingLines(s).filter((l) => KEYS.has(l.key));
        return (
          <li key={s.unit_id} className="flex gap-2.5">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} aria-hidden />
            <div className="min-w-0 text-sm leading-relaxed">
              <p className="font-semibold">{shortName(s)}</p>
              {lines.length === 0 ? (
                <p className="text-muted-foreground">Not reported</p>
              ) : (
                <p>
                  {lines.map((line) => (
                    <Fragment key={line.key}>
                      {line.parts.map((part, j) => (
                        <Part key={j} part={part} />
                      ))}
                      {lineCitations(line, s, citeField).map((cited) => (
                        <SourceTip key={`${cited.path}|${cited.url}`} cited={cited} className="mx-0.5" />
                      ))}{" "}
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
