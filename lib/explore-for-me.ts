import "server-only";
/**
 * Explore's "For you" levels (specs/planner/record/explore-levels.md): keep the colleges whose level for the plan's
 * student is one the viewer picked (`forMe=reach,high_reach`, lib/params.ts parseForMe). Server only: it runs Quad's
 * estimate, and only the level key of each kept college leaves it (`levels`), never a closeness, a note, or any other
 * estimate field (specs/chances/README.md "Quad's estimate is proprietary").
 *
 *   const viewer = await resolveForMeViewer();           // only when `forMe` is in the URL
 *   const { schools, levels, capped } = await forMeFilter(filtered, forMe, viewer);
 *
 * The person is the plan's: the signed-in student, or for a guardian the last child viewed on /plan (the `plan_child`
 * cookie), else the first child on the roster, the same rule /plan opens on (lib/planner/plan-frame.ts
 * resolveSelectedChild). The estimate reads the plan's hooks: each list row's connections and demonstrated interest
 * (lib/planner/hooks.ts), and the record's connections to colleges not on the list.
 */
import { cookies } from "next/headers";
import { authConfigured, getUser } from "@/lib/auth";
import { planBundle } from "@/lib/bundles";
import { estimateContext, estimateMany } from "@/lib/chances/estimate";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import { gradeNow } from "@/lib/chances/courses";
import type { CollegeHooks, EstimateStudent, StandingLevel } from "@/lib/chances/types";
import { hasNumbers } from "@/lib/chances/what-went-in";
import { satMid } from "@/lib/metrics";
import { actToSat } from "@/lib/planner/concordance";
import { hooksFromPlan, type HooksItem } from "@/lib/planner/hooks";
import { planViewer } from "@/lib/planner/load";
import { resolveSelectedChild } from "@/lib/planner/plan-frame";
import { recordHref } from "@/lib/planner/record";
import { effectiveGradYear, type StudentProfileData } from "@/lib/student-profile";
import { profileFor } from "@/lib/student-profile-store";
import type { School } from "@/lib/types";

/**
 * The most colleges one request estimates, or null for no cap (explore-levels.md: "if `estimateMany` over 1,900 runs
 * under 150 ms, drop the cap"). Measured 2026-10-16 over all 1,893 colleges, a fresh context per run as a request
 * makes: 73–87 ms for a student with a GPA and an SAT, 123–144 ms with eight AP courses on the record (the first run
 * in a fresh process, before the JIT warms, 162–187 ms). Under 150 ms, so no cap. The capped path stays (pass `cap`)
 * so turning it back on is this one line.
 */
export const FOR_ME_CAP: number | null = null;
/** The cap the spec names, for when FOR_ME_CAP is turned back on. */
export const SPEC_CAP = 600;

/** Who the levels are for, resolved only when `forMe` is in the URL. */
export type ForMeViewer =
  /** Signed out (or sign-in isn't configured here): the group shows its sign-in line. */
  | { kind: "signed-out" }
  /** Signed in, but there's no student to read (a guardian with nobody on the roster, say). */
  | { kind: "no-student" }
  /** A student, but no grades or test yet: the group links the record. `person` is the guardian's child, else null. */
  | { kind: "no-numbers"; person: string | null }
  | {
      kind: "ready";
      person: string | null;
      student: EstimateStudent;
      extra: { coreAtTopLevel: StudentProfileData["academics"]["coreAtTopLevel"] | null; grade: number | null };
      hooks: Record<string, CollegeHooks>;
    };

export type ForMeStatus = "signed-out" | "no-student" | "no-numbers" | "applied";

export interface ForMeResult {
  /** The colleges kept, in the order they came in (the viewer's sort). */
  schools: School[];
  /** Each kept college's level, by unit id: a level key, nothing else from the estimate. */
  levels: Record<string, StandingLevel>;
  /** True when more than the cap survived the other filters and only the nearest were estimated. */
  capped: boolean;
  /** The cap that applied, or null when none did. */
  cap: number | null;
  /** What the filter group shows: the chips (`applied`), or the line for a viewer it can't apply to. */
  status: ForMeStatus;
  /** The record's link for `no-numbers` (the plan's person's record), else null. */
  recordHref: string | null;
}

const PLAN_CHILD_COOKIE = "plan_child";

/** The plan's person for the signed-in viewer, their profile, and the hooks their list carries. */
export async function resolveForMeViewer(): Promise<ForMeViewer> {
  if (!authConfigured()) return { kind: "signed-out" };
  const user = await getUser();
  if (!user) return { kind: "signed-out" };
  const viewer = await planViewer();
  if (viewer.kind === "none") return { kind: "no-student" };
  let studentId: string;
  let person: string | null;
  if (viewer.kind === "self") {
    studentId = viewer.student.id;
    person = null;
  } else {
    const lastViewed = (await cookies()).get(PLAN_CHILD_COOKIE)?.value ?? null;
    const picked = resolveSelectedChild({ forParam: null, children: viewer.children.map((c) => ({ studentId: c.studentId })), lastViewed });
    if (!picked) return { kind: "no-student" };
    studentId = picked;
    person = picked;
  }
  const [profile, bundle] = await Promise.all([profileFor(studentId), planBundle(studentId).catch(() => null)]);
  if (!profile) return { kind: "no-student" };
  const student = estimateInputFromProfile(profile.data, "", null).student;
  if (!hasNumbers(student)) return { kind: "no-numbers", person };
  const gradYear = effectiveGradYear(profile.data.basics, profile.student.grad_year);
  const today = new Date().toISOString().slice(0, 10);
  return {
    kind: "ready",
    person,
    student,
    extra: { coreAtTopLevel: profile.data.academics.coreAtTopLevel ?? null, grade: gradeNow(gradYear, today) },
    hooks: hooksFor(profile.data, bundle?.list ? bundle.items ?? [] : [], bundle?.list ? bundle.visits ?? [] : []),
  };
}

/** The list rows' hooks, plus a connection on a college not on the list (it still changes that college's level). */
export function hooksFor(profile: StudentProfileData | null, items: readonly HooksItem[], visits: readonly { item_id: string }[]): Record<string, CollegeHooks> {
  const onList = new Set(items.map((i) => i.unit_id));
  const extra: HooksItem[] = (profile?.academics.connections ?? [])
    .filter((c) => !onList.has(c.unitId))
    .map((c) => ({ id: `connection:${c.unitId}`, unit_id: c.unitId, visited_on: null, info_requested_on: null }));
  return hooksFromPlan([...items, ...extra], visits, profile);
}

/** The student's score as an SAT total (an ACT concorded), or null without one. */
export function studentSat(student: Pick<EstimateStudent, "test">): number | null {
  if (!student.test) return null;
  return student.test.kind === "sat" ? student.test.score : actToSat(student.test.score);
}

/**
 * The `cap` colleges nearest the student's numbers (explore-levels.md): by the distance from the college's SAT
 * midpoint to the student's score, then by admit rate, lowest first; a college without an SAT midpoint (or a student
 * without a score) sorts after every one with a distance.
 */
export function closestFirst(schools: readonly School[], sat: number | null, cap: number): School[] {
  const dist = (s: School) => {
    const mid = satMid(s);
    return sat === null || mid === null ? Infinity : Math.abs(mid - sat);
  };
  const rate = (s: School) => s.admissions.acceptance_rate ?? Infinity;
  return [...schools].sort((a, b) => dist(a) - dist(b) || rate(a) - rate(b) || a.unit_id.localeCompare(b.unit_id)).slice(0, cap);
}

/**
 * Keep the colleges at a picked level. A viewer it can't apply to gets the list unchanged and the status that picks
 * the group's line. Runs the estimate once, over what survived the other filters (or the `cap` nearest of them).
 */
export async function forMeFilter(schools: School[], wanted: readonly StandingLevel[], viewer: ForMeViewer, opts: { cap?: number | null } = {}): Promise<ForMeResult> {
  if (viewer.kind !== "ready") {
    const href = viewer.kind === "no-numbers" ? recordHref({ person: viewer.person }) : viewer.kind === "no-student" ? recordHref({ person: null }) : null;
    return { schools, levels: {}, capped: false, cap: null, status: viewer.kind, recordHref: href };
  }
  const cap = opts.cap === undefined ? FOR_ME_CAP : opts.cap;
  const capped = cap !== null && schools.length > cap;
  const candidates = capped ? closestFirst(schools, studentSat(viewer.student), cap) : schools;
  const ctx = await estimateContext(viewer.student, viewer.extra);
  const results = estimateMany(
    viewer.student,
    candidates.map((s) => s.unit_id),
    ctx,
    viewer.hooks,
  );
  const want = new Set(wanted);
  const levels: Record<string, StandingLevel> = {};
  for (const s of candidates) {
    const group = results[s.unit_id]?.group ?? null;
    if (group && want.has(group)) levels[s.unit_id] = group;
  }
  return { schools: schools.filter((s) => Object.hasOwn(levels, s.unit_id)), levels, capped, cap: capped ? cap : null, status: "applied", recordHref: null };
}

/** The line above the results when the cap applied (explore-levels.md). */
export function forMeCappedLine(cap: number): string {
  return `Showing levels for the ${cap.toLocaleString("en-US")} colleges closest to your numbers; narrow the filters to see more.`;
}
