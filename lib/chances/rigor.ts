import "server-only";
/**
 * The rigor reading (specs/chances/rigor-in-context.md "The reading"; the rules are method/rigor-reading.md, in
 * rigor-rules.ts): the student's schedule placed against what their high school offers, as one of five readings with
 * the catalog sentences that say so. Server-only because it imports the rules; pages and actions compute it and pass
 * the result down (rigor-view.ts holds the client-safe shape). The estimate reads `reading` as a position
 * (method/standing.md); the site shows only the sentences.
 *
 * A reading's sentences are notes (lib/chances/notes.ts keys with already-formatted values), never free text:
 * - the lead sentence for the reading, with the planned courses, IB, dual enrollment, and honors named in it (`extra`);
 * - one sentence on grades in the finished advanced courses, one on AP exam scores, each only when there is data.
 */
import { isAdvancedKind, markPoints, MARK_POINTS, type CoreAtTopLevel } from "../student-profile.ts";
import { coreCount } from "./courses.ts";
import { noteText } from "./notes.ts";
import { placeRigor, type RigorFacts } from "./rigor-rules.ts";
import type { RigorCounts } from "./rigor-view.ts";
import type { CourseEntry, EstimateNote, RigorReading, SchoolOffering } from "./types.ts";

export interface RigorStudent {
  courses: readonly CourseEntry[];
  coreAtTopLevel: CoreAtTopLevel;
  /** The student's grade now (9–12): decides whether a planned course is "planned" or already "scheduled". */
  grade?: number | null;
}

export interface RigorResult {
  reading: RigorReading;
  /** Catalog notes for the reading: the lead sentence first, then grades and exams. */
  notes: EstimateNote[];
  counts: RigorCounts;
}

const note = (key: string, values: EstimateNote["values"] = {}): EstimateNote => ({ key, values });
const one = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);
/** 3.8 for 3.75: one decimal, as the sentences show grades. */
const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

const finalPoints = (c: CourseEntry): number | null => markPoints(c.grades.final);

/**
 * Places `student`'s courses against `offering` (lib/chances/offering.ts schoolOffering). `linked` says whether the
 * student has a high school on their profile: it only chooses between "add your high school" and "we don't have your
 * school's list" for the can't-place sentence.
 */
export function rigorReading(student: RigorStudent, offering: SchoolOffering | null, opts: { linked?: boolean } = {}): RigorResult {
  const courses = student.courses;
  const advancedRows = courses.filter((c) => isAdvancedKind(c.kind));
  const count = (kind: CourseEntry["kind"]) => courses.filter((c) => c.kind === kind).length;
  const offered = offering?.apCount ?? null;
  const counts: RigorCounts = {
    ap: count("ap"),
    ib: count("ib_hl") + count("ib_sl"),
    dual: count("dual"),
    honors: count("honors"),
    advanced: advancedRows.length,
    planned: advancedRows.filter((c) => c.status === "planned").length,
    offered,
  };

  const finals = advancedRows.map(finalPoints).filter((p): p is number => p !== null);
  const latest = advancedRows.map((c) => markPoints(c.grades.final ?? c.grades.s2 ?? c.grades.s1)).filter((p): p is number => p !== null);
  const gpa = latest.length ? latest.reduce((a, b) => a + b, 0) / latest.length : null;
  const core = coreCount(courses, student.coreAtTopLevel);
  const entered = courses.length > 0 || core > 0;
  const facts: RigorFacts = {
    offered,
    advanced: counts.advanced,
    entered,
    core,
    advancedGpa: gpa,
    lowestFinal: finals.length ? Math.min(...finals) : null,
  };
  const { reading, weak } = placeRigor(facts);

  const notes: EstimateNote[] = [];
  if (reading === "cant_place") {
    if (!entered) notes.push(note("rigor.no_courses"));
    else {
      notes.push(note(opts.linked === true ? "rigor.no_offering_data" : "rigor.cant_place"));
      if (counts.advanced > 0) notes.push(note("rigor.counts", { count: counts.advanced }));
    }
    return { reading, notes: [...notes, ...gradeAndExamNotes(advancedRows)], counts };
  }

  // The count in the sentence is AP courses against the school's AP courses; planned courses, IB, dual enrollment, and
  // honors are named in the same sentence (`extra`, built from catalog fragments).
  const taken = Math.min(counts.ap, offered ?? counts.ap);
  const extra = reading === "few_offered" ? "" : extraText(counts, student.grade ?? null);
  if (reading === "few_offered") {
    notes.push(offered === 0 ? note("rigor.none_offered") : note("rigor.few_offered", { offered: offered ?? 0 }));
  } else if (reading === "most") {
    notes.push(note("rigor.most", { taken, offered: offered ?? 0, extra }));
  } else if (reading === "much") {
    notes.push(weak && gpa !== null ? note("rigor.much_weak_grades", { taken, offered: offered ?? 0, gpa: oneDecimal(gpa), extra }) : note("rigor.much", { taken, offered: offered ?? 0, extra }));
  } else {
    notes.push(note("rigor.some", { taken, offered: offered ?? 0, extra }));
  }
  notes.push(...gradeAndExamNotes(advancedRows));
  return { reading, notes, counts };
}

/** What follows the AP count in the lead sentence: " (2 planned), along with 2 dual-enrollment courses, plus 4 honors courses". */
function extraText(c: RigorCounts, grade: number | null): string {
  const others = [c.ib > 0 && one(c.ib, "IB course"), c.dual > 0 && one(c.dual, "dual-enrollment course")].filter((x): x is string => !!x);
  const planned = c.planned > 0 ? ` (${noteText(note(grade === 12 ? "rigor.scheduled_count" : "rigor.planned_count", { count: c.planned }))})` : "";
  const parts: string[] = [];
  if (others.length) parts.push(noteText(note("rigor.plus_kinds", { list: list(others) })));
  if (c.honors > 0) parts.push(noteText(note("rigor.honors", { count: c.honors })));
  return planned + parts.map((p) => `, ${p}`).join("");
}

/** One sentence on the finished advanced courses' grades and one on the AP exams taken, each only with data. */
function gradeAndExamNotes(advancedRows: readonly CourseEntry[]): EstimateNote[] {
  const out: EstimateNote[] = [];
  const finished = advancedRows.map(finalPoints).filter((p): p is number => p !== null);
  if (finished.length > 0) {
    const avg = oneDecimal(finished.reduce((a, b) => a + b, 0) / finished.length);
    const aRange = finished.filter((p) => p >= MARK_POINTS["A-"]).length;
    out.push(aRange > 0 ? note("rigor.grades", { a: aRange, finished: finished.length, gpa: avg }) : note("rigor.grades_avg", { finished: finished.length, gpa: avg }));
  }
  const exams = advancedRows.filter((c) => c.kind === "ap" && c.exam !== null);
  if (exams.length > 0) out.push(note("rigor.exams", { high: exams.filter((c) => (c.exam ?? 0) >= 4).length, taken: exams.length }));
  return out;
}
