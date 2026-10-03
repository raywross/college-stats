/**
 * CDS admissions profile (specs/data-expansion/cds-admissions.md): a college's CDS record
 * (data/cds-records/<unit_id>.json) → `school.reported.admission_profile` (C2 wait list, C7 factor weights, C10 class
 * rank, C11 GPA bands, C12 average GPA, C21 early decision, C22 early action), each stored leaf with its own lineage
 * record; the six-factor newest rule (`applyNewestFactors` / `restoreFederalFactors`, one line each in lib/newest.ts);
 * and the pure helpers the pages use (`edRate`, `waitListRate`, `gpaMiddleHalf`, `gpaPosition`, `sameDocumentRate`).
 *
 * Reads records only, never the web or a model: a value is used only when its item `passed` (lib/cds-records.ts),
 * plus the block checks below, which decide what the display may trust. The spec calls this module
 * `lib/admission-profile.ts`; it lives here with the other wave-4 modules (lib/cds/<slug>.ts).
 *
 * Pure: type-only imports plus lib/cds-records.ts and lib/cds-sections.ts (themselves pure), so Node tests and client
 * components (GpaChecker) can load it.
 */
import type { FieldPath } from "../fields";
import type {
  AdmissionFactor,
  C7Factor,
  FactorImportance,
  FactorUse,
  GpaBands,
  LineageRecord,
  MonthDayValue,
  ReportedAdmissionProfile,
  School,
} from "../types";
import { compareDocuments, editionFallYear, editionLabel, itemBoolean, itemMonthDay, itemNumber, itemShare, itemText, itemYear, lineageFromItem, passedItem } from "../cds-records.ts";
import { pct } from "../format.ts";
import { parseEdition, type CdsCode, type CollegeRecord, type DocumentRecord, type TemplateTable } from "../cds-sections.ts";

type Lineage = Partial<Record<FieldPath, LineageRecord>>;
type Profile = ReportedAdmissionProfile;

const P = "reported.admission_profile";
const path = (p: string) => `${P}.${p}` as FieldPath;

/** At most this many editions behind the college's newest CDS (a college that stops publishing GPA drops it). */
export const MAX_EDITIONS_BACK = 2;

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

/** C7 rows in template order, with the page's label and the template's group. */
export const C7_FACTORS: readonly { key: C7Factor; code: CdsCode; label: string; group: "academic" | "personal" }[] = [
  { key: "rigor", code: "C.701", label: "Rigor of high school record", group: "academic" },
  { key: "class_rank", code: "C.702", label: "Class rank", group: "academic" },
  { key: "gpa", code: "C.703", label: "Academic GPA", group: "academic" },
  { key: "test_scores", code: "C.704", label: "Test scores", group: "academic" },
  { key: "essay", code: "C.705", label: "Essay", group: "academic" },
  { key: "recommendations", code: "C.706", label: "Recommendations", group: "academic" },
  { key: "interview", code: "C.707", label: "Interview", group: "personal" },
  { key: "extracurriculars", code: "C.708", label: "Extracurricular activities", group: "personal" },
  { key: "talent", code: "C.709", label: "Talent or ability", group: "personal" },
  { key: "character", code: "C.710", label: "Character and personal qualities", group: "personal" },
  { key: "first_generation", code: "C.711", label: "First generation", group: "personal" },
  { key: "alumni_relation", code: "C.712", label: "Alumni relation (legacy)", group: "personal" },
  { key: "geographic_residence", code: "C.713", label: "Geographic residence", group: "personal" },
  { key: "state_residency", code: "C.714", label: "State residency", group: "personal" },
  { key: "religious", code: "C.715", label: "Religious affiliation", group: "personal" },
  { key: "volunteer_work", code: "C.716", label: "Volunteer work", group: "personal" },
  { key: "work_experience", code: "C.717", label: "Work experience", group: "personal" },
  { key: "interest", code: "C.718", label: "Level of interest", group: "personal" },
];

export const IMPORTANCE_LEVELS: readonly FactorImportance[] = ["very_important", "important", "considered", "not_considered"];
export const IMPORTANCE_LABELS: Record<FactorImportance, string> = {
  very_important: "Very important",
  important: "Important",
  considered: "Considered",
  not_considered: "Not considered",
};

/** The six C7 rows that ask IPEDS's yes/no question underneath (is it considered at all?), keyed to IPEDS's factor. */
export const SHARED_FACTORS: Readonly<Partial<Record<C7Factor, AdmissionFactor>>> = {
  gpa: "gpa",
  class_rank: "class_rank",
  recommendations: "recommendations",
  essay: "essay",
  alumni_relation: "legacy",
  work_experience: "work_experience",
};

/** C11 columns: nine band codes, top band (4.0) first, and the column's total. */
const GPA_COLUMNS = {
  with_test: { first: 1101, total: "C.1110" },
  without_test: { first: 1111, total: "C.1120" },
  all: { first: 1121, total: "C.1130" },
} as const;
type GpaColumn = keyof typeof GPA_COLUMNS;
const bandCodes = (col: GpaColumn) => Array.from({ length: 9 }, (_, i) => `C.${GPA_COLUMNS[col].first + i}`);

/** The nine C11 bands as the template names them, top first, with the GPAs each holds. */
export const GPA_BANDS: readonly { label: string; low: number; high: number }[] = [
  { label: "4.0", low: 4.0, high: 4.0 },
  { label: "3.75–3.99", low: 3.75, high: 3.99 },
  { label: "3.50–3.74", low: 3.5, high: 3.74 },
  { label: "3.25–3.49", low: 3.25, high: 3.49 },
  { label: "3.00–3.24", low: 3.0, high: 3.24 },
  { label: "2.50–2.99", low: 2.5, high: 2.99 },
  { label: "2.0–2.49", low: 2.0, high: 2.49 },
  { label: "1.0–1.99", low: 1.0, high: 1.99 },
  { label: "below 1.0", low: 0, high: 0.99 },
];

/* ------------------------------------------------------------------ */
/* Record → profile                                                    */
/* ------------------------------------------------------------------ */

/** What one block builder sees: the document, the template (for item years), and the lineage it adds to. */
interface Ctx {
  doc: DocumentRecord;
  table: TemplateTable;
  lineage: Lineage;
}

const yearOf = (c: Ctx, code: CdsCode) => itemYear(c.doc, c.table, code) ?? "";

/** Cite a stored leaf to the passed item it came from (`lineageFromItem` throws when it didn't pass). */
function cite(c: Ctx, leaf: string, code: CdsCode, method: "extracted" | "derived" = "extracted") {
  c.lineage[path(leaf)] = lineageFromItem(c.doc, code, { year: yearOf(c, code), method, path: path(leaf) });
}

/** A month/day pair's record: the month item's, with both cells' quotes (a date is two cells in the template). */
function citeDate(c: Ctx, leaf: string, monthCode: CdsCode, dayCode: CdsCode) {
  const rec = lineageFromItem(c.doc, monthCode, { year: yearOf(c, monthCode), path: path(leaf) });
  const day = passedItem(c.doc, dayCode)?.quote;
  if (day) rec.quote = clip(`${rec.quote}; ${day}`);
  c.lineage[path(leaf)] = rec;
}

const clip = (s: string, max = 160) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Each block from the newest document (within `MAX_EDITIONS_BACK`) where its builder returns one. */
function newestBlock<T>(college: CollegeRecord, table: TemplateTable, lineage: Lineage, build: (c: Ctx) => T | null): T | null {
  const docs = [...college.documents].sort(compareDocuments);
  const newest = editionFallYear(docs[0]?.edition);
  for (const doc of docs) {
    const fall = editionFallYear(doc.edition);
    if (newest !== null && fall !== null && newest - fall > MAX_EDITIONS_BACK) break;
    const c: Ctx = { doc, table, lineage: {} };
    const block = build(c);
    if (block !== null) {
      Object.assign(lineage, c.lineage);
      return block;
    }
  }
  return null;
}

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/** C11 + C12 from one edition. */
function gpaBlock(c: Ctx): Profile["gpa"] | null {
  const columns: Record<GpaColumn, GpaBands | null> = { with_test: null, without_test: null, all: null };
  const firstCode: Partial<Record<GpaColumn, CdsCode>> = {};
  for (const col of Object.keys(GPA_COLUMNS) as GpaColumn[]) {
    const codes = bandCodes(col);
    const values = codes.map((code) => itemShare(c.doc, code));
    // A column whose values are all 0 or blank is blank (its formula total reads 0), not 0%.
    if (values.every((v) => v === null || v === 0)) continue;
    const bands = values.map((v) => v ?? 0) as GpaBands;
    // Each column present sums to 100 ± 1 in its scale; a column that doesn't fails alone.
    if (!near(bands.reduce((a, b) => a + b, 0), 1)) continue;
    columns[col] = bands;
    firstCode[col] = codes[values.findIndex((v) => v !== null)];
  }
  // With all three columns, every "all" band lies between the other two (it's their mix), ± 1 point.
  const { with_test: w, without_test: wo, all } = columns;
  if (w && wo && all && all.some((v, i) => v < Math.min(w[i], wo[i]) - 0.01 || v > Math.max(w[i], wo[i]) + 0.01)) {
    columns.with_test = columns.without_test = columns.all = null;
  }
  const rawAvg = itemNumber(c.doc, "C.1201");
  // 0 < average ≤ 5.0; above that is a 100-point or other scale.
  const average = rawAvg !== null && rawAvg > 0 && rawAvg <= 5 ? rawAvg : null;
  const submitted = itemShare(c.doc, "C.1202");
  const anyColumn = columns.with_test || columns.without_test || columns.all;
  if (average === null && !anyColumn) return null;

  if (average !== null) {
    cite(c, "gpa.average", "C.1201");
    cite(c, "gpa.scale", "C.1201", "derived");
  }
  if (submitted !== null) cite(c, "gpa.submitted_share", "C.1202");
  for (const col of Object.keys(columns) as GpaColumn[]) if (columns[col]) cite(c, `gpa.bands.${col}`, firstCode[col]!);
  if (average === null) {
    // The scale is still stored; cite it to the breakdown it describes.
    const col = (Object.keys(columns) as GpaColumn[]).find((k) => columns[k])!;
    cite(c, "gpa.scale", firstCode[col]!, "derived");
  }
  return {
    average,
    // Above 4.0 counts extra points for honors and AP courses. The records carry no "weighted" note, so a value of
    // 4.0 or below is "not_stated" (it may still be weighted).
    scale: average !== null && average > 4 ? "weighted" : "not_stated",
    submitted_share: submitted,
    bands: { with_test: columns.with_test, without_test: columns.without_test, all: columns.all },
  };
}

/** C10, never without the share whose high school reported a rank. */
function classRankBlock(c: Ctx): Profile["class_rank"] | null {
  const get = (code: CdsCode) => itemShare(c.doc, code);
  const r = {
    top_tenth: get("C.1001"),
    top_quarter: get("C.1002"),
    top_half: get("C.1003"),
    bottom_half: get("C.1004"),
    bottom_quarter: get("C.1005"),
  };
  const share = get("C.1006");
  if (Object.values(r).every((v) => v === null)) return null;
  // Bands present but the share blank: can't be shown (it often describes a minority of the class).
  if (share === null || share === 0) return null;
  const le = (a: number | null, b: number | null) => a === null || b === null || a <= b + 0.001;
  if (!le(r.top_tenth, r.top_quarter) || !le(r.top_quarter, r.top_half) || !le(r.bottom_quarter, r.bottom_half)) return null;
  if (r.top_half !== null && r.bottom_half !== null && !near(r.top_half + r.bottom_half, 1)) return null;
  const codes: Record<keyof typeof r, CdsCode> = { top_tenth: "C.1001", top_quarter: "C.1002", top_half: "C.1003", bottom_half: "C.1004", bottom_quarter: "C.1005" };
  for (const k of Object.keys(r) as (keyof typeof r)[]) if (r[k] !== null) cite(c, `class_rank.${k}`, codes[k]);
  cite(c, "class_rank.submitted_share", "C.1006");
  return { ...r, submitted_share: share };
}

/** A C7 mark as one of the four levels: the template's words, or a fillable PDF's radio values (VI / I / C / NC). */
export function importanceOf(raw: string | null): FactorImportance | null {
  const t = raw?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (t === "very important" || t === "vi") return "very_important";
  if (t === "important" || t === "i") return "important";
  if (t === "considered" || t === "c") return "considered";
  if (t === "not considered" || t === "nc") return "not_considered";
  return null;
}

/** C7. A grid with fewer than 9 of 18 rows marked, or every mark in one column, is a misread: no block. */
function factorsBlock(c: Ctx): Profile["factors"] | null {
  const levels = C7_FACTORS.map((f) => ({ f, level: importanceOf(itemText(c.doc, f.code)) }));
  const marked = levels.filter((l) => l.level !== null);
  if (marked.length < 9) return null;
  if (new Set(marked.map((l) => l.level)).size === 1) return null;
  const out: Partial<Record<C7Factor, FactorImportance | null>> = {};
  for (const { f, level } of marked) {
    out[f.key] = level;
    cite(c, `factors.${f.key}`, f.code);
  }
  return out;
}

/** C2. All-zero counts beside a Yes policy are blank; the counts must nest and fit inside the same document's C1. */
function waitListBlock(c: Ctx): Profile["wait_list"] | null {
  const policy = itemBoolean(c.doc, "C.201");
  let offered = itemNumber(c.doc, "C.202");
  let accepted = itemNumber(c.doc, "C.203");
  let admitted = itemNumber(c.doc, "C.204");
  const counts = [offered, accepted, admitted];
  if (policy !== false && counts.every((v) => v === null || v === 0)) offered = accepted = admitted = null;
  if (policy === null && offered === null && accepted === null && admitted === null) return null;
  const le = (a: number | null, b: number | null) => a === null || b === null || a <= b;
  if (!le(admitted, accepted) || !le(accepted, offered) || !le(admitted, offered)) return null;
  if (!le(offered, itemNumber(c.doc, "C.116")) || !le(admitted, itemNumber(c.doc, "C.117"))) return null;
  if (policy === false && [offered, accepted, admitted].some((v) => v !== null && v > 0)) return null;
  if (policy !== null) cite(c, "wait_list.policy", "C.201");
  if (offered !== null) cite(c, "wait_list.offered", "C.202");
  if (accepted !== null) cite(c, "wait_list.accepted", "C.203");
  if (admitted !== null) cite(c, "wait_list.admitted", "C.204");
  return { policy, offered, accepted, admitted };
}

/** Months from August, so a cycle's dates (Nov 1 → Dec 15 → Jan 5 → Feb 1) order correctly across New Year. */
const cycleOrder = (d: MonthDayValue) => ((d.month - 8 + 12) % 12) * 32 + d.day;
const after = (a: MonthDayValue | null, b: MonthDayValue | null) => a === null || b === null || cycleOrder(a) > cycleOrder(b);

const C21_CODES: readonly CdsCode[] = Array.from({ length: 11 }, (_, i) => `C.${2101 + i}`);

/**
 * A C21 value from a workbook whose code table disagrees with its visible form (Cornell 2025–26: off by one row).
 * The reader keeps the visible form's value in `form` and fails the code cell (`form-vs-code`); then nothing from
 * the code table is trusted for C21 (its dates are the shifted ones too), and only the visible form's values are
 * candidates, cited to the form's cell with the template's wording.
 */
function formDistrusted(doc: DocumentRecord): boolean {
  return C21_CODES.some((code) => !!doc.items[code]?.form || !!doc.items[code]?.failures?.some((f) => f.check === "form-vs-code"));
}

function formRecord(c: Ctx, code: CdsCode, v: number | boolean, cell: string): LineageRecord {
  const shown = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  const question = c.table.byCode.get(code)?.question ?? code;
  const tail = ` | ${shown}`;
  const quote = question.length + tail.length <= 160 ? `${question}${tail}` : `${question.slice(0, 160 - tail.length - 1)}…${tail}`;
  return {
    source: "college-site",
    method: "extracted",
    year: yearOf(c, code),
    edition: editionLabel(c.doc.edition),
    url: c.doc.url,
    retrieved: c.doc.retrieved,
    quote,
    cell,
  };
}

/** C21. Counts nest inside the same document's C1; offered No (or blank) with counts or dates fails. */
function earlyDecisionBlock(c: Ctx): Profile["early_decision"] | null {
  const distrust = formDistrusted(c.doc);
  // Candidates for each value, best first: the visible form's (when the code table is off), else the passed code cell.
  const value = <T extends number | boolean>(code: CdsCode, kind: "number" | "boolean"): { v: T; rec: () => LineageRecord } | null => {
    const it = c.doc.items[code];
    if (distrust) {
      const f = it?.form;
      return f && typeof f.v === kind && f.cell ? { v: f.v as T, rec: () => formRecord(c, code, f.v as T, f.cell) } : null;
    }
    const v = kind === "number" ? itemNumber(c.doc, code) : itemBoolean(c.doc, code);
    return v === null ? null : { v: v as T, rec: () => lineageFromItem(c.doc, code, { year: yearOf(c, code), path: path(`early_decision.${code}`) }) };
  };
  const offered = value<boolean>("C.2101", "boolean");
  const applicants = value<number>("C.2110", "number");
  const admitted = value<number>("C.2111", "number");
  const date = (m: CdsCode, d: CdsCode) => (distrust ? null : itemMonthDay(c.doc, m, d));
  const first = { closing: date("C.2102", "C.2103"), notification: date("C.2104", "C.2105") };
  const other = { closing: date("C.2106", "C.2107"), notification: date("C.2108", "C.2109") };
  // Dates out of cycle order: the later date is dropped (null), the rest stand.
  if (!after(first.notification, first.closing)) first.notification = null;
  if (!after(other.closing, first.closing)) other.closing = other.notification = null;
  if (!after(other.notification, other.closing)) other.notification = null;
  const anyDate = [first.closing, first.notification, other.closing, other.notification].some((d) => d !== null);
  const hasCounts = applicants !== null || admitted !== null;
  if (!offered && !hasCounts && !anyDate) return null;
  if (offered?.v !== true && (hasCounts || anyDate)) return null;

  const le = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || a <= b;
  const ap = applicants?.v ?? null;
  const ad = admitted?.v ?? null;
  // ED admitted ≤ ED applications ≤ C1 applicants; ED admitted ≤ C1 admitted (catches Cornell's code table, whose
  // "admitted" cell holds its 10,057 applications against 6,077 C1 admits).
  const countsOk = le(ad, ap) && le(ap, itemNumber(c.doc, "C.116")) && le(ad, itemNumber(c.doc, "C.117"));

  const lin = c.lineage;
  lin[path("early_decision.offered")] = offered!.rec();
  const out: NonNullable<Profile["early_decision"]> = { offered: offered!.v, applicants: null, admitted: null };
  if (first.closing || first.notification) {
    out.first = first;
    if (first.closing) citeDate(c, "early_decision.first.closing", "C.2102", "C.2103");
    if (first.notification) citeDate(c, "early_decision.first.notification", "C.2104", "C.2105");
  }
  if (other.closing || other.notification) {
    out.other = other;
    if (other.closing) citeDate(c, "early_decision.other.closing", "C.2106", "C.2107");
    if (other.notification) citeDate(c, "early_decision.other.notification", "C.2108", "C.2109");
  }
  if (countsOk) {
    if (applicants) {
      out.applicants = applicants.v;
      lin[path("early_decision.applicants")] = applicants.rec();
    }
    if (admitted) {
      out.admitted = admitted.v;
      lin[path("early_decision.admitted")] = admitted.rec();
    }
  }
  return out;
}

/** C22. Offered No with dates, or restrictive Yes without an offered Yes, fails. */
function earlyActionBlock(c: Ctx): Profile["early_action"] | null {
  const offered = itemBoolean(c.doc, "C.2201");
  const restrictive = itemBoolean(c.doc, "C.2206");
  let closing = itemMonthDay(c.doc, "C.2202", "C.2203");
  let notification = itemMonthDay(c.doc, "C.2204", "C.2205");
  if (offered === null) return null;
  if (!offered && (closing || notification || restrictive === true)) return null;
  if (!after(notification, closing)) notification = null;
  if (!offered) closing = notification = null;
  cite(c, "early_action.offered", "C.2201");
  if (closing) citeDate(c, "early_action.closing", "C.2202", "C.2203");
  if (notification) citeDate(c, "early_action.notification", "C.2204", "C.2205");
  if (restrictive !== null && offered) cite(c, "early_action.restrictive", "C.2206");
  return { offered, closing, notification, restrictive: offered ? restrictive : null };
}

/**
 * A college's admissions profile from its CDS record: each block from the newest edition where it passed, with one
 * lineage record per stored leaf (year from the edition: the entering class for C2, C7, C10–C12, and C21 counts; the
 * edition for C21/C22 flags and dates). Null when no block has anything.
 */
export function buildAdmissionProfile(college: CollegeRecord, table: TemplateTable): { profile: Profile; lineage: Lineage } | null {
  const lineage: Lineage = {};
  const profile: Profile = {};
  const gpa = newestBlock(college, table, lineage, gpaBlock);
  if (gpa) profile.gpa = gpa;
  const rank = newestBlock(college, table, lineage, classRankBlock);
  if (rank) profile.class_rank = rank;
  const factors = newestBlock(college, table, lineage, factorsBlock);
  if (factors) profile.factors = factors;
  const wait = newestBlock(college, table, lineage, waitListBlock);
  if (wait) profile.wait_list = wait;
  const ed = newestBlock(college, table, lineage, earlyDecisionBlock);
  if (ed) profile.early_decision = ed;
  const ea = newestBlock(college, table, lineage, earlyActionBlock);
  if (ea) profile.early_action = ea;
  return Object.keys(profile).length ? { profile, lineage } : null;
}

/**
 * The school with `reported.admission_profile` and its lineage from its CDS record (lib/reported-merge.ts calls this
 * after the C1 merge, on a school `stripReported` already cleared). The same object when the record gives nothing.
 */
export function withAdmissionProfile(school: School, college: CollegeRecord | undefined, table: TemplateTable): School {
  const built = college ? buildAdmissionProfile(college, table) : null;
  if (!built) return school;
  return {
    ...school,
    reported: { ...school.reported, admission_profile: built.profile },
    lineage: { ...school.lineage, ...built.lineage },
  };
}

/* ------------------------------------------------------------------ */
/* The six shared factors: newest everywhere                           */
/* ------------------------------------------------------------------ */

/** "Fall 2025" → 2025. */
const fallOf = (year: string | null | undefined) => {
  const m = /^Fall (\d{4})$/.exec(year ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * The fall IPEDS's admission factors describe. They come from the same ADM file as the federal funnel, so the caller
 * passes that release's year (`meta.vintages["ipeds-adm"]`, sync-data's ADM year). Without it, the federal funnel's
 * year when the school still has one, else null (and nothing flips: the federal answer stays).
 */
function federalFactorsYear(school: School, given: number | null | undefined): number | null {
  if (given != null) return given;
  const a = school.admissions;
  if (a.federal && !school.lineage?.["admissions.federal"]) return a.federal.year;
  if (!a.federal && !school.lineage?.["admissions.year"]) return a.year;
  return null;
}

/**
 * Round 2's newest rule for the six C7 rows IPEDS also asks about (cds-admissions.md, "Newest everywhere: the six
 * shared factors"): when the C7 class is newer than the federal factors' year and the considered-at-all answer
 * differs, `admissions.factors[k]` becomes `not_considered` (C7 not considered) or `considered` (C7 considered or
 * above), cited to the CDS, and the federal answer is kept in `admissions.federal_factors`. A federal `required` is
 * never replaced by a C7 level other than "not considered" (C7 has no "required"; they agree). The same object when
 * nothing changes or the school was already applied. Called from lib/newest.ts#applyNewest.
 */
export function applyNewestFactors(school: School, factorsYear?: number | null): School {
  const c7 = school.reported?.admission_profile?.factors;
  const federal = school.admissions.factors;
  if (!c7 || !federal || school.admissions.federal_factors) return school;
  const fedYear = federalFactorsYear(school, factorsYear);
  const changed: Partial<Record<AdmissionFactor, FactorUse | null>> = {};
  const values: Partial<Record<AdmissionFactor, FactorUse>> = {};
  const lineage: Lineage = { ...school.lineage };
  for (const [c7Key, ipedsKey] of Object.entries(SHARED_FACTORS) as [C7Factor, AdmissionFactor][]) {
    const level = c7[c7Key];
    const fed = federal[ipedsKey];
    const rec = school.lineage?.[path(`factors.${c7Key}`)];
    if (!level || fed == null || !rec) continue;
    const c7Year = fallOf(rec.year);
    if (fedYear === null || c7Year === null || c7Year <= fedYear) continue;
    const considered = level !== "not_considered";
    if (considered === (fed !== "not_considered")) continue;
    changed[ipedsKey] = fed;
    values[ipedsKey] = considered ? "considered" : "not_considered";
    lineage[`admissions.factors.${ipedsKey}` as FieldPath] = { ...rec };
  }
  if (!Object.keys(changed).length) return school;
  const admissions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(school.admissions)) {
    admissions[k] = k === "factors" ? { ...federal, ...values } : v;
    if (k === "factors") admissions.federal_factors = changed;
  }
  return { ...school, admissions: admissions as School["admissions"], lineage };
}

/** Undoes `applyNewestFactors` byte for byte. Called from lib/newest.ts#restoreFederal. */
export function restoreFederalFactors(school: School): School {
  const kept = school.admissions.federal_factors;
  if (!kept) return school;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping federal_factors is the point
  const { federal_factors: _kept, ...rest } = school.admissions;
  const admissions = { ...rest, factors: { ...rest.factors, ...kept } } as School["admissions"];
  // Same key position for `factors` (spreading keeps it; replacing the value doesn't move it).
  const lineage: Lineage = { ...school.lineage };
  for (const k of Object.keys(kept)) delete lineage[`admissions.factors.${k}` as FieldPath];
  if (Object.keys(lineage).length) return { ...school, admissions, lineage };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- no lineage left: drop the key
  const { lineage: _lineage, ...withoutLineage } = school;
  return { ...withoutLineage, admissions };
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

/** The profile, or null. One accessor so views never reach into `school.reported` themselves. */
export function admissionProfile(school: School): Profile | null {
  return school.reported?.admission_profile ?? null;
}

/** Explore's "Publishes first-years' GPA" (`gpa=1`): an average or any band column is stored. */
export function hasGpaData(school: School): boolean {
  const g = admissionProfile(school)?.gpa;
  return !!g && (g.average !== null || !!g.bands.all || !!g.bands.with_test || !!g.bands.without_test);
}

/** ED admitted ÷ ED applications. */
export function edRate(ed: Profile["early_decision"] | undefined | null): number | null {
  return ed && ed.applicants && ed.admitted !== null ? ed.admitted / ed.applicants : null;
}

/** Admitted from the wait list ÷ accepted a place on it. */
export function waitListRate(w: Profile["wait_list"] | undefined | null): number | null {
  return w && w.accepted && w.admitted !== null ? w.admitted / w.accepted : null;
}

/**
 * The overall admit rate of the same class, from the same document as the ED counts: the funnel's applicants and
 * admitted when their lineage names the same CDS file. Never the newest-everywhere funnel of another document.
 */
export function sameDocumentRate(school: School): number | null {
  const edUrl = school.lineage?.[path("early_decision.applicants")]?.url;
  const ap = school.lineage?.["admissions.applicants"];
  const ad = school.lineage?.["admissions.admitted"];
  const { applicants, admitted } = school.admissions;
  if (!edUrl || ap?.url !== edUrl || ad?.url !== edUrl || !applicants || admitted === null) return null;
  return admitted / applicants;
}

const share = (bands: readonly number[]) => {
  const total = bands.reduce((a, b) => a + b, 0);
  return total > 0 ? bands.map((b) => b / total) : null;
};

/** The GPA bands holding the 25th and 75th percentiles of a column ("The middle half had GPAs of 3.75–4.0"). */
export function gpaMiddleHalf(bands: GpaBands | null | undefined): { low: number; high: number } | null {
  const s = bands && share(bands);
  if (!s) return null;
  // Walk up from the bottom band (index 8) to find the bands containing the 25th and 75th percentiles.
  let cum = 0;
  let p25: number | null = null;
  let p75: number | null = null;
  for (let i = 8; i >= 0; i--) {
    cum += s[i];
    if (p25 === null && cum >= 0.25 - 1e-9) p25 = i;
    if (p75 === null && cum >= 0.75 - 1e-9) p75 = i;
  }
  return p25 === null || p75 === null ? null : { low: GPA_BANDS[p25].low, high: GPA_BANDS[p75].high };
}

export type GpaPosition =
  | { kind: "band"; index: number; label: string; share: number; higher: number; lower: number }
  | { kind: "over-scale" };

/**
 * Where an (unweighted, 4.0-scale) GPA falls among a college's enrolled first-years, from the C11 bands only. Never
 * compared with the C12 average, which may be weighted. Above 4.0: "over-scale" (enter an unweighted GPA). Null
 * for an entry that isn't a GPA or bands that are empty. Shared with specs/product/chances-and-fit.md.
 */
export function gpaPosition(bands: GpaBands | null | undefined, gpa: number): GpaPosition | null {
  if (!Number.isFinite(gpa) || gpa < 0) return null;
  if (gpa > 4.0) return { kind: "over-scale" };
  const s = bands && share(bands);
  if (!s) return null;
  const index = gpa >= 4.0 ? 0 : GPA_BANDS.findIndex((b, i) => i > 0 && gpa >= b.low);
  const i = index < 0 ? 8 : index;
  const sum = (from: number, to: number) => s.slice(from, to).reduce((a, b) => a + b, 0);
  return { kind: "band", index: i, label: GPA_BANDS[i].label, share: s[i], higher: sum(0, i), lower: sum(i + 1, 9) };
}

/** "{91}% were in the top tenth …, of the {20}% whose high school reported a rank": never without the share. */
export function classRankSentence(r: Profile["class_rank"] | null | undefined): string | null {
  if (!r) return null;
  const parts = [r.top_tenth !== null && `${pct(r.top_tenth)} were in the top tenth of their high school class`, r.top_quarter !== null && `${pct(r.top_quarter)} in the top quarter`].filter(Boolean);
  if (!parts.length && r.top_half !== null) parts.push(`${pct(r.top_half)} were in the top half of their high school class`);
  if (!parts.length) return null;
  return `${parts.join(", ")}, of the ${pct(r.submitted_share)} whose high school reported a rank.`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** { month: 11, day: 1 } → "Nov 1". */
export const monthDayLabel = (d: MonthDayValue) => `${MONTHS[d.month - 1]} ${d.day}`;

/** The C7 level for a row of Compare's federal factor table, when this college's CDS has one. */
export function c7LevelFor(school: School, ipedsKey: AdmissionFactor): FactorImportance | null {
  const entry = (Object.entries(SHARED_FACTORS) as [C7Factor, AdmissionFactor][]).find(([, k]) => k === ipedsKey);
  return entry ? (admissionProfile(school)?.factors?.[entry[0]] ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* Lineage guard (lib/lineage.ts validateSchool)                       */
/* ------------------------------------------------------------------ */

/** Leaves whose year is the edition (the plan as published) rather than the entering class. */
const EDITION_YEAR = /^reported\.admission_profile\.(early_decision\.(offered|first|other)|early_action)\b/;

/**
 * Problems with a school's admissions profile lineage: every stored non-null leaf is cited to the college's CDS with
 * its edition, and its year is the one its edition gives it ("Fall 2025" for the 2025–26 class items, "2025–26" for
 * ED/EA plans), never a year typed by hand. lib/lineage.ts already requires a college-site extracted/derived record.
 */
export function validateAdmissionProfile(school: School, where: string): string[] {
  const p = admissionProfile(school);
  if (!p) return [];
  const errors: string[] = [];
  const visit = (value: unknown, at: string) => {
    if (value === null || value === undefined) return;
    if (typeof value === "object" && !Array.isArray(value) && !/\.(closing|notification)$/.test(at)) {
      for (const [k, v] of Object.entries(value)) visit(v, `${at}.${k}`);
      return;
    }
    const rec = school.lineage?.[at as FieldPath];
    if (!rec) return; // lib/lineage.ts reports the missing record
    const ed = parseEdition(rec.edition);
    if (!rec.edition || !ed) {
      errors.push(`${where}: ${at} has no CDS edition in its lineage`);
      return;
    }
    const expected = EDITION_YEAR.test(at) ? rec.edition : `Fall ${ed.start}`;
    if (rec.year !== expected) errors.push(`${where}: ${at} year "${rec.year}" isn't its edition's ("${expected}")`);
  };
  visit(p, P);
  return errors;
}
