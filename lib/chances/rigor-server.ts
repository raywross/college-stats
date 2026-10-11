import "server-only";
/**
 * Builds what the pages send down for the rigor reading (specs/chances/rigor-in-context.md "Where it shows"): the
 * student's high school and its offering (lib/chances/offering.ts over the high school record), and the reading with
 * its sentences. Server only: it imports the rules. Called by the Plan loader, by the Server Actions in rigor-store.ts
 * (signed-out visitors send their browser-kept list), and by the high school page's line.
 */
import { getHighSchool } from "@/lib/high-schools";
import { citeHsView, type HsFieldPath } from "@/lib/hs-fields";
import type { CoreAtTopLevel } from "@/lib/student-profile";
import { schoolOffering } from "./offering";
import { rigorReading } from "./rigor";
import { offeringLines, sentencesFrom, type OfferingView, type RigorView } from "./rigor-view";
import type { CourseEntry, SchoolOffering } from "./types";

const NOTHING: SchoolOffering = { apCount: null, apKeys: null, ib: null, dual: null, source: null, field: null };

/** The student's school and what it offers; nothing (and a null view) without a school id or a record for it. */
export async function offeringFor(highSchoolId: string | null): Promise<{ offering: SchoolOffering; view: OfferingView | null }> {
  if (!highSchoolId) return { offering: NOTHING, view: null };
  const hs = await getHighSchool(highSchoolId).catch(() => null);
  if (!hs) return { offering: NOTHING, view: null };
  const offering = schoolOffering({ school: hs.school, detail: hs.detail });
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
}): Promise<RigorView> {
  const { offering, view } = await offeringFor(input.highSchoolId);
  const result = rigorReading({ courses: input.courses, coreAtTopLevel: input.coreAtTopLevel, grade: input.grade ?? null }, offering, { linked: input.highSchoolId !== null });
  return { reading: result.reading, sentences: sentencesFrom(result.notes), counts: result.counts, offering: view };
}
