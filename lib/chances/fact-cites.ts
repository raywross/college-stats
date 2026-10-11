/**
 * The citations behind an estimate's facts, resolved on the server for a static college page (specs/chances/
 * estimate.md "What went into it"): the page can't know which facts an answer will name, so it resolves every field an
 * estimate can cite (lib/chances/what-went-in.ts ESTIMATE_FACT_PATHS) that this college has a source for, and the
 * client picks the ones the answer names. `citeField` is passed in (lib/data.ts), so this module stays pure.
 */
import type { FieldPath } from "../fields.ts";
import { majorUnitCitation, type AnyCited, type Cited } from "../lineage.ts";
import type { School } from "../types.ts";
import { programsFor } from "./guaranteed.ts";
import { majorUnitsFor, universityStatement, type CuratedMajorUnit } from "./major-admission.ts";
import { MAJOR_FIELDS } from "./major-review.ts";
import { ESTIMATE_FACT_PATHS } from "./what-went-in.ts";

type CiteField = (path: FieldPath, school?: School) => Cited;

/** Whether a curated path has anything to cite at this college (a program, a unit); other paths always resolve. */
function hasSource(path: string, unitId: string): boolean {
  if (path.startsWith("reference.guaranteed_admission.")) return programsFor(unitId).length > 0;
  if (path.startsWith("reported.major_admission.")) return majorUnitsFor(unitId).length > 0 || universityStatement(unitId) !== null;
  return true;
}

/** The citation for each field an estimate can cite, by path, for this college. */
export function estimateFactCites(school: School, citeField: CiteField): Record<string, AnyCited> {
  const out: Record<string, AnyCited> = {};
  for (const path of ESTIMATE_FACT_PATHS) if (hasSource(path, school.unit_id)) out[path] = citeField(path, school);
  return out;
}

/** The units a college's major lines can quote: its university-level statement and its schools or majors. */
export function majorUnitsOf(school: Pick<School, "unit_id">): CuratedMajorUnit[] {
  const statement = universityStatement(school.unit_id);
  return [...(statement ? [statement] : []), ...majorUnitsFor(school.unit_id)];
}

/**
 * The citation for each major-admission value of each unit (a note about engineering cites the engineering school's
 * page and edition, not whichever unit the college's first citation would name), by unit id then path.
 */
export function majorUnitCites(school: School, citeField: CiteField): Record<string, Record<string, AnyCited>> {
  const out: Record<string, Record<string, AnyCited>> = {};
  for (const unit of majorUnitsOf(school)) {
    const cites: Record<string, AnyCited> = {};
    for (const path of Object.values(MAJOR_FIELDS)) {
      const base = citeField(path as FieldPath, school);
      const unitCite = majorUnitCitation(path, unit, school);
      cites[path] = unitCite ? { ...base, ...unitCite.source, quote: unitCite.quote } : base;
    }
    out[unit.unit_id] = cites;
  }
  return out;
}
