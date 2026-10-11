/**
 * The Major line of "How this college reads a record" (specs/chances/how-colleges-read.md, major-and-grades.md "On
 * the college profile"), only from a quoted statement in data/major-admission.json. It lives apart from reading.ts so
 * the curated file stays out of bundles that only need the other lines (Compare); the admissions page passes the
 * result in as `readingTheRecord(school, { major })`.
 */
import type { FieldPath } from "../fields.ts";
import type { School } from "../types.ts";
import { majorFamilyName } from "../majors.ts";
import { join, line, readingTheRecord, type ReadingBlock, type ReadingLine, type ReadingPart } from "./reading.ts";
import { majorUnitsFor, universityStatement, type CuratedMajorUnit } from "./major-admission.ts";


const EMPHASIS_WORDS: Record<string, string> = { math: "math", science: "science", cs: "computer science", writing: "writing", arts: "arts" };

/** "engineering" for a unit that admits one family of majors, else the unit's own name. */
function unitLabel(u: CuratedMajorUnit): string {
  const family = u.cip_families.length === 1 ? majorFamilyName(u.cip_families[0]) : null;
  return family ? family.toLowerCase() : u.name;
}

/** A college's curated units: its university-level statement and the schools or majors within it. */
export interface MajorSource {
  statement: CuratedMajorUnit | null;
  units: readonly CuratedMajorUnit[];
}

export const curatedMajorSource = (unitId: string): MajorSource => ({ statement: universityStatement(unitId), units: majorUnitsFor(unitId) });

/**
 * The Major line, only from a college's quoted statement (data/major-admission.json): "The major you list doesn't
 * affect admission," or that applicants are compared within the college they apply to and which schools get an extra
 * look at which grades. Nothing is inferred; a college with no statement has no line.
 */
export function majorLine(school: Pick<School, "unit_id">, source: MajorSource = curatedMajorSource(school.unit_id)): ReadingLine | null {
  const statement = source.statement;
  if (statement?.review?.major_considered === "no") {
    return line("major", [{ text: "The major you list " }, { text: "doesn't affect admission", term: "major-review" }, { text: "." }], ["reported.major_admission.review.major_considered"], {
      unitCites: [{ path: "reported.major_admission.review.major_considered", unitId: statement.unit_id }],
    });
  }
  const units = [...(statement ? [statement] : []), ...source.units];
  const pooled = units.filter((u) => u.review?.major_considered === "pool" || u.review?.major_considered === "pool_and_emphasis");
  if (pooled.length === 0) return null;
  const unitCites: { path: FieldPath; unitId: string }[] = [{ path: "reported.major_admission.review.major_considered", unitId: pooled[0].unit_id }];
  const where = units.some((u) => u.unit === "major") ? "college or major" : "college";
  let rest = "";
  const extra = pooled
    .filter((u) => u.review!.emphasis.length > 0)
    .slice(0, 2)
    .map((u) => {
      unitCites.push({ path: "reported.major_admission.review.emphasis", unitId: u.unit_id });
      return `${unitLabel(u)} applicants get an extra look at ${join(u.review!.emphasis.map((e) => EMPHASIS_WORDS[e]))} grades`;
    });
  if (extra.length) rest = `; ${extra.join("; ")}`;
  const parts: ReadingPart[] = [{ text: "Applicants are " }, { text: `compared within the ${where} they apply to`, term: "major-review" }, { text: `${rest}.` }];
  return line("major", parts, unitCites.map((c) => c.path), { unitCites });
}

/** The reading with the Major line included: what the admissions page and the iPhone API show. */
export function readingWithMajor(school: Parameters<typeof readingTheRecord>[0], opts: { name?: string } = {}): ReadingBlock | null {
  return readingTheRecord(school, { ...opts, major: majorLine(school) });
}
