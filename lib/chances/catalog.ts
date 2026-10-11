/**
 * The AP and IB course catalogs (specs/chances/rigor-in-context.md "Entering them", course-plan.md "Data"):
 * data/reference/ap-courses.json and ib-courses.json. Names, subjects, and pages are the College Board's and the IB's;
 * `core`, `grades`, `prereqs`, `next`, `majors`, and `aliases` are editorial (each file says so). Checked by
 * scripts/check-course-catalog.mts in `npm run verify`. Pure and client-safe: the course picker imports it.
 */
import apFile from "../../data/reference/ap-courses.json" with { type: "json" };
import ibFile from "../../data/reference/ib-courses.json" with { type: "json" };
import { isMajorFamily } from "../majors.ts";
import type { CourseKind, CourseSubject } from "./types.ts";

export interface CatalogCourse {
  key: string;
  name: string;
  subject: CourseSubject;
  /** Counts toward a core subject (English, math, science, history and social science, world language). Editorial. */
  core: boolean;
  /** Usual grade levels. Editorial. */
  grades: number[];
  /** Usually needed first: catalog keys, or "level:Algebra II"-style course levels a non-AP course meets. Editorial. */
  prereqs: string[];
  /** Usual next courses (catalog keys). Editorial. */
  next: string[];
  /** Two-digit CIP families (lib/majors.ts) the course relates to. Editorial. */
  majors: string[];
  /** The official course page. */
  url: string;
  /** True when the name and page were seen on the publisher's own site; false marks a page to recheck. */
  confirmed: boolean;
  /** How school profiles commonly print the course ("Calculus AB"). Editorial. */
  aliases?: string[];
}

export interface IbCatalogCourse extends CatalogCourse {
  level: "hl" | "sl";
}

export interface CatalogFile<C extends CatalogCourse = CatalogCourse> {
  cycle: string;
  source: { publisher: string; url: string; retrieved: string; note?: string };
  editorial: string;
  courses: C[];
}

export const AP_CATALOG = apFile as CatalogFile;
export const IB_CATALOG = ibFile as CatalogFile<IbCatalogCourse>;

const byKey = new Map<string, CatalogCourse | IbCatalogCourse>([...AP_CATALOG.courses, ...IB_CATALOG.courses].map((c) => [c.key, c]));

export const COURSE_SUBJECTS: readonly CourseSubject[] = ["english", "math", "science", "history", "language", "cs", "arts", "other"];
/** The five subjects the counselor's "most demanding" question asks about (rigor-in-context.md "The core-subject question"). */
export const CORE_SUBJECTS: readonly CourseSubject[] = ["english", "math", "science", "history", "language"];

/** Every AP course (the picker's full list). */
export function apCourses(): readonly CatalogCourse[] {
  return AP_CATALOG.courses;
}

/** Every IB course, one entry per subject and level. */
export function ibCourses(): readonly IbCatalogCourse[] {
  return IB_CATALOG.courses;
}

/** The catalog entry for a key, AP or IB; null for an unknown key. */
export function catalogCourse(key: string): CatalogCourse | IbCatalogCourse | null {
  return byKey.get(key) ?? null;
}

/** Whether a key belongs to the catalog a course kind reads: AP keys for "ap", IB keys of that level for "ib_hl"/"ib_sl". */
export function isCatalogKeyFor(kind: CourseKind, key: string): boolean {
  const c = byKey.get(key);
  if (!c) return false;
  if (kind === "ap") return key.startsWith("ap_");
  if (kind === "ib_hl" || kind === "ib_sl") return "level" in c && c.level === (kind === "ib_hl" ? "hl" : "sl");
  return false;
}

/** A course name as compared: lowercase, "&" as "and", no "AP"/"IB" prefix, punctuation and extra spaces removed. */
export function normalizeCourseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^\s*(ap|ib|advanced placement)\s+/, "")
    .replace(/\b(sl|hl)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const AP_NAMES = new Map<string, string>();
for (const c of AP_CATALOG.courses) {
  for (const n of [c.name, ...(c.aliases ?? [])]) {
    const k = normalizeCourseName(n);
    if (!AP_NAMES.has(k)) AP_NAMES.set(k, c.key);
  }
}

/**
 * The catalog keys an AP course name printed on a school profile stands for: one key, two for a combined line
 * ("Physics 1 & 2"), or none when it isn't recognized. Never guesses beyond the catalog's names and aliases.
 */
export function apKeysForName(printed: string): string[] {
  const n = normalizeCourseName(printed);
  const exact = AP_NAMES.get(n);
  if (exact) return [exact];
  // "Physics 1 and 2": a combined line names two courses.
  const both = /^(.*?)\s*(\d)\s+and\s+(\d)$/.exec(n);
  if (both) {
    const keys = [`${both[1]} ${both[2]}`, `${both[1]} ${both[3]}`].map((x) => AP_NAMES.get(x)).filter((k): k is string => !!k);
    if (keys.length === 2) return keys;
  }
  // A parenthetical variant ("2D Art and Design (Photo)") is the course without it.
  const bare = normalizeCourseName(printed.replace(/\([^)]*\)/g, ""));
  const k = bare !== n ? AP_NAMES.get(bare) : undefined;
  return k ? [k] : [];
}

/* ------------------------------------------------------------------ */
/* Validation (scripts/check-course-catalog.mts, `npm run verify`)     */
/* ------------------------------------------------------------------ */

const KEY_RE = /^(ap|ib)_[a-z0-9_]+$/;
const LEVEL_RE = /^level:[A-Z][A-Za-z0-9 .'-]+$/;

function isHttpsUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Problems with one catalog file, one line each (empty means sound): a cycle and source; every course with a unique key
 * of the file's prefix, a name, a known subject, a boolean core flag, grades within 9–12, prereqs that are catalog keys
 * (of either file) or "level:…" strings, next keys that resolve, valid major families, an https page, and a confirmed
 * flag; IB courses with a level matching the key's suffix. `otherKeys` are keys of the other file (cross-references).
 */
export function validateCatalog(file: CatalogFile, prefix: "ap" | "ib", otherKeys: ReadonlySet<string> = new Set()): string[] {
  const name = `${prefix}-courses`;
  if (!file || !Array.isArray(file.courses)) return [`${name}: "courses" must be an array`];
  const errors: string[] = [];
  if (typeof file.cycle !== "string" || !/^\d{4}-\d{2}$/.test(file.cycle)) errors.push(`${name}: cycle must be "YYYY-YY"`);
  if (!file.source || !isHttpsUrl(file.source.url) || !file.source.publisher) errors.push(`${name}: source needs a publisher and an https url`);
  if (typeof file.editorial !== "string" || !file.editorial.trim()) errors.push(`${name}: "editorial" must say which fields are editorial`);
  const keys = new Set<string>();
  for (const c of file.courses) if (c && typeof c.key === "string") keys.add(c.key);
  const seen = new Set<string>();
  file.courses.forEach((c, i) => {
    const where = `${name}[${i}] ${c && typeof c.key === "string" ? c.key : "(no key)"}`;
    if (!c || typeof c !== "object") {
      errors.push(`${name}[${i}]: not an object`);
      return;
    }
    if (typeof c.key !== "string" || !KEY_RE.test(c.key) || !c.key.startsWith(`${prefix}_`)) errors.push(`${where}: key must be "${prefix}_" + lowercase words`);
    else if (seen.has(c.key)) errors.push(`${where}: duplicate key`);
    else seen.add(c.key);
    if (typeof c.name !== "string" || !c.name.trim()) errors.push(`${where}: name is required`);
    if (!COURSE_SUBJECTS.includes(c.subject)) errors.push(`${where}: subject ${JSON.stringify(c.subject)} isn't one of ${COURSE_SUBJECTS.join(", ")}`);
    if (typeof c.core !== "boolean") errors.push(`${where}: core must be true or false`);
    if (!Array.isArray(c.grades) || c.grades.length === 0 || c.grades.some((g) => !Number.isInteger(g) || g < 9 || g > 12)) errors.push(`${where}: grades must be a non-empty list of 9–12`);
    if (!Array.isArray(c.prereqs)) errors.push(`${where}: prereqs must be a list`);
    else for (const p of c.prereqs) if (!(keys.has(p) || otherKeys.has(p) || LEVEL_RE.test(p))) errors.push(`${where}: prereq "${p}" is neither a catalog key nor "level:…"`);
    if (!Array.isArray(c.next)) errors.push(`${where}: next must be a list`);
    else
      for (const n of c.next) {
        if (!(keys.has(n) || otherKeys.has(n))) errors.push(`${where}: next "${n}" isn't a catalog key`);
        if (n === c.key) errors.push(`${where}: next names the course itself`);
      }
    if (!Array.isArray(c.majors)) errors.push(`${where}: majors must be a list`);
    else for (const m of c.majors) if (typeof m !== "string" || !isMajorFamily(m)) errors.push(`${where}: major "${m}" isn't a lib/majors.ts family`);
    if (!isHttpsUrl(c.url)) errors.push(`${where}: url must be an https page`);
    if (typeof c.confirmed !== "boolean") errors.push(`${where}: confirmed must be true or false`);
    if (c.aliases !== undefined && (!Array.isArray(c.aliases) || c.aliases.some((a) => typeof a !== "string" || !a.trim()))) errors.push(`${where}: aliases must be non-empty strings`);
    if (prefix === "ib") {
      const level = (c as IbCatalogCourse).level;
      if (level !== "hl" && level !== "sl") errors.push(`${where}: level must be "hl" or "sl"`);
      else if (typeof c.key === "string" && !c.key.endsWith(`_${level}`)) errors.push(`${where}: key must end in "_${level}"`);
    }
  });
  return errors;
}

/** Both catalogs, cross-checked (keys never shared between them). */
export function validateCatalogs(ap: CatalogFile, ib: CatalogFile): string[] {
  const apKeys = new Set((ap?.courses ?? []).map((c) => c?.key).filter((k): k is string => typeof k === "string"));
  const ibKeys = new Set((ib?.courses ?? []).map((c) => c?.key).filter((k): k is string => typeof k === "string"));
  return [...validateCatalog(ap, "ap", ibKeys), ...validateCatalog(ib, "ib", apKeys)];
}
