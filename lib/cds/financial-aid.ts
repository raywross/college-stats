/**
 * CDS financial aid (specs/data-expansion/cds-financial-aid.md): a college's CDS record (data/cds-records/) → the
 * snapshot `school.reported.aid` with one lineage record per path, and the detail table `detail.cds_aid` with a quote
 * per value. Also the section's checks and normalizers, the year rules ("which record wins", `aidYearLabel`,
 * `cycleLabel`, `cdsAidYearNote`), the derived values (`meritDollarShare`, `aidMethodology`, `h2Shares`), and the
 * supersession of the hand-imported `aid.cds`.
 *
 * Pure module: type-only imports plus lib/cds-sections.ts and lib/cds-records.ts, so Node scripts and tests load it.
 * Client components may import it (no file reads, no template).
 */
import type {
  AidDates,
  AidDay,
  AidForms,
  AidYear,
  CdsAidDetail,
  CdsAidPrevious,
  H14Criterion,
  H1Row,
  H2Column,
  H2Headline,
  H2Line,
  InternationalAid,
  LineageRecord,
  ReportedAid,
  School,
} from "../types";
import type { FieldPath } from "../fields";
import type { SchoolDetail } from "../detail";
import { parseAidYear, parseEdition, type CdsCode, type CollegeRecord, type DocumentRecord, type ItemResult } from "../cds-sections.ts";
import { compareDocuments, editionFallYear, editionLabel, lineageFromItem, passedItem } from "../cds-records.ts";

/* ------------------------------------------------------------------ */
/* Template codes (2025–26)                                            */
/* ------------------------------------------------------------------ */

export const H2_LINES: readonly H2Line[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q"];
export const HEADLINE_LINES = ["a", "c", "d", "h", "i", "j", "k", "m", "n", "o", "p", "q"] as const satisfies readonly (keyof H2Headline)[];
export type H2ColumnKey = "first_years" | "full_time" | "part_time";
export const H2_COLUMNS: readonly H2ColumnKey[] = ["first_years", "full_time", "part_time"];

/** H2 lines A–M are H.2xx (13 a column), H2A N–Q are H.2Axx (4 a column). */
const h2Codes = (start: number, a2: number): Record<H2Line, CdsCode> =>
  Object.fromEntries(H2_LINES.map((l, i) => [l, i < 13 ? `H.2${String(start + i).padStart(2, "0")}` : `H.2A${String(a2 + i - 13).padStart(2, "0")}`])) as Record<H2Line, CdsCode>;
export const H2_CODES: Record<H2ColumnKey, Record<H2Line, CdsCode>> = { first_years: h2Codes(1, 1), full_time: h2Codes(14, 5), part_time: h2Codes(27, 9) };

const H1_KEYS = ["federal", "state", "institutional", "external", "total_grants", "student_loans", "federal_work_study", "other_work", "total_self_help", "parent_loans", "tuition_waivers", "athletic"] as const satisfies readonly (keyof H1Row)[];
/** H1 need-based H.105–H.116; non-need H.117–H.127 (no Federal Work-Study row). */
export const H1_CODES: Record<"need" | "non_need", Record<keyof H1Row, CdsCode | null>> = {
  need: Object.fromEntries(H1_KEYS.map((k, i) => [k, `H.${105 + i}`])) as Record<keyof H1Row, CdsCode>,
  non_need: Object.fromEntries(H1_KEYS.map((k, i) => [k, k === "federal_work_study" ? null : `H.${117 + i - (i > 6 ? 1 : 0)}`])) as Record<keyof H1Row, CdsCode | null>,
};

export const H6_CODES = { need_based: "H.601", non_need: "H.602", none: "H.603", recipients: "H.604", average: "H.605", total: "H.606" } as const;
export const H7_CODES = { own_form: "H.701", css_profile: "H.702", other: "H.703", other_text: "H.704" } as const;
export const H8_CODES = {
  fafsa: "H.801",
  own_form: "H.802",
  css_profile: "H.803",
  state_form: "H.804",
  noncustodial_profile: "H.805",
  business_farm_supplement: "H.806",
  other: "H.807",
  other_text: "H.808",
} as const;
export const METHOD_CODES = { federal: "H.102", institutional: "H.103", both: "H.104" } as const;
const DATE_CODES = ["H.901", "H.902", "H.903", "H.904", "H.905", "H.906", "H.907", "H.1001", "H.1002", "H.1003", "H.1004", "H.1005", "H.1006", "H.1101", "H.1102", "H.1103"];

export const H14_CRITERIA: readonly H14Criterion[] = ["academics", "alumni_affiliation", "art", "athletics", "job_skills", "rotc", "leadership", "music_drama", "religious_affiliation", "state_residency"];
/** H14 non-need H.1401–H.1410; need-based H.1411–H.1419 (no ROTC column). */
export const H14_CODES: Record<H14Criterion, { non_need: CdsCode; need: CdsCode | null }> = Object.fromEntries(
  H14_CRITERIA.map((c, i) => [c, { non_need: `H.${1401 + i}`, need: c === "rotc" ? null : `H.${1411 + i - (i > 5 ? 1 : 0)}` }])
) as Record<H14Criterion, { non_need: CdsCode; need: CdsCode | null }>;

/** Everything H.101 dates (H1, H2, H2A, H6). */
const AID_YEAR_CODES: readonly CdsCode[] = [
  ...Object.values(H1_CODES.need),
  ...Object.values(H1_CODES.non_need),
  ...H2_COLUMNS.flatMap((c) => Object.values(H2_CODES[c])),
  ...Object.values(H6_CODES),
].filter((c): c is CdsCode => c !== null);
/** The process facts (forms, dates, methodology, criteria, policy): the newest edition wins. */
const PROCESS_CODES: readonly CdsCode[] = [
  ...Object.values(METHOD_CODES),
  ...Object.values(H7_CODES),
  ...Object.values(H8_CODES),
  ...DATE_CODES,
  ...H14_CRITERIA.flatMap((c) => [H14_CODES[c].non_need, H14_CODES[c].need]).filter((c): c is CdsCode => c !== null),
  "H.1501",
];

/* ------------------------------------------------------------------ */
/* Reading items                                                       */
/* ------------------------------------------------------------------ */

const num = (doc: DocumentRecord, code: CdsCode | null): number | null => {
  const v = code ? passedItem(doc, code)?.v : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** A checked box: true, or a mark typed into a text cell (H.1418 is typed "Text" in the template). */
const isMark = (v: ItemResult["v"]): boolean => v === true || (typeof v === "string" && /^\s*(x|✔|✓|☒|y|yes)\s*$/i.test(v));
const marked = (doc: DocumentRecord, code: CdsCode | null): boolean => (code ? isMark(passedItem(doc, code)?.v ?? null) : false);

const BLANK_TEXT = /^\s*(n\/?a|none|-+|–|varies|yes or no|specify:?)\s*$/i;
const text = (doc: DocumentRecord, code: CdsCode): string | null => {
  const v = passedItem(doc, code)?.v;
  return typeof v === "string" && v.trim() && !BLANK_TEXT.test(v) ? v.trim() : null;
};

/** A list of checkboxes: null when no box is checked (blank ≠ no); otherwise each box true/false. */
function checkList<K extends string>(doc: DocumentRecord, codes: Record<K, CdsCode>): Record<K, boolean> | null {
  const out = Object.fromEntries(Object.entries(codes).map(([k, c]) => [k, marked(doc, c as CdsCode)])) as Record<K, boolean>;
  return Object.values(out).some(Boolean) ? out : null;
}

/* ------------------------------------------------------------------ */
/* Years                                                               */
/* ------------------------------------------------------------------ */

const academicYear = (start: number) => `${start}–${String(start + 1).slice(2)}`;

/** "2025–26 (estimated)" or "2024–25" (final): the lineage year of every H1, H2, H2A, H6 value. Never typed in UI. */
export function aidYearLabel(y: AidYear): string {
  return y.status === "estimated" ? `${academicYear(y.start)} (estimated)` : academicYear(y.start);
}

/** "Fall 2026 entrants" for a 2025–26 edition: the aid process (H7–H11) is for students applying for the next fall. */
export function cycleLabel(edition: string): string {
  const ed = parseEdition(edition);
  if (!ed) throw new Error(`not a CDS edition: "${edition}"`);
  return `Fall ${ed.start + 1} entrants`;
}

/** The first year of a display year: "2023–24" → 2023, "2025–26 (estimated)" → 2025, "Fall 2024" → 2024. */
export function startYearOf(label: string | null | undefined): number | null {
  const m = /(20\d{2})/.exec(label ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * The CDS aid block against the federal aid year (IPEDS SFA, `sfaYear` e.g. "2023–24"): shown with its own year when
 * as new or newer; one year older adds ", a year before the federal figures above"; two or more years older isn't shown
 * on the profile or in Compare (the values stay in the detail file).
 */
export function cdsAidYearNote(aidYear: AidYear | null, sfaYear: string | null): { show: boolean; suffix: string } {
  if (!aidYear) return { show: false, suffix: "" };
  const sfa = startYearOf(sfaYear);
  if (sfa === null || aidYear.start >= sfa) return { show: true, suffix: "" };
  if (sfa - aidYear.start === 1) return { show: true, suffix: ", a year before the federal figures above" };
  return { show: false, suffix: "" };
}

/**
 * Which document's H1/H2/H2A/H6 the snapshot takes: the newest aid year; for the same aid year a final figure beats an
 * estimate, then the newer edition. Documents whose H.101 doesn't parse can't be cited and never win.
 */
export function pickAidRecord(college: CollegeRecord): { document: DocumentRecord; aidYear: AidYear } | null {
  const candidates = college.documents
    .map((document) => ({ document, aidYear: parseAidYear(passedItem(document, "H.101")?.v ?? null) }))
    .filter((c): c is { document: DocumentRecord; aidYear: AidYear } => c.aidYear !== null && AID_YEAR_CODES.some((code) => code !== "H.101" && passedItem(c.document, code)));
  candidates.sort(
    (a, b) =>
      b.aidYear.start - a.aidYear.start ||
      (a.aidYear.status === b.aidYear.status ? 0 : a.aidYear.status === "final" ? -1 : 1) ||
      compareDocuments(a.document, b.document)
  );
  return candidates[0] ?? null;
}

/** The newest edition with any process fact (H.102–H.104, H7–H15). */
export function pickProcessRecord(college: CollegeRecord): DocumentRecord | null {
  return [...college.documents].sort(compareDocuments).find((d) => PROCESS_CODES.some((c) => passedItem(d, c))) ?? null;
}

/* ------------------------------------------------------------------ */
/* Normalizers and checks                                              */
/* ------------------------------------------------------------------ */

/** One problem for the review queue: the item (or block), the check, and why. Never blocks another item. */
export interface AidReview {
  code: string;
  check: string;
  detail: string;
}

/**
 * Line I ("average percent of need met") as a 0–1 fraction. Colleges write "1" (Cornell), "0.82", "58.6", "99.4%":
 * a string with "%" or a number over 1 is a percent; a number under 1 is a fraction. Exactly 1 is 100% only when line
 * H ≥ 0.95 × line D or another column of the same document uses fractions; otherwise it goes to review (1% or 100%?).
 * A result under 5% is reviewed too ("0.61" meaning 0.61%).
 */
export function normalizeNeedMet(
  raw: number | string | null | undefined,
  ctx: { h: number | null; d: number | null; otherColumnsUseFractions?: boolean }
): { v: number | null; review?: string } {
  if (raw === null || raw === undefined || raw === "") return { v: null };
  let n: number;
  if (typeof raw === "string") {
    const s = raw.trim();
    const parsed = Number(s.replace(/[%\s]/g, ""));
    if (!Number.isFinite(parsed)) return { v: null, review: `"${raw}" isn't a percent` };
    if (s.endsWith("%")) return range(parsed / 100, raw);
    n = parsed;
  } else n = raw;
  if (n > 1) return range(n / 100, raw);
  if (n === 1) {
    const fullyMet = ctx.h !== null && ctx.d !== null && ctx.d > 0 && ctx.h >= 0.95 * ctx.d;
    return fullyMet || ctx.otherColumnsUseFractions ? { v: 1 } : { v: null, review: `"1" could be 1% or 100%, and line H (${ctx.h ?? "blank"}) isn't near line D (${ctx.d ?? "blank"})` };
  }
  return range(n, raw);
}
function range(v: number, raw: unknown): { v: number | null; review?: string } {
  if (v < 0 || v > 1) return { v: null, review: `${raw} is outside 0–100%` };
  if (v < 0.05) return { v: null, review: `${raw} would mean under 5% of need met: check the units` };
  return { v };
}

const isCount = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0);
const le = (x: number | null, y: number | null) => x === null || y === null || x <= y;

/**
 * H2 checks for one column (lines A–O; P and Q are checked by `checkAthletic`): B ≤ A, C ≤ B, D ≤ C; E, F, G, H ≤ D;
 * N ≤ A − C; counts whole and ≥ 0; I in 0–1, H = D ⇒ I ≥ 99%, I = 100% ⇒ H ≥ 0.95 D; J ≥ K and K×E + L×F ≤ 1.05 × J×D.
 * The brief's "J ≈ K + L" and the spec's "M ≤ L" are not checks: both fail on valid documents (J also holds non-need
 * grants; M averages only the loan recipients among line F, so it can exceed L: Vanderbilt's first-years, L $2,229,
 * M $2,931).
 */
export function checkH2Column(c: H2Column): string[] {
  const out: string[] = [];
  for (const l of ["a", "b", "c", "d", "e", "f", "g", "h", "n", "p"] as const) if (!isCount(c[l])) out.push(`line ${l.toUpperCase()} (${c[l]}) isn't a whole number ≥ 0`);
  for (const l of ["j", "k", "l", "m", "o", "q"] as const) if (c[l] !== null && c[l]! < 0) out.push(`line ${l.toUpperCase()} is negative`);
  const order: [H2Line, H2Line][] = [["b", "a"], ["c", "b"], ["d", "c"], ["e", "d"], ["f", "d"], ["g", "d"], ["h", "d"]];
  for (const [x, y] of order) if (!le(c[x], c[y])) out.push(`line ${x.toUpperCase()} (${c[x]}) > line ${y.toUpperCase()} (${c[y]})`);
  if (c.n !== null && c.a !== null && c.c !== null && c.n > c.a - c.c) out.push(`line N (${c.n}) > A − C (${c.a - c.c}): more students without need than A − C`);
  if (c.i !== null) {
    if (c.i < 0 || c.i > 1) out.push(`line I (${c.i}) is outside 0–1`);
    if (c.h !== null && c.d !== null && c.d > 0 && c.h === c.d && c.i < 0.99) out.push(`line H = D (every need fully met) but line I is ${c.i}`);
    if (c.i === 1 && c.h !== null && c.d !== null && c.h < 0.95 * c.d) out.push(`line I is 100% but line H (${c.h}) < 0.95 × D (${c.d})`);
  }
  if (!le(c.k, c.j)) out.push(`average need-based grant K (${c.k}) > average package J (${c.j})`);
  if (c.j !== null && c.d !== null && c.k !== null && c.e !== null && c.l !== null && c.f !== null && c.k * c.e + c.l * c.f > 1.05 * c.j * c.d) {
    out.push(`K × E + L × F (${Math.round(c.k * c.e + c.l * c.f)}) > 1.05 × J × D (${Math.round(1.05 * c.j * c.d)}): the packages are smaller than their parts`);
  }
  return out;
}

/** The brief's dropped rule, kept as a function so a test can show why it was dropped: J within ±15% of K + L. */
export function packageApproxRule(c: H2Column): boolean {
  if (c.j === null || c.k === null || c.l === null) return true;
  return Math.abs(c.j - (c.k + c.l)) <= 0.15 * c.j;
}

/**
 * H2A P and Q (institutional athletic scholarships) for one column: P ≤ A; Q ≤ the cost of attendance × 1.1; in the
 * full-time column, P × Q within 0.5–1.5 × H1 athletic dollars (H.116 + H.127); P > 0 at an NCAA Division III college
 * (which gives no athletic scholarships) is wrong.
 */
export function checkAthletic(c: H2Column, ctx: { costOfAttendance: number | null; athleticDollars: number | null; divisionIII: boolean; fullTime: boolean }): string[] {
  const out: string[] = [];
  if (!isCount(c.p)) out.push(`line P (${c.p}) isn't a whole number ≥ 0`);
  if (!le(c.p, c.a)) out.push(`line P (${c.p}) > line A (${c.a})`);
  if (c.q !== null && ctx.costOfAttendance !== null && c.q > ctx.costOfAttendance * 1.1) out.push(`line Q (${c.q}) is more than the cost of attendance`);
  if (ctx.fullTime && c.p !== null && c.q !== null && c.p > 0 && ctx.athleticDollars !== null && ctx.athleticDollars > 0) {
    const r = (c.p * c.q) / ctx.athleticDollars;
    if (r < 0.5 || r > 1.5) out.push(`P × Q (${Math.round(c.p * c.q)}) isn't within 0.5–1.5 × H1 athletic dollars (${ctx.athleticDollars})`);
  }
  if (ctx.divisionIII && c.p !== null && c.p > 0) out.push(`${c.p} athletic scholarships at an NCAA Division III college`);
  return out;
}

/** H1: grant rows add to "Total Scholarships/Grants" and self-help rows to "Total Self-Help", each ± $1K; no negatives. */
export function checkH1Row(r: H1Row): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(r)) if (v !== null && v < 0) out.push(`${k} is negative`);
  const sum = (ks: (keyof H1Row)[]) => ks.reduce((a, k) => a + (r[k] ?? 0), 0);
  const grants = sum(["federal", "state", "institutional", "external"]);
  if (r.total_grants !== null && Math.abs(grants - r.total_grants) > 1000) out.push(`grant rows add to ${Math.round(grants)}, not the total ${r.total_grants}`);
  const selfHelp = sum(["student_loans", "federal_work_study", "other_work"]);
  if (r.total_self_help !== null && Math.abs(selfHelp - r.total_self_help) > 1000) out.push(`self-help rows add to ${Math.round(selfHelp)}, not the total ${r.total_self_help}`);
  return out;
}

/** H6: average × number = total ± 5%; average ≤ the cost of attendance × 1.1; "not available" excludes the others. */
export function checkH6(h6: NonNullable<CdsAidDetail["h6"]>, costOfAttendance: number | null): string[] {
  const out: string[] = [];
  const { recipients: n, average: avg, total } = h6;
  if (!isCount(n)) out.push(`recipients (${n}) isn't a whole number ≥ 0`);
  if (n !== null && avg !== null && total !== null && total > 0 && Math.abs(n * avg - total) > 0.05 * total) out.push(`${n} × ${avg} = ${n * avg}, not the total ${total} (±5%)`);
  if (avg !== null && costOfAttendance !== null && avg > costOfAttendance * 1.1) out.push(`average ${avg} is more than the cost of attendance`);
  if (h6.none && (h6.need_based || h6.non_need)) out.push(`"not available" is checked with an aid type`);
  if (h6.none && ((n ?? 0) > 0 || (avg ?? 0) > 0 || (total ?? 0) > 0)) out.push(`"not available" is checked but recipients or dollars are given`);
  return out;
}

/** H8: FAFSA is checked whenever any box is (every college on the site takes federal aid). */
export function checkForms(f: AidForms): string[] {
  return f.fafsa ? [] : ["H8 has boxes checked but not the FAFSA"];
}

/** Methodology ⇔ forms: IM or both needs the CSS Profile or the college's own form; FM only with the CSS Profile is rare. */
export function checkMethodology(m: ReportedAid["methodology"], f: AidForms | null): string[] {
  if (!m || !f) return [];
  if ((m === "institutional" || m === "both") && !f.css_profile && !f.own_form) return [`${m} methodology without the CSS Profile or the college's own form`];
  if (m === "federal" && f.css_profile) return ["federal methodology only, yet the CSS Profile is required"];
  return [];
}

/** September → August position of a date, for "in cycle order". */
const cyclePos = (d: AidDay) => ((d.month + 3) % 12) * 100 + d.day;
const isDay = (d: AidDates[keyof AidDates]): d is AidDay => typeof d === "object" && d !== null;

/** H9–H11: valid dates in cycle order (priority ≤ deadline, notified ≥ priority, reply ≥ notified); weeks 1–12; no contradicting boxes. */
export function checkDates(d: AidDates): { field: keyof AidDates; detail: string }[] {
  const out: { field: keyof AidDates; detail: string }[] = [];
  if (d.deadline !== null && d.no_deadline) out.push({ field: "deadline", detail: `a deadline and "no deadline" are both checked` });
  if (d.notify_by !== null && d.notify_rolling_from !== null) out.push({ field: "notify_by", detail: "on-date and rolling notification are both checked" });
  if (isDay(d.priority) && isDay(d.deadline) && cyclePos(d.priority) > cyclePos(d.deadline)) out.push({ field: "deadline", detail: "deadline before the priority date" });
  if (isDay(d.notify_by) && isDay(d.priority) && cyclePos(d.notify_by) < cyclePos(d.priority)) out.push({ field: "notify_by", detail: "notification before the priority date" });
  if (isDay(d.reply_by) && isDay(d.notify_by) && cyclePos(d.reply_by) < cyclePos(d.notify_by)) out.push({ field: "reply_by", detail: "reply date before notification" });
  if (d.reply_within_weeks !== null && !(Number.isInteger(d.reply_within_weeks) && d.reply_within_weeks >= 1 && d.reply_within_weeks <= 12)) out.push({ field: "reply_within_weeks", detail: `${d.reply_within_weeks} weeks isn't 1–12` });
  return out;
}

/** H15 is shown in the college's words unless it's boilerplate: under 60 characters or a "nothing new / see our site" line. */
export function showPolicyNote(t: string): boolean {
  return t.trim().length >= 60 && !/not implemented|no new|please visit|see our website/i.test(t);
}

/* ------------------------------------------------------------------ */
/* Derived values                                                      */
/* ------------------------------------------------------------------ */

/** Share of the college's own grant dollars given without regard to need: H.119 ÷ (H.107 + H.119). */
export function meritDollarShare(g: ReportedAid["institutional_grants"] | null | undefined): number | null {
  if (!g || g.need === null || g.non_need === null || g.need + g.non_need <= 0) return null;
  return g.non_need / (g.need + g.non_need);
}

/** The stated methodology; else "institutional", inferred, when the CSS Profile or the college's own form is required. */
export function aidMethodology(aid: ReportedAid | null | undefined): { value: "federal" | "institutional" | "both"; inferred: boolean } | null {
  if (!aid) return null;
  if (aid.methodology) return { value: aid.methodology, inferred: false };
  if (aid.forms?.css_profile || aid.forms?.own_form) return { value: "institutional", inferred: true };
  return null;
}

/** Shares shown from an H2 column: have need (C ÷ A), need fully met (H ÷ D), merit without need (N ÷ A). */
export function h2Shares(c: Pick<H2Column, "a" | "c" | "d" | "h" | "n"> | null | undefined): { hasNeed: number | null; fullyMet: number | null; meritNoNeed: number | null } {
  const div = (x: number | null | undefined, y: number | null | undefined) => (x == null || !y ? null : x / y);
  return { hasNeed: div(c?.c, c?.a), fullyMet: div(c?.h, c?.d), meritNoNeed: div(c?.n, c?.a) };
}

/** H2 headline lines from a full column. */
export const headlineOf = (c: H2Column): H2Headline => Object.fromEntries(HEADLINE_LINES.map((l) => [l, c[l]])) as H2Headline;

/* ------------------------------------------------------------------ */
/* Build: record → snapshot, lineage, detail                           */
/* ------------------------------------------------------------------ */

export interface FinancialAidBuild {
  aid: ReportedAid;
  lineage: Partial<Record<FieldPath, LineageRecord>>;
  detail: CdsAidDetail;
  /** The `detail.cds_aid` table's display year (the aid year, else the edition). */
  detailYear: string;
  reviews: AidReview[];
}

const emptyColumn = (): H2Column => Object.fromEntries(H2_LINES.map((l) => [l, null])) as H2Column;
const allNull = (o: object) => Object.values(o).every((v) => v === null);

/** "FAFSA | X" → "X FAFSA": a checked box's quote as the mark then the label. */
const markQuote = (it: ItemResult | undefined) => {
  const [label, mark] = (it?.quote ?? "").split(" | ");
  return mark ? `${mark.trim()} ${label.trim()}` : (it?.quote ?? "");
};

/**
 * Everything section H gives one college, checked: the snapshot block, its lineage, the detail table, and what failed.
 * Null when no document has a publishable section H value. `school` supplies the context the checks need (cost of
 * attendance, athletic division).
 */
export function buildFinancialAid(school: Pick<School, "cost" | "campus">, college: CollegeRecord | undefined): FinancialAidBuild | null {
  if (!college) return null;
  const picked = pickAidRecord(college);
  const proc = pickProcessRecord(college);
  if (!picked && !proc) return null;
  const reviews: AidReview[] = [];
  const lineage: Partial<Record<FieldPath, LineageRecord>> = {};
  const cite: CdsAidDetail["cite"] = {};
  const citeCodes = (doc: DocumentRecord, codes: readonly (CdsCode | null)[]) => {
    for (const c of codes) {
      const it = c ? passedItem(doc, c) : null;
      if (!c || !it?.quote) continue;
      cite[c] = { quote: it.quote, ...(it.page !== undefined ? { page: it.page } : {}), ...(it.cell ? { cell: it.cell } : {}), ...(it.line !== undefined ? { line: it.line } : {}), ...(it.field ? { field: it.field } : {}) };
    }
  };
  const coa = school.cost?.cost_of_attendance ?? null;

  /* ---- H1, H2, H2A, H6: the aid year's document ---- */
  let h1: CdsAidDetail["h1"] = null;
  let h2: CdsAidDetail["h2"] = null;
  let h6: CdsAidDetail["h6"] = null;
  let firstYears: H2Headline | null = null;
  let grants: ReportedAid["institutional_grants"] = null;
  let international: InternationalAid | null = null;
  const aidYear = picked?.aidYear ?? null;
  if (picked) {
    const doc = picked.document;
    const year = aidYearLabel(picked.aidYear);
    // H1
    const row = (k: "need" | "non_need"): H1Row => Object.fromEntries(H1_KEYS.map((key) => [key, num(doc, H1_CODES[k][key])])) as unknown as H1Row;
    const need = row("need");
    const nonNeed = row("non_need");
    const h1Problems = [...checkH1Row(need), ...checkH1Row(nonNeed)];
    if (h1Problems.length) reviews.push(...h1Problems.map((detail) => ({ code: "H1", check: "h1-sums", detail })));
    else if (!allNull(need) || !allNull(nonNeed)) {
      h1 = { need, non_need: nonNeed };
      citeCodes(doc, [...Object.values(H1_CODES.need), ...Object.values(H1_CODES.non_need)]);
      if (need.institutional !== null || nonNeed.institutional !== null) {
        grants = { need: need.institutional, non_need: nonNeed.institutional };
        lineage["reported.aid.institutional_grants"] = lineageFromItem(doc, need.institutional !== null ? "H.107" : "H.119", { year, path: "reported.aid.institutional_grants" });
      }
    }
    // H2 and H2A, column by column
    const raw = (col: H2ColumnKey) => Object.fromEntries(H2_LINES.map((l) => [l, l === "i" ? null : num(doc, H2_CODES[col][l])])) as H2Column;
    const cols = Object.fromEntries(H2_COLUMNS.map((c) => [c, raw(c)])) as Record<H2ColumnKey, H2Column>;
    const rawI = (col: H2ColumnKey) => passedItem(doc, H2_CODES[col].i)?.v ?? null;
    const fractions = (except: H2ColumnKey) => H2_COLUMNS.some((c) => c !== except && typeof rawI(c) === "number" && (rawI(c) as number) > 0.05 && (rawI(c) as number) < 1);
    const athleticDollars = h1 ? (h1.need.athletic ?? 0) + (h1.non_need.athletic ?? 0) : null;
    const divisionIII = school.campus?.athletics?.division === "III";
    const out: Partial<Record<H2ColumnKey, H2Column>> = {};
    for (const key of H2_COLUMNS) {
      const c = cols[key];
      const v = rawI(key);
      const i = normalizeNeedMet(typeof v === "number" || typeof v === "string" ? v : null, { h: c.h, d: c.d, otherColumnsUseFractions: fractions(key) });
      if (i.review) reviews.push({ code: H2_CODES[key].i, check: "need-met-percent", detail: i.review });
      c.i = i.v;
      const problems = checkH2Column(c);
      const athletic = checkAthletic(c, { costOfAttendance: coa, athleticDollars, divisionIII, fullTime: key === "full_time" });
      if (problems.length) {
        reviews.push(...problems.map((detail) => ({ code: `H2 ${key}`, check: "h2-column", detail })));
        out[key] = emptyColumn();
        continue;
      }
      if (athletic.length) {
        reviews.push(...athletic.map((detail) => ({ code: `H2A ${key}`, check: "h2a-athletic", detail })));
        c.p = null;
        c.q = null;
      }
      out[key] = c;
      citeCodes(doc, H2_LINES.filter((l) => c[l] !== null).map((l) => H2_CODES[key][l]));
    }
    if (H2_COLUMNS.some((k) => !allNull(out[k]!))) {
      h2 = out as Record<H2ColumnKey, H2Column>;
      if (!allNull(h2.first_years)) {
        firstYears = headlineOf(h2.first_years);
        const anchor = H2_LINES.map((l) => H2_CODES.first_years[l]).find((code) => passedItem(doc, code)?.quote)!;
        lineage["reported.aid.first_years"] = lineageFromItem(doc, anchor, { year, path: "reported.aid.first_years" });
      }
    }
    // H6
    const types = { need_based: marked(doc, H6_CODES.need_based), non_need: marked(doc, H6_CODES.non_need), none: marked(doc, H6_CODES.none) };
    const h6Read = { ...types, recipients: num(doc, H6_CODES.recipients), average: num(doc, H6_CODES.average), total: num(doc, H6_CODES.total) };
    if (Object.values(types).some(Boolean) || h6Read.recipients !== null || h6Read.average !== null) {
      const problems = checkH6(h6Read, coa);
      if (problems.length) reviews.push(...problems.map((detail) => ({ code: "H6", check: "h6", detail })));
      else {
        h6 = h6Read;
        international = { need_based: h6.need_based, non_need: h6.non_need, none: h6.none, recipients: h6.recipients, average: h6.average };
        citeCodes(doc, Object.values(H6_CODES));
        const anchor = (Object.values(H6_CODES) as CdsCode[]).find((c) => passedItem(doc, c)?.quote)!;
        lineage["reported.aid.international"] = lineageFromItem(doc, anchor, { year, path: "reported.aid.international" });
      }
    }
    lineage["reported.aid.aid_year"] = lineageFromItem(doc, "H.101", { year, path: "reported.aid.aid_year" });
    citeCodes(doc, ["H.101"]);
  }

  /* ---- Process facts: the newest edition's document ---- */
  let forms: AidForms | null = null;
  let methodology: ReportedAid["methodology"] = null;
  let dates: AidDates | null = null;
  let h7: CdsAidDetail["h7"] = null;
  let h14: CdsAidDetail["h14"] = null;
  let h15: CdsAidDetail["h15"] = null;
  if (proc) {
    const edLabel = editionLabel(proc.edition);
    const cycle = cycleLabel(proc.edition);
    // H8 forms
    const { other_text: otherText, ...boxes } = H8_CODES;
    const list = checkList(proc, boxes);
    if (list) {
      const f: AidForms = { fafsa: list.fafsa, own_form: list.own_form, css_profile: list.css_profile, state_form: list.state_form, noncustodial_profile: list.noncustodial_profile, business_farm_supplement: list.business_farm_supplement, other: list.other ? text(proc, otherText) : null };
      const problems = checkForms(f);
      if (problems.length) reviews.push(...problems.map((detail) => ({ code: "H8", check: "h8-fafsa", detail })));
      else {
        forms = f;
        const checked = (Object.values(boxes) as CdsCode[]).filter((c) => marked(proc, c));
        citeCodes(proc, [...checked, ...(f.other ? [otherText] : [])]);
        const rec = lineageFromItem(proc, checked[0], { year: cycle, path: "reported.aid.forms" });
        const quote = checked.map((c) => markQuote(passedItem(proc, c)!)).join("; ");
        lineage["reported.aid.forms"] = { ...rec, quote: quote.length <= 160 ? quote : `${quote.slice(0, 159)}…` };
      }
    }
    // Methodology (H.102–H.104), as stated
    const methods = (Object.entries(METHOD_CODES) as [NonNullable<ReportedAid["methodology"]>, CdsCode][]).filter(([, c]) => marked(proc, c));
    if (methods.length) {
      const m: ReportedAid["methodology"] = methods.length > 1 || methods[0][0] === "both" ? "both" : methods[0][0];
      const problems = checkMethodology(m, forms);
      if (problems.length) reviews.push(...problems.map((detail) => ({ code: "H.102–H.104", check: "methodology-forms", detail })));
      else {
        methodology = m;
        citeCodes(proc, methods.map(([, c]) => c));
        lineage["reported.aid.methodology"] = lineageFromItem(proc, methods[0][1], { year: edLabel, path: "reported.aid.methodology" });
      }
    }
    // H9–H11 dates
    const day = (box: CdsCode | null, m: CdsCode, d: CdsCode): AidDay | "unstated" | null => {
      const month = num(proc, m);
      const dd = num(proc, d);
      if (month !== null && dd !== null) return Number.isInteger(month) && Number.isInteger(dd) && month >= 1 && month <= 12 && dd >= 1 && dd <= 31 ? { month, day: dd } : null;
      return box && marked(proc, box) ? "unstated" : null;
    };
    const asDay = (v: AidDay | "unstated" | null): AidDay | null => (v === "unstated" ? null : v);
    const d: AidDates = {
      priority: day("H.901", "H.902", "H.903"),
      deadline: day("H.904", "H.905", "H.906"),
      no_deadline: marked(proc, "H.907") || null,
      notify_by: asDay(day("H.1001", "H.1002", "H.1003")),
      notify_rolling_from: day("H.1004", "H.1005", "H.1006"),
      reply_by: asDay(day(null, "H.1101", "H.1102")),
      reply_within_weeks: num(proc, "H.1103"),
    };
    for (const p of checkDates(d)) {
      reviews.push({ code: `H9–H11 ${p.field}`, check: "aid-dates", detail: p.detail });
      d[p.field] = null as never;
    }
    if (!allNull(d)) {
      dates = d;
      const used = DATE_CODES.filter((c) => passedItem(proc, c));
      citeCodes(proc, used);
      lineage["reported.aid.dates"] = lineageFromItem(proc, used.find((c) => passedItem(proc, c)?.quote)!, { year: cycle, path: "reported.aid.dates" });
    }
    // H7 (international applicants' forms)
    const intl = checkList(proc, { own_form: H7_CODES.own_form, css_profile: H7_CODES.css_profile, other: H7_CODES.other });
    if (intl) {
      h7 = { ...intl, other_text: intl.other ? text(proc, H7_CODES.other_text) : null };
      citeCodes(proc, Object.values(H7_CODES));
    }
    // H14 criteria (an unchecked box is "not marked", never "not considered")
    const anyH14 = H14_CRITERIA.some((c) => marked(proc, H14_CODES[c].non_need) || marked(proc, H14_CODES[c].need));
    if (anyH14) {
      h14 = Object.fromEntries(H14_CRITERIA.map((c) => [c, { non_need: marked(proc, H14_CODES[c].non_need), need: H14_CODES[c].need ? marked(proc, H14_CODES[c].need) : null }])) as CdsAidDetail["h14"];
      citeCodes(proc, H14_CRITERIA.flatMap((c) => [H14_CODES[c].non_need, H14_CODES[c].need]));
    }
    // H15 policy note
    const policy = text(proc, "H.1501");
    if (policy) {
      h15 = { text: policy, display: showPolicyNote(policy) };
      citeCodes(proc, ["H.1501"]);
    }
  }

  const editionDoc = proc ?? picked!.document;
  const anchorCode = PROCESS_CODES.find((c) => passedItem(editionDoc, c)?.quote) ?? "H.101";
  lineage["reported.aid.edition"] = lineageFromItem(editionDoc, anchorCode, { year: editionLabel(editionDoc.edition), path: "reported.aid.edition" });

  const aid: ReportedAid = { edition: editionDoc.edition, aid_year: aidYear, methodology, forms, dates, international, first_years: firstYears, institutional_grants: grants };
  const detailDoc = picked?.document ?? editionDoc;
  const detail: CdsAidDetail = {
    document: { url: detailDoc.url, edition: detailDoc.edition, retrieved: detailDoc.retrieved, sha256: detailDoc.sha256 },
    aid_year: aidYear,
    h1,
    h2,
    h6,
    h7,
    h14,
    h15,
    cite,
  };
  return { aid, lineage, detail, detailYear: aidYear ? aidYearLabel(aidYear) : editionLabel(editionDoc.edition), reviews };
}

/* ------------------------------------------------------------------ */
/* Dataset merge and supersession of the hand-imported aid.cds         */
/* ------------------------------------------------------------------ */

/**
 * The school with `reported.aid` and its lineage from its CDS record, and the hand-imported `aid.cds` moved to
 * `aid.cds_previous` when the record is the same edition as the override's or newer. Call on a school already
 * stripped of its `reported` block (lib/reported-merge.ts#stripReported). The same object when there's nothing to add.
 */
export function applyFinancialAid(school: School, college: CollegeRecord | undefined): School {
  const built = buildFinancialAid(school, college);
  if (!built) return school;
  const withAid: School = { ...school, reported: { ...(school.reported ?? {}), aid: built.aid }, lineage: { ...(school.lineage ?? {}), ...built.lineage } };
  return supersedeCdsAid(withAid);
}

/** Renames one key of an object in place (keeps every key's position). */
function renameKey<T extends object>(o: T, from: string, to: string): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v])) as T;
}

/** True when the record behind `reported.aid.first_years` is the override's edition or newer. */
export function recordSupersedesOverride(school: School): boolean {
  const recEdition = editionFallYear(school.lineage?.["reported.aid.first_years"]?.edition?.replace("–", "-"));
  const overrideEdition = editionFallYear(school.cds?.edition);
  return school.reported?.aid?.first_years != null && recEdition !== null && (overrideEdition === null || recEdition >= overrideEdition);
}

/** `aid.cds` → `aid.cds_previous` (with its lineage) when a same-or-newer record's H2 is published. */
export function supersedeCdsAid(school: School): School {
  const cds = school.aid?.cds;
  if (!cds || !school.aid || !recordSupersedesOverride(school)) return school;
  const rec = school.lineage?.["aid.cds"];
  const previous: CdsAidPrevious = { edition: school.cds?.edition ?? rec?.year ?? "", url: rec?.url ?? school.cds?.url ?? "", values: cds };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping `cds` is the point
  const { cds: _cds, ...rest } = school.aid;
  return { ...school, aid: { ...rest, cds_previous: previous }, ...(school.lineage ? { lineage: renameKey(school.lineage, "aid.cds", "aid.cds_previous") } : {}) };
}

/** Undoes `supersedeCdsAid` exactly (key order kept); the same object when there's nothing to undo. */
export function restoreCdsAid(school: School): School {
  const prev = school.aid?.cds_previous;
  if (!prev || !school.aid) return school;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping `cds_previous` is the point
  const { cds_previous: _prev, ...rest } = school.aid;
  return { ...school, aid: { ...rest, cds: prev.values }, ...(school.lineage ? { lineage: renameKey(school.lineage, "aid.cds_previous", "aid.cds") } : {}) };
}

/**
 * The lineage guard (run by validateSchool via `financialAidProblems`): every published `reported.aid.first_years` at a
 * college whose override still holds `aid.cds` from the same or an older edition must have superseded it.
 */
export function financialAidProblems(school: School): string[] {
  const where = `${school.name} (${school.unit_id})`;
  const out: string[] = [];
  if (school.aid?.cds && recordSupersedesOverride(school)) out.push(`${where}: aid.cds should be superseded by reported.aid (move it to aid.cds_previous)`);
  if (school.aid?.cds_previous && !school.reported?.aid?.first_years) out.push(`${where}: aid.cds_previous without a published reported.aid.first_years`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Detail table (lib/detail.ts DETAIL_TABLES.cds_aid)                  */
/* ------------------------------------------------------------------ */

/** One `cds_aid` detail table per college with a record (the same build `applyFinancialAid` uses). */
export function financialAidDetails(schools: readonly School[], records: readonly CollegeRecord[]): SchoolDetail[] {
  const byId = new Map(records.map((r) => [r.unit_id, r]));
  const out: SchoolDetail[] = [];
  for (const s of schools) {
    const built = buildFinancialAid(s, byId.get(s.unit_id));
    if (built) out.push({ unit_id: s.unit_id, tables: { cds_aid: { source: "college-site", vintage: null, year: built.detailYear, rows: built.detail } } });
  }
  return out;
}

/** Every value in a `detail.cds_aid` table that needs a quote: [code, value] for numbers, strings, and checked boxes. */
export function detailValues(d: CdsAidDetail): [string, unknown][] {
  const out: [string, unknown][] = [];
  const add = (code: CdsCode | null, v: unknown) => {
    if (code && v !== null && v !== false && v !== undefined) out.push([code, v]);
  };
  if (d.h1) for (const k of ["need", "non_need"] as const) for (const key of H1_KEYS) add(H1_CODES[k][key], d.h1[k][key]);
  if (d.h2) for (const col of H2_COLUMNS) for (const l of H2_LINES) add(H2_CODES[col][l], d.h2[col][l]);
  if (d.h6) for (const [k, code] of Object.entries(H6_CODES)) add(code, d.h6[k as keyof typeof H6_CODES]);
  if (d.h7) for (const [k, code] of Object.entries(H7_CODES)) add(code, d.h7[k as keyof typeof H7_CODES]);
  if (d.h14) for (const c of H14_CRITERIA) {
    add(H14_CODES[c].non_need, d.h14[c].non_need);
    add(H14_CODES[c].need, d.h14[c].need);
  }
  if (d.h15) add("H.1501", d.h15.text);
  return out;
}

/** Problems with a `detail.cds_aid` table's rows: a value without a quote and a location, or a malformed document. */
export function checkCdsAidDetail(rows: unknown): string | null {
  const d = rows as CdsAidDetail;
  if (!d || typeof d !== "object" || !d.document?.url || !parseEdition(d.document.edition) || !d.document.sha256) return "needs a document with url, edition, and sha256";
  if (!d.cite || typeof d.cite !== "object") return "has no cite map";
  for (const [code] of detailValues(d)) {
    const c = d.cite[code];
    if (!c?.quote) return `${code} has a value but no quote in cite`;
    if (c.page === undefined && !c.cell && c.line === undefined && !c.field) return `${code} has no page, cell, line, or field`;
  }
  if (d.h2) for (const col of H2_COLUMNS) {
    const i = d.h2[col].i;
    if (i !== null && (i < 0 || i > 1)) return `h2.${col}.i (${i}) isn't a fraction`;
  }
  return null;
}

/** The snapshot's `reported.aid.first_years` must equal the detail file's first-year column (a detailMismatches rule). */
export function cdsAidMismatch(school: School, d: CdsAidDetail): string | null {
  const snap = school.reported?.aid?.first_years ?? null;
  const col = d.h2 && !allNull(d.h2.first_years) ? headlineOf(d.h2.first_years) : null;
  return JSON.stringify(snap) === JSON.stringify(col) ? null : "reported.aid.first_years doesn't match the detail file's first-year column";
}
