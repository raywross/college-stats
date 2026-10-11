"use server";
/**
 * The rigor reading for client components on otherwise-static pages (specs/chances/rigor-in-context.md "Where it
 * shows"): the college profile and the high school page are static (tests/accounts.test.mts forbids reading cookies
 * while rendering a public page), so the course list reaches the reading through Server Actions called after mount,
 * the way ScoreChecker's prefill does. The reading is computed here, on the server, and only its sentences come
 * back; the rules never reach the browser.
 *
 * - `rigorForLocal`: a visitor's browser-kept list (the signed-out profile) placed against a school.
 * - `myCourseState`: the signed-in student's own list, high school, and reading (never a guardian's view of a student).
 * - `pickerOffering`: a school's offering for the course picker's chips.
 * - `myCoursesOnHighSchool`: the high school page's "You've taken or planned 6 of these."
 */
import { gradeNow } from "./courses";
import { noteText } from "./notes";
import { offeringFor, rigorViewFor } from "./rigor-server";
import type { OfferingView, RigorView } from "./rigor-view";
import type { CourseEntry } from "./types";
import { myOwnProfile } from "@/lib/student-profile-store";
import { getUser } from "@/lib/auth";
import { sanitizeProfile, type CoreAtTopLevel } from "@/lib/student-profile";

const today = () => new Date().toISOString().slice(0, 10);

/** A list from the browser, sanitized like any profile input. */
function fromBrowser(input: unknown) {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const p = sanitizeProfile({
    basics: { highSchoolId: raw.highSchoolId, gradYear: raw.gradYear },
    academics: { courses: raw.courses, coreAtTopLevel: raw.coreAtTopLevel, courseRigorCount: null },
  });
  return { courses: p.academics.courses, core: p.academics.coreAtTopLevel, highSchoolId: p.basics.highSchoolId, gradYear: p.basics.gradYear };
}

/** A signed-out visitor's list against their high school. Null when the list is empty (nothing to read). */
export async function rigorForLocal(input: unknown): Promise<RigorView | null> {
  const s = fromBrowser(input);
  if (s.courses.length === 0 && !hasCore(s.core)) return null;
  return rigorViewFor({ courses: s.courses, coreAtTopLevel: s.core, highSchoolId: s.highSchoolId, grade: gradeNow(s.gradYear, today()) });
}

const hasCore = (c: CoreAtTopLevel) => Object.values(c).some((row) => Object.values(row).some((v) => v !== null));

export type MyCourseState =
  | { signedIn: false }
  | {
      signedIn: true;
      courses: CourseEntry[];
      coreAtTopLevel: CoreAtTopLevel;
      highSchoolId: string | null;
      majors: string[];
      view: RigorView | null;
    };

/** The signed-in student's own course list and reading; `{ signedIn: false }` for a visitor. */
export async function myCourseState(): Promise<MyCourseState> {
  const user = await getUser().catch(() => null);
  if (!user) return { signedIn: false };
  const profile = await myOwnProfile().catch(() => null);
  if (!profile) return { signedIn: true, courses: [], coreAtTopLevel: sanitizeProfile(null).academics.coreAtTopLevel, highSchoolId: null, majors: [], view: null };
  const { courses, coreAtTopLevel } = profile.academics;
  const hasAny = courses.length > 0 || hasCore(coreAtTopLevel);
  const view = hasAny ? await rigorViewFor({ courses, coreAtTopLevel, highSchoolId: profile.basics.highSchoolId, grade: gradeNow(profile.basics.gradYear, today()) }) : null;
  return { signedIn: true, courses, coreAtTopLevel, highSchoolId: profile.basics.highSchoolId, majors: profile.plans.intendedMajors, view };
}

/** A school's offering for the picker's chips; null without a record. */
export async function pickerOffering(highSchoolId: string): Promise<OfferingView | null> {
  if (typeof highSchoolId !== "string" || highSchoolId.length > 20) return null;
  return (await offeringFor(highSchoolId)).view;
}

/**
 * "You've taken or planned 6 of these." for the high school page, only when the page is the signed-in student's own
 * school and their list has AP courses the school offers (or, for a school with a count only, any AP courses).
 */
export async function myCoursesOnHighSchool(schoolId: string): Promise<{ sentence: string } | null> {
  const profile = await myOwnProfile().catch(() => null);
  if (!profile || profile.basics.highSchoolId !== schoolId) return null;
  const ap = profile.academics.courses.filter((c) => c.kind === "ap");
  if (ap.length === 0) return null;
  const { offering } = await offeringFor(schoolId);
  const taken = offering.apKeys ? ap.filter((c) => c.key !== null && offering.apKeys!.includes(c.key)).length : Math.min(ap.length, offering.apCount ?? ap.length);
  if (taken === 0) return null;
  return { sentence: noteText({ key: "rigor.on_hs_page", values: { taken } }) };
}
