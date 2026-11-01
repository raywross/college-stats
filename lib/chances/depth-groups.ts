/**
 * The broad groups depth themes read (specs/chances/method/standing.md "Revision 3", rule 2):
 * data/reference/depth-groups.json, editorial and reviewed, with the published pages it was written from. A course
 * belongs to its subject family's group unless the file names it (AP Macroeconomics, AP Psychology, AP Statistics…
 * sit in two); an activity belongs to its family's groups (business in both STEM and the social sciences); athletics,
 * service, and faith sit outside every group. Also decides whether an activity is connected to the student's intended
 * major (rule 6: computed, never asked). Pure and client-safe; checked by scripts/check-depth-groups.mts in
 * `npm run verify`.
 */
import file from "../../.data/snapshot/reference/depth-groups.json" with { type: "json" };
import { catalogCourse, COURSE_SUBJECTS } from "./catalog.ts";
import { expectationsFor } from "./major-course-expectations.ts";
import type { ActivityFamily, CourseEntry, CourseSubject } from "./types.ts";

export type DepthGroup = "stem" | "humanities" | "arts";
export const DEPTH_GROUP_KEYS: readonly DepthGroup[] = ["stem", "humanities", "arts"];

export interface DepthGroupsFile {
  retrieved: string;
  editorial: string;
  groups: { key: string; name: string; words: string }[];
  course_families: Record<string, string[]>;
  courses: { key: string; groups: string[]; why: string }[];
  activity_families: Record<string, string[]>;
  outside: string[];
  sources: { label: string; url: string }[];
}

export const DEPTH_GROUPS = file as DepthGroupsFile;

/** Every ActivityFamily, so the check can insist each one is placed (the Record makes the type checker list them all). */
const FAMILY_SET: Record<ActivityFamily, true> = {
  english: true, math: true, science: true, history: true, language: true, cs: true, arts: true,
  business: true, health: true, engineering: true, service: true, athletics: true, leadership: true, media: true, faith: true, other: true,
};
export const ACTIVITY_FAMILY_KEYS = Object.keys(FAMILY_SET) as ActivityFamily[];

const isGroup = (g: string): g is DepthGroup => (DEPTH_GROUP_KEYS as readonly string[]).includes(g);
const COURSE_OVERRIDES = new Map(DEPTH_GROUPS.courses.map((c) => [c.key, c.groups.filter(isGroup)]));

/** The groups a course belongs to: the file's entry for its catalog key, else its subject family's. */
export function courseGroups(c: Pick<CourseEntry, "key" | "subject">, source: DepthGroupsFile = DEPTH_GROUPS): DepthGroup[] {
  const own = c.key ? (source === DEPTH_GROUPS ? COURSE_OVERRIDES.get(c.key) : source.courses.find((x) => x.key === c.key)?.groups.filter(isGroup)) : undefined;
  if (own) return own;
  return (source.course_families[c.subject] ?? []).filter(isGroup);
}

/** The groups a course subject family belongs to (no course-level entries). */
export function subjectGroups(subject: CourseSubject, source: DepthGroupsFile = DEPTH_GROUPS): DepthGroup[] {
  return (source.course_families[subject] ?? []).filter(isGroup);
}

/**
 * The groups an activity family belongs to: [] for one that sits outside every course group (athletics, service,
 * faith), and null when nothing is known (no family, or "other").
 */
export function activityGroups(family: ActivityFamily | null | undefined, source: DepthGroupsFile = DEPTH_GROUPS): DepthGroup[] | null {
  if (!family || family === "other") return null;
  const g = source.activity_families[family];
  return g ? g.filter(isGroup) : null;
}

/** The groups the intended major's expected subjects belong to (major-course-expectations.json), or null when none are written. */
export function majorGroups(major: string | null | undefined): DepthGroup[] | null {
  const exp = expectationsFor(major);
  if (!exp || exp.expects.length === 0) return null;
  return [...new Set(exp.expects.flatMap((e) => subjectGroups(e.subject)))];
}

/**
 * Whether an activity is connected to the student's intended major (rule 6, owner 2026-10-12: computed, not asked;
 * the stored `relatedToMajor` is ignored). With no intended major, or a major or an activity whose group isn't known,
 * it is assumed related; with both known, related unless they share no group. An activity outside every course group
 * (athletics, service, faith) is never connected to a major.
 */
export function relatedToMajor(family: ActivityFamily | null | undefined, majors: readonly string[]): boolean {
  if (majors.length === 0) return true;
  const mine = activityGroups(family);
  if (mine === null) return true;
  const theirs = majorGroups(majors[0]);
  if (theirs === null) return true;
  return mine.some((g) => theirs.includes(g));
}

/** A group in the words a theme sentence uses ("STEM", "humanities and social sciences", "arts"). */
export function groupWords(g: DepthGroup): string {
  return DEPTH_GROUPS.groups.find((x) => x.key === g)?.words ?? g;
}

function isHttps(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Problems with the file, one line each (empty means sound). */
export function validateDepthGroups(input: DepthGroupsFile): string[] {
  const out: string[] = [];
  if (!input || typeof input !== "object") return ["the file must be an object"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.retrieved ?? "")) out.push('"retrieved" must be an ISO date');
  if (!input.editorial || input.editorial.length < 40) out.push('"editorial" must say what the file is');
  const keys = (input.groups ?? []).map((g) => g.key);
  if (keys.join(",") !== DEPTH_GROUP_KEYS.join(",")) out.push(`"groups" must be exactly ${DEPTH_GROUP_KEYS.join(", ")} in that order`);
  for (const g of input.groups ?? []) if (!g.name || !g.words) out.push(`group ${g.key}: needs a name and words`);
  const known = (gs: unknown, where: string) => {
    if (!Array.isArray(gs)) return out.push(`${where}: groups must be a list`);
    for (const g of gs) if (!isGroup(g)) out.push(`${where}: "${g}" isn't a group`);
    if (new Set(gs).size !== gs.length) out.push(`${where}: a group is listed twice`);
  };
  for (const s of COURSE_SUBJECTS) {
    if (!(s in (input.course_families ?? {}))) out.push(`course_families: subject "${s}" isn't placed`);
    else known(input.course_families[s], `course_families.${s}`);
  }
  for (const k of Object.keys(input.course_families ?? {})) if (!(COURSE_SUBJECTS as readonly string[]).includes(k)) out.push(`course_families: "${k}" isn't a course subject`);
  // Every subject family but "other" belongs to a group (a course with a subject always has somewhere to go).
  for (const s of COURSE_SUBJECTS) if (s !== "other" && (input.course_families?.[s] ?? []).length === 0) out.push(`course_families.${s}: needs a group`);
  const seen = new Set<string>();
  for (const c of input.courses ?? []) {
    if (seen.has(c.key)) out.push(`courses: ${c.key} is listed twice`);
    seen.add(c.key);
    if (!catalogCourse(c.key)) out.push(`courses: ${c.key} isn't in the AP or IB catalog`);
    known(c.groups, `courses.${c.key}`);
    if ((c.groups ?? []).length === 0) out.push(`courses.${c.key}: needs a group`);
    if (!c.why || c.why.length < 10) out.push(`courses.${c.key}: needs a reason ("why")`);
  }
  for (const f of ACTIVITY_FAMILY_KEYS) {
    if (!(f in (input.activity_families ?? {}))) out.push(`activity_families: family "${f}" isn't placed`);
    else known(input.activity_families[f], `activity_families.${f}`);
  }
  for (const k of Object.keys(input.activity_families ?? {})) if (!(ACTIVITY_FAMILY_KEYS as string[]).includes(k)) out.push(`activity_families: "${k}" isn't an activity family`);
  // Every course family's activity counterpart sits in the same groups (an art club lines up with art courses).
  for (const s of COURSE_SUBJECTS) {
    if (s === "other" || !(s in (input.activity_families ?? {}))) continue;
    const a = [...(input.activity_families[s] ?? [])].sort().join(",");
    const c = [...(input.course_families?.[s] ?? [])].sort().join(",");
    if (a !== c) out.push(`activity_families.${s}: must match course_families.${s}`);
  }
  for (const f of input.outside ?? []) {
    if (!(ACTIVITY_FAMILY_KEYS as string[]).includes(f)) out.push(`outside: "${f}" isn't an activity family`);
    else if ((input.activity_families?.[f] ?? []).length > 0) out.push(`outside: ${f} sits outside every group, so its activity_families entry must be empty`);
  }
  for (const f of ACTIVITY_FAMILY_KEYS) if (f !== "other" && (input.activity_families?.[f] ?? []).length === 0 && !(input.outside ?? []).includes(f)) out.push(`activity_families.${f}: has no group and isn't listed as outside`);
  if (!Array.isArray(input.sources) || input.sources.length === 0) out.push('"sources" must list the pages the groups were written from');
  for (const s of input.sources ?? []) if (!s.label || !isHttps(s.url)) out.push(`sources: "${s.label ?? "?"}" needs a label and an https url`);
  return out;
}
