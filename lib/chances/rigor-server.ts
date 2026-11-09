import "server-only";
/**
 * Builds what the pages send down for the rigor reading (specs/chances/rigor-in-context.md "Where it shows"): the
 * student's high school and its offering (lib/chances/offering.ts over the high school record), and the reading with
 * its sentences. Server only: it imports the rules. Called by the Plan loader, by the Server Actions in rigor-store.ts
 * (signed-out visitors send their browser-kept list), and by the high school page's line.
 */
import { getHighSchoolRecord } from "@/lib/high-schools";
import { citeHsView, type HsFieldPath } from "@/lib/hs-fields";
import type { CoreAtTopLevel } from "@/lib/student-profile";
import { schoolOffering } from "./offering";
import { apCourseKeys, pooledCourseKeys } from "./school-courses";
import { rigorReading } from "./rigor";
import { offeringLines, sentencesFrom, type OfferingView, type RigorView } from "./rigor-view";
import type { CourseEntry, SchoolOffering } from "./types";

const NOTHING: SchoolOffering = { apCount: null, apKeys: null, ib: null, dual: null, source: null, field: null };

/**
 * The student's school and what it offers; nothing (and a null view) without a school id or a record for it. Best
 * source first (offering.ts): the school's profile, then the pooled list other students at the school have made (three
 * or more, from the database; absent tables read as nothing), then the student's own marks, then the CRDC count.
 */
export async function offeringFor(highSchoolId: string | null, opts: { studentMarks?: readonly string[] | null } = {}): Promise<{ offering: SchoolOffering; view: OfferingView | null }> {
  if (!highSchoolId) return { offering: NOTHING, view: null };
  const record = await getHighSchoolRecord(highSchoolId).catch(() => null);
  // No record for the school: only the student's own marks can say what it offers.
  if (!record) return { offering: opts.studentMarks?.length ? schoolOffering({ school: null, detail: null, studentMarks: opts.studentMarks }) : NOTHING, view: null };
  const hs = record.view;
  // The pooled list came with the school (high_school_bundle()); only the `json` source leaves it to a call of its own.
  const pooled = hs.detail?.ap_courses?.length ? null : record.courses === "unread" ? await pooledCourseKeys(highSchoolId) : apCourseKeys(record.courses);
  const offering = schoolOffering({ school: hs.school, detail: hs.detail, studentMarks: opts.studentMarks ?? null }, pooled);
  const cite = offering.field ? citeHsView(offering.field as HsFieldPath, hs) : null;
  return {
    offering,
    view: { hsId: hs.school.id, hsName: hs.school.name, apCount: offering.apCount, apKeys: offering.apKeys, ib: offering.ib, dual: offering.dual, source: offering.source, lines: offeringLines(offering), cite },
  };
}

/** The reading for a list against a school, with its sentences and the school's offering. */
export async function rigorViewFor(input: {
  courses: readonly CourseEntry[];
  coreAtTopLevel: CoreAtTopLevel;
  highSchoolId: string | null;
  grade?: number | null;
  /** AP catalog keys the student marked as offered at their school (profile `schoolOffers`). */
  studentMarks?: readonly string[] | null;
}): Promise<RigorView> {
  const { offering, view } = await offeringFor(input.highSchoolId, { studentMarks: input.studentMarks ?? null });
  const result = rigorReading({ courses: input.courses, coreAtTopLevel: input.coreAtTopLevel, grade: input.grade ?? null }, offering, { linked: input.highSchoolId !== null });
  return { reading: result.reading, sentences: sentencesFrom(result.notes), counts: result.counts, offering: view };
}
