/**
 * The citations behind "How {college} reads a record" (specs/chances/how-colleges-read.md; components/school/
 * ReadingTheRecord.tsx and the compare page's CompareReading.tsx). Pure: the caller passes the dataset's `citeField`.
 */
import type { FieldPath } from "../fields.ts";
import { majorUnitCitation, type Cited, type CiteLike } from "../lineage.ts";
import type { School } from "../types.ts";
import { citeRefWhereSame } from "../planner/plan-cites.ts";
import { majorUnitById } from "./major-admission.ts";
import type { ReadingLine } from "./reading.ts";

type CiteField = (path: FieldPath, school?: School) => Cited;

/**
 * A line's citations: one per distinct source and year, so a line with two shares from one filing shows one (i). Each
 * of the college's own goes out as a reference the ⓘ fetches on open (round 4; `citeRefWhereSame`); a major unit's
 * stays whole, since it carries that unit's page and quote, which `GET /api/cite` doesn't know.
 */
export function lineCitations(line: ReadingLine, school: School, citeField: CiteField): CiteLike[] {
  const out = new Map<string, CiteLike>();
  // A major line cites each unit it quotes, not whichever unit the college's first citation would name.
  const wanted = line.unitCites ?? line.cites.map((path) => ({ path, unitId: null }));
  for (const { path, unitId } of wanted) {
    const base = citeField(path, school);
    const unit = unitId ? majorUnitById(unitId) : null;
    const unitCite = unit ? majorUnitCitation(path, unit, school) : null;
    const cited = unitCite ? { ...base, ...unitCite.source, quote: unitCite.quote } : base;
    out.set(`${cited.key}|${cited.url ?? ""}|${cited.year ?? ""}`, unitCite ? cited : citeRefWhereSame(cited, school.unit_id));
  }
  return [...out.values()];
}
