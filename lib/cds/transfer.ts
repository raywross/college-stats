/**
 * CDS section D, transfer admission (specs/data-expansion/cds-transfer.md): a college's round-3 record
 * (data/cds-records/<unit_id>.json, items D.101–D.936) → `school.reported.transfer`, with one lineage record per stored
 * field.
 *
 * Which values. Every value comes from a **passed** item of the newest document that has any section-D answer. Each
 * item group is checked on its own (round-3 Decision 9): a failed check drops only that group (D1, D2, one D5 row, one
 * D9 term, D4, D6, D7) and is reported in `failures`, never blocking another group.
 * - D1 "No" with D2 transfer applicants → `transfer-d1-consistency`, D1 dropped. D1 blank with D2 applicants → true,
 *   inferred, and the lineage quote says so (Illinois 2025–26).
 * - D2: men + women + unknown = total within ±1 (`transfer-d2-sum`); enrolled ≤ admitted ≤ applicants, for the total
 *   and each sex (`transfer-d2-funnel`); enrolled total within 25% of the federal new transfer-in count
 *   (`transfer-d2-vs-federal`, lib/transfers.ts, `demographics.transfer_in.count`). Any failure drops all of D2.
 * - D5: each row must carry exactly one of the five marks (`transfer-d5-mark`).
 * - D9: valid dates; closing on or after priority, reply on or after notification (`transfer-d9-order`).
 * - D4 credits 0–200; D6/D7 GPA 0–4 (`transfer-range`; a GPA over 4.0 is a weighted scale: held for review).
 *
 * Years (lineage): D2 is the document's fall (`years.fall`, "Fall 2025"); D9 is the next cycle (`years["next-cycle"]`,
 * "Fall 2026 cycle"); everything else is the edition ("2025–26").
 *
 * Pure: type-only imports plus lib/cds-records.ts and lib/cds-sections.ts (both pure). Display helpers live in
 * lib/cds/transfer-display.ts, so client code never loads the records helpers.
 */
import type {
  LineageRecord,
  ReportedTransfer,
  School,
  TransferCounts,
  TransferMaterials,
  TransferRequirement,
  TransferTerm,
  TransferTermDates,
} from "../types";
import type { CdsCode, CollegeRecord, DocumentRecord, MonthDay } from "../cds-sections.ts";
import { monthDay } from "../cds-sections.ts";
import { compareDocuments, editionLabel, itemBoolean, itemNumber, itemText, itemValue, lineageFromItem, passedItem } from "../cds-records.ts";

/** Every lineage path this module writes starts with this, so a re-merge can remove the previous ones. */
export const TRANSFER_LINEAGE_PREFIX = "reported.transfer.";

/** `transfer-d2-vs-federal`: the CDS enrolled total within this share of the federal transfer-in count. */
export const TRANSFER_FEDERAL_TOLERANCE = 0.25;
/** The admit rate needs at least this many admits (spec: admitted ≥ 10). */
export const TRANSFER_MIN_RATE_ADMITS = 10;
/** D2 sums may be off by this much (rounding). */
export const TRANSFER_SUM_TOLERANCE = 1;
/**
 * D9 order checks allow a window that wraps the new year (a December priority date before a March closing date), up
 * to this many days; a longer "backwards" gap is a document inconsistency.
 */
export const TRANSFER_DATE_WINDOW_DAYS = 240;

/* ------------------------------------------------------------------ */
/* Codes (2025–26 template)                                            */
/* ------------------------------------------------------------------ */

export const D1 = { enrolls: "D.101", advanced: "D.102" } as const;
export const D2_ROWS = ["applicants", "admitted", "enrolled"] as const;
export type TransferRow = (typeof D2_ROWS)[number];
export const D2_COLUMNS = ["men", "women", "unknown", "total"] as const;
export type TransferColumn = (typeof D2_COLUMNS)[number];
export const D2_CODES: Record<TransferRow, Record<TransferColumn, CdsCode>> = {
  applicants: { men: "D.201", women: "D.202", unknown: "D.203", total: "D.204" },
  admitted: { men: "D.205", women: "D.206", unknown: "D.207", total: "D.208" },
  enrolled: { men: "D.209", women: "D.210", unknown: "D.211", total: "D.212" },
};
export const TERMS: readonly TransferTerm[] = ["fall", "winter", "spring", "summer"];
export const D3_CODES: Record<TransferTerm, CdsCode> = { fall: "D.301", winter: "D.302", spring: "D.303", summer: "D.304" };
export const D4 = { required: "D.401", number: "D.402", unit: "D.403" } as const;
export const MATERIALS = [
  "high_school_transcript",
  "college_transcript",
  "essay",
  "interview",
  "standardized_tests",
  "statement_of_good_standing",
] as const satisfies readonly (keyof TransferMaterials)[];
export type TransferMaterial = (typeof MATERIALS)[number];
export const D5_CODES: Record<TransferMaterial, CdsCode> = {
  high_school_transcript: "D.501",
  college_transcript: "D.502",
  essay: "D.503",
  interview: "D.504",
  standardized_tests: "D.505",
  statement_of_good_standing: "D.506",
};
export const D6 = "D.601";
export const D7 = "D.701";
const DATE_KINDS = ["priority", "closing", "notification", "reply"] as const;
type DateKind = (typeof DATE_KINDS)[number];
/** D9: month codes; the day is the next code. Terms in fall, winter, spring, summer order, two codes apart. */
const D9_MONTH_BASE: Record<DateKind, number> = { priority: 901, closing: 909, notification: 917, reply: 925 };
export function d9Codes(term: TransferTerm, kind: DateKind): { month: CdsCode; day: CdsCode } {
  const m = D9_MONTH_BASE[kind] + TERMS.indexOf(term) * 2;
  return { month: `D.${m}`, day: `D.${m + 1}` };
}
export const D9_ROLLING: Record<TransferTerm, CdsCode> = { fall: "D.933", winter: "D.934", spring: "D.935", summer: "D.936" };

/** Every section-D code this module reads (to find the newest document with any answer). */
export const TRANSFER_CODES: readonly CdsCode[] = [
  D1.enrolls,
  D1.advanced,
  ...D2_ROWS.flatMap((r) => D2_COLUMNS.map((c) => D2_CODES[r][c])),
  ...TERMS.map((t) => D3_CODES[t]),
  D4.required,
  D4.number,
  D4.unit,
  ...MATERIALS.map((m) => D5_CODES[m]),
  D6,
  D7,
  ...TERMS.flatMap((t) => [...DATE_KINDS.flatMap((k) => Object.values(d9Codes(t, k))), D9_ROLLING[t]]),
];

/** Labels for generated quotes on workbook cells (a cell's own quote is "Total | 864", which doesn't say which row). */
const ROW_LABEL: Record<TransferRow, string> = { applicants: "Transfer applicants", admitted: "Transfer applicants admitted", enrolled: "Transfer applicants enrolled" };
const MATERIAL_LABEL: Record<TransferMaterial, string> = {
  high_school_transcript: "High school transcript",
  college_transcript: "College transcript(s)",
  essay: "Essay or personal statement",
  interview: "Interview",
  standardized_tests: "Standardized test scores",
  statement_of_good_standing: "Statement of good standing",
};
const TERM_LABEL: Record<TransferTerm, string> = { fall: "Fall", winter: "Winter", spring: "Spring", summer: "Summer" };

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type TransferCheck =
  | "transfer-d1-consistency"
  | "transfer-d2-sum"
  | "transfer-d2-funnel"
  | "transfer-d2-vs-federal"
  | "transfer-d5-mark"
  | "transfer-d9-date"
  | "transfer-d9-order"
  | "transfer-range";

export interface TransferFailure {
  check: TransferCheck;
  detail: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** One D2 row from the document: null without a passed numeric total. */
export function readCounts(doc: DocumentRecord, row: TransferRow): TransferCounts | null {
  const codes = D2_CODES[row];
  const total = itemNumber(doc, codes.total);
  if (total === null) return null;
  return { men: itemNumber(doc, codes.men), women: itemNumber(doc, codes.women), unknown: itemNumber(doc, codes.unknown), total };
}

export type TransferFunnel = Record<TransferRow, TransferCounts | null>;

/**
 * D2's checks (`transfer-d2-sum`, `transfer-d2-funnel`, and `transfer-d2-vs-federal` when the federal count is known).
 * A row whose men and women are both blank prints only its total and isn't sum-checked; an otherwise filled row counts
 * a blank Unknown as 0.
 */
export function checkFunnel(f: TransferFunnel, federalCount?: number | null): TransferFailure[] {
  const out: TransferFailure[] = [];
  for (const r of D2_ROWS) {
    const c = f[r];
    if (!c || (c.men === null && c.women === null)) continue;
    const sum = (c.men ?? 0) + (c.women ?? 0) + (c.unknown ?? 0);
    if (Math.abs(sum - c.total) > TRANSFER_SUM_TOLERANCE) {
      out.push({ check: "transfer-d2-sum", detail: `${ROW_LABEL[r]}: men + women + unknown = ${fmt(sum)}, total ${fmt(c.total)} (${D2_CODES[r].total})` });
    }
  }
  const pairs: [TransferRow, TransferRow][] = [
    ["admitted", "applicants"],
    ["enrolled", "admitted"],
  ];
  for (const [lo, hi] of pairs) {
    for (const col of D2_COLUMNS) {
      const a = f[lo]?.[col] ?? null;
      const b = f[hi]?.[col] ?? null;
      if (a !== null && b !== null && a > b) {
        out.push({ check: "transfer-d2-funnel", detail: `${col}: ${lo} ${fmt(a)} > ${hi} ${fmt(b)} (${D2_CODES[lo][col]}, ${D2_CODES[hi][col]})` });
      }
    }
  }
  const enrolled = f.enrolled?.total ?? null;
  if (federalCount != null && federalCount > 0 && enrolled !== null && Math.abs(enrolled - federalCount) > federalCount * TRANSFER_FEDERAL_TOLERANCE) {
    out.push({
      check: "transfer-d2-vs-federal",
      detail: `CDS enrolled ${fmt(enrolled)} transfers vs ${fmt(federalCount)} federal new transfer-ins (more than ${TRANSFER_FEDERAL_TOLERANCE * 100}% apart)`,
    });
  }
  return out;
}

/** admitted ÷ applicants (4 decimals) when at least 10 were admitted and admitted ≤ applicants; null otherwise. */
export function transferAdmitRate(applicants: TransferCounts | null, admitted: TransferCounts | null): number | null {
  if (!applicants || !admitted || applicants.total <= 0 || admitted.total < TRANSFER_MIN_RATE_ADMITS || admitted.total > applicants.total) return null;
  return Math.round((admitted.total / applicants.total) * 10000) / 10000;
}

const LEVEL_WORDS: [RegExp, TransferRequirement][] = [
  [/required of some/g, "required_some"],
  [/recommended of some/g, "recommended_some"],
  [/not required/g, "not_required"],
  [/required(?: of all)?/g, "required"],
  [/recommended(?: of all)?/g, "recommended"],
];

/**
 * One D5 row's mark: exactly one of the five levels, or a failure for zero marks (an empty answer) or more than one
 * (two levels named, as a layout pass reports a row with two checked columns).
 */
export function parseRequirement(v: unknown): { level: TransferRequirement } | { failure: "zero" | "multiple" } {
  if (typeof v !== "string" || !v.trim()) return { failure: "zero" };
  let s = v.toLowerCase().replace(/\s+/g, " ");
  const found: TransferRequirement[] = [];
  for (const [re, level] of LEVEL_WORDS) {
    const n = s.match(re)?.length ?? 0;
    for (let i = 0; i < n; i++) found.push(level);
    s = s.replace(re, " ");
  }
  if (found.length === 0) return { failure: "zero" };
  if (found.length > 1) return { failure: "multiple" };
  return { level: found[0] };
}

/** D5 rows: each row on its own; a blank row in an answered grid is "zero marks" and fails. */
export function readMaterials(doc: DocumentRecord): { materials: TransferMaterials | null; failures: TransferFailure[]; rows: TransferMaterial[] } {
  const answered = MATERIALS.filter((m) => passedItem(doc, D5_CODES[m]));
  if (!answered.length) return { materials: null, failures: [], rows: [] };
  const failures: TransferFailure[] = [];
  const rows: TransferMaterial[] = [];
  const materials = Object.fromEntries(MATERIALS.map((m) => [m, null])) as unknown as TransferMaterials;
  for (const m of MATERIALS) {
    const it = doc.items[D5_CODES[m]];
    // A failed or unread row is the reader's to report; a blank (or missing) row in an answered grid has zero marks.
    if (it && it.status !== "passed" && it.status !== "blank" && it.status !== "not-found") continue;
    const r = parseRequirement(it?.status === "passed" ? it.v : null);
    if ("failure" in r) {
      failures.push({ check: "transfer-d5-mark", detail: `${MATERIAL_LABEL[m]} (${D5_CODES[m]}): ${r.failure === "zero" ? "no mark" : "more than one mark"}` });
      continue;
    }
    materials[m] = r.level;
    rows.push(m);
  }
  return { materials: rows.length ? materials : null, failures, rows };
}

const dayOfYear = (d: MonthDay) => [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][d.month - 1] + d.day;
/** True when `later` is on or after `earlier` within one application window (which may wrap the new year). */
export function inOrder(earlier: MonthDay, later: MonthDay): boolean {
  const gap = (dayOfYear(later) - dayOfYear(earlier) + 365) % 365;
  return gap <= TRANSFER_DATE_WINDOW_DAYS;
}

/** One term's D9 dates, or a failure (`transfer-d9-date` for an impossible date, `transfer-d9-order`). Null when blank. */
export function readTermDates(doc: DocumentRecord, term: TransferTerm): { dates: TransferTermDates | null; failures: TransferFailure[]; codes: CdsCode[] } {
  const failures: TransferFailure[] = [];
  const codes: CdsCode[] = [];
  const got: Partial<Record<DateKind, MonthDay | null>> = {};
  for (const k of DATE_KINDS) {
    const c = d9Codes(term, k);
    const m = itemNumber(doc, c.month);
    const d = itemNumber(doc, c.day);
    if (m === null && d === null) {
      got[k] = null;
      continue;
    }
    const md = m === null || d === null ? null : monthDay(`${m}/${d}`);
    if (!md) {
      failures.push({ check: "transfer-d9-date", detail: `${TERM_LABEL[term]} ${k} date ${m ?? "?"}/${d ?? "?"} isn't a calendar date (${c.month}, ${c.day})` });
      continue;
    }
    got[k] = md;
    codes.push(c.month, c.day);
  }
  const rolling = itemBoolean(doc, D9_ROLLING[term]) === true;
  if (rolling) codes.push(D9_ROLLING[term]);
  if (got.priority && got.closing && !inOrder(got.priority, got.closing)) {
    failures.push({ check: "transfer-d9-order", detail: `${TERM_LABEL[term]}: closing date ${got.closing.month}/${got.closing.day} is before the priority date ${got.priority.month}/${got.priority.day}` });
  }
  if (!rolling && got.notification && got.reply && !inOrder(got.notification, got.reply)) {
    failures.push({ check: "transfer-d9-order", detail: `${TERM_LABEL[term]}: reply date ${got.reply.month}/${got.reply.day} is before the notification date ${got.notification.month}/${got.notification.day}` });
  }
  if (failures.length) return { dates: null, failures, codes: [] };
  if (!codes.length) return { dates: null, failures, codes };
  return {
    dates: { priority: got.priority ?? null, closing: got.closing ?? null, notification: rolling ? "rolling" : (got.notification ?? null), reply: got.reply ?? null },
    failures,
    codes,
  };
}

/* ------------------------------------------------------------------ */
/* Record → block                                                      */
/* ------------------------------------------------------------------ */

/** A document has section D when any code this module reads passed. */
const hasSectionD = (doc: DocumentRecord) => TRANSFER_CODES.some((c) => passedItem(doc, c));

/** What happened to each group of the chosen document, for the run summary and tests. */
export interface TransferOutcome {
  edition: string | null;
  failures: TransferFailure[];
  /** D1 was blank and set from D2. */
  inferredEnrolls: boolean;
}

const QUOTE_MAX = 160;
const clip = (q: string) => (q.length <= QUOTE_MAX ? q : `${q.slice(0, QUOTE_MAX - 1)}…`);

/** A lineage record for `code`; workbook cells (whose own quote is "label | value") get the generated `quote`. */
function cite(doc: DocumentRecord, code: CdsCode, year: string, quote?: string, method: "extracted" | "derived" = "extracted"): LineageRecord {
  const rec = lineageFromItem(doc, code, { year, method });
  return quote && (rec.cell || method === "derived") ? { ...rec, quote: clip(quote) } : rec;
}

/**
 * The block and its lineage from a college's record: the newest document with any section-D answer. Returns a null
 * block when that document has nothing that passes.
 */
export function transferFromRecord(
  record: CollegeRecord,
  opts: { federalCount?: number | null } = {}
): { block: ReportedTransfer | null; lineage: Record<string, LineageRecord>; outcome: TransferOutcome } {
  const doc = [...record.documents].sort(compareDocuments).find(hasSectionD);
  const outcome: TransferOutcome = { edition: doc?.edition ?? null, failures: [], inferredEnrolls: false };
  if (!doc) return { block: null, lineage: {}, outcome };
  const edition = doc.years.edition ?? editionLabel(doc.edition);
  const fall = doc.years.fall ?? null;
  const cycle = doc.years["next-cycle"] ?? null;
  const lineage: Record<string, LineageRecord> = {};
  const P = (k: keyof ReportedTransfer) => `${TRANSFER_LINEAGE_PREFIX}${k}`;

  // D2 first: D1's inference and consistency key on it.
  let funnel: TransferFunnel = { applicants: readCounts(doc, "applicants"), admitted: readCounts(doc, "admitted"), enrolled: readCounts(doc, "enrolled") };
  const d2Failures = checkFunnel(funnel, opts.federalCount);
  if (d2Failures.length || !fall) {
    outcome.failures.push(...d2Failures);
    funnel = { applicants: null, admitted: null, enrolled: null };
  }
  for (const r of D2_ROWS) {
    const c = funnel[r];
    if (c) lineage[P(r)] = cite(doc, D2_CODES[r].total, fall!, `${ROW_LABEL[r]}, total: ${fmt(c.total)}`);
  }
  const admit_rate = transferAdmitRate(funnel.applicants, funnel.admitted);
  if (admit_rate !== null) {
    lineage[P("admit_rate")] = cite(
      doc,
      D2_CODES.admitted.total,
      fall!,
      `Transfer applicants: ${fmt(funnel.applicants!.total)}; admitted: ${fmt(funnel.admitted!.total)}`,
      "derived"
    );
  }

  // D1.
  let enrolls_transfers = itemBoolean(doc, D1.enrolls);
  const applied = funnel.applicants?.total ?? 0;
  if (enrolls_transfers === false && applied > 0) {
    outcome.failures.push({ check: "transfer-d1-consistency", detail: `D1 says no transfers are enrolled, but D2 reports ${fmt(applied)} transfer applicants` });
    enrolls_transfers = null;
  } else if (enrolls_transfers !== null) {
    lineage[P("enrolls_transfers")] = cite(doc, D1.enrolls, edition);
  } else if (applied > 0) {
    enrolls_transfers = true;
    outcome.inferredEnrolls = true;
    lineage[P("enrolls_transfers")] = cite(
      doc,
      D2_CODES.applicants.total,
      edition,
      `D1 left blank; inferred from D2: ${fmt(applied)} transfer applicants`,
      "derived"
    );
  }
  const advanced_standing = itemBoolean(doc, D1.advanced);
  if (advanced_standing !== null) lineage[P("advanced_standing")] = cite(doc, D1.advanced, edition);

  // D3.
  const termsOn = TERMS.filter((t) => itemBoolean(doc, D3_CODES[t]) === true);
  const terms = termsOn.length ? termsOn : null;
  if (terms) lineage[P("terms")] = cite(doc, D3_CODES[terms[0]], edition, `Terms a transfer student may enter: ${terms.map((t) => TERM_LABEL[t]).join(", ")}`);

  // D4.
  let min_credits = itemNumber(doc, D4.number);
  let min_credits_unit: string | null = null;
  if (min_credits !== null && (min_credits < 0 || min_credits > 200)) {
    outcome.failures.push({ check: "transfer-range", detail: `minimum credits ${min_credits} is outside 0–200 (${D4.number})` });
    min_credits = null;
  }
  if (min_credits !== null && itemBoolean(doc, D4.required) === false) min_credits = null;
  if (min_credits !== null) {
    lineage[P("min_credits")] = cite(doc, D4.number, edition, `Minimum number of credits completed to apply as a transfer: ${min_credits}`);
    min_credits_unit = itemText(doc, D4.unit);
    if (min_credits_unit !== null) lineage[P("min_credits_unit")] = cite(doc, D4.unit, edition, `Unit type: ${min_credits_unit}`);
  }

  // D5.
  const m = readMaterials(doc);
  outcome.failures.push(...m.failures);
  const required_materials = m.materials;
  if (required_materials) {
    const quote = m.rows.map((r) => `${MATERIAL_LABEL[r]}: ${itemText(doc, D5_CODES[r])}`).join("; ");
    lineage[P("required_materials")] = cite(doc, D5_CODES[m.rows[0]], edition, quote);
  }

  // D6, D7: a number on a 4.0 scale; "No minimum required" and other words are not a minimum.
  const gpa = (code: CdsCode, what: string): number | null => {
    const v = itemValue(doc, code);
    if (typeof v !== "number") return null;
    if (v <= 0 || v > 4) {
      outcome.failures.push({ check: "transfer-range", detail: `${what} ${v} isn't on a 4.0 scale (${code})${v > 4 && v <= 5 ? ": weighted, held for review" : ""}` });
      return null;
    }
    return v;
  };
  const min_hs_gpa = gpa(D6, "minimum high school GPA");
  if (min_hs_gpa !== null) lineage[P("min_hs_gpa")] = cite(doc, D6, edition, `Minimum high school GPA for transfer applicants: ${min_hs_gpa}`);
  const min_college_gpa = gpa(D7, "minimum college GPA");
  if (min_college_gpa !== null) lineage[P("min_college_gpa")] = cite(doc, D7, edition, `Minimum college GPA for transfer applicants: ${min_college_gpa}`);

  // D9, each term on its own.
  let dates: Partial<Record<TransferTerm, TransferTermDates>> | null = null;
  const dateCodes: CdsCode[] = [];
  const dateQuote: string[] = [];
  if (cycle) {
    for (const t of TERMS) {
      const r = readTermDates(doc, t);
      outcome.failures.push(...r.failures);
      if (!r.dates) continue;
      dates = { ...(dates ?? {}), [t]: r.dates };
      dateCodes.push(...r.codes);
      const parts = DATE_KINDS.flatMap((k) => {
        const v = r.dates![k];
        return v === null ? [] : [`${k} ${v === "rolling" ? "rolling" : `${v.month}/${v.day}`}`];
      });
      dateQuote.push(`${TERM_LABEL[t]}: ${parts.join(", ")}`);
    }
  }
  if (dates) lineage[P("dates")] = cite(doc, dateCodes[0], cycle!, `Transfer dates, ${dateQuote.join("; ")}`);

  const block: ReportedTransfer = {
    enrolls_transfers,
    advanced_standing,
    applicants: funnel.applicants,
    admitted: funnel.admitted,
    enrolled: funnel.enrolled,
    admit_rate,
    terms,
    min_credits,
    min_credits_unit,
    required_materials,
    min_hs_gpa,
    min_college_gpa,
    dates,
  };
  const any = Object.values(block).some((v) => v !== null);
  return { block: any ? block : null, lineage: any ? lineage : {}, outcome };
}

/**
 * The school with its transfer block from `record` (or without one). Idempotent: any previous block and its lineage
 * are removed first, and a school that ends with neither keeps its key order and serializes as before.
 */
export function mergeTransfer(school: School, record: CollegeRecord | undefined): School {
  const hadLineage = Object.keys(school.lineage ?? {}).some((k) => k.startsWith(TRANSFER_LINEAGE_PREFIX));
  let out: School = school;
  if (school.reported?.transfer || hadLineage) {
    const reported = { ...school.reported };
    delete reported.transfer;
    const lineage = Object.fromEntries(Object.entries(school.lineage ?? {}).filter(([k]) => !k.startsWith(TRANSFER_LINEAGE_PREFIX)));
    out = { ...school, reported, lineage };
    if (!Object.keys(reported).length) delete (out as Partial<School>).reported;
    if (!Object.keys(lineage).length) delete (out as Partial<School>).lineage;
  }
  if (!record) return out;
  const { block, lineage } = transferFromRecord(record, { federalCount: out.demographics.transfer_in?.count ?? null });
  if (!block) return out;
  return { ...out, lineage: { ...out.lineage, ...lineage }, reported: { ...out.reported, transfer: block } };
}
