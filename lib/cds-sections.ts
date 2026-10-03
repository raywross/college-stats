/**
 * The Common Data Set template as data, and the record shapes every round-3 reader writes
 * (specs/college-reported-round-3.md, Decisions 1–4).
 *
 * Every reader (template workbook, form PDF, model calls), every record, the model schema, and every display spec keys
 * values by the template's own codes ("C.101", "H.2A01", "C.8D"). Codes are stable within one template edition
 * (2025–26: 1,105 codes, identical across colleges' workbooks and the fillable PDF's field names); a new edition gets
 * its own table and a map from old codes to new.
 *
 * Pure module: no imports at all, so Node tests and client code can load it. The table itself
 * (data/reference/cds-template-2025-26.json, built by `npm run build-cds-template`) is passed in by the caller:
 * server code uses lib/cds-template.ts, scripts read the JSON. This keeps the ~300 KB table out of client bundles.
 */

/* ------------------------------------------------------------------ */
/* Codes and the template table                                        */
/* ------------------------------------------------------------------ */

/** A template code: section letter, a dot, then the item number and row ("C.101", "C.1201", "H.2A01", "C.8D", "A.0A"). */
export type CdsCode = string;

export const CDS_CODE = /^[A-J]\.(?:\d{3,4}|\d[A-Z](?:\d{2})?)$/;

export type CdsSection = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
export const CDS_SECTIONS: readonly CdsSection[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

/** The two model calls of Decision 4: section C, and everything else in scope. */
export type CallKey = "C" | "rest";
export const CALL_KEYS: readonly CallKey[] = ["C", "rest"];

/** Which call reads an item from a model-read document; `store` items are read only by the deterministic readers. */
export type CallAssignment = CallKey | "store";

/**
 * What kind of value an item holds, normalized from the template's own "Value type" column (which mixes formats:
 * "Whole Number or Round to Nearest Tenth" holds SAT scores, GPA-band shares, and ages). Decides the normalizer and
 * the universal type check (Decision 9).
 */
export type ValueType =
  | "count" // whole number ≥ 0 (students, sections, applications)
  | "percent" // a share, stored 0–1
  | "currency" // whole dollars ≥ 0
  | "decimal" // a non-negative number that needn't be whole (age, Carnegie units, credits, a ratio)
  | "gpa" // 0 < GPA ≤ 5
  | "sat-section" // 200–800
  | "sat-composite" // 400–1600
  | "act" // 1–36
  | "act-writing" // 2–12
  | "month" // 1–12, the month half of a split date
  | "day" // 1–31, the day half of a split date
  | "date" // one cell holding a month/day, stored "--MM-DD"
  | "yes-no" // a Yes/No answer
  | "check" // a checkbox: checked is true; an unchecked box is blank, never false
  | "choice" // one of a closed set of words ("Very Important", "Required of All", "On Campus")
  | "text"
  | "url";

export const VALUE_TYPES: readonly ValueType[] = [
  "count", "percent", "currency", "decimal", "gpa", "sat-section", "sat-composite", "act", "act-writing",
  "month", "day", "date", "yes-no", "check", "choice", "text", "url",
];

/**
 * The year an item describes, as a rule on the edition (Decision 2): items in one edition describe different years,
 * so a record carries a year per group, never one per document. Also the record's `years` key.
 */
export type YearRule =
  | "edition" // standing policy as of the edition: "2025–26"
  | "fall" // the edition's own fall: "Fall 2025" (C1–C12 counts, B1, B2, D2, F1, I)
  | "test-policy-cycle" // C8: students applying two falls out: "Fall 2027 applicants"
  | "next-cycle" // C13–C18, D9, H7–H11: the application cycle that opens next: "Fall 2026 cycle"
  | "next-year" // G: next academic year's prices: "2026–27"
  | "aid-year" // H1, H2, H2A, H6: read from H.101 per college: "2024–25 final", "2025–26 estimated"
  | "graduating-class" // H4–H5: "Class of 2025"
  | "cohort" // B4 block: six falls back: "Fall 2019 cohort"
  | "previous-cohort" // B5 block: seven falls back: "Fall 2018 cohort"
  | "retention" // B22: "Fall 2024 cohort to Fall 2025"
  | "prior-year"; // B3, J: degrees conferred the year before: "2024–25"

/** Record `years` keys are the year rules: one label per group of items sharing a rule. */
export type ItemGroupKey = YearRule;

export const YEAR_RULES: readonly YearRule[] = [
  "edition", "fall", "test-policy-cycle", "next-cycle", "next-year", "aid-year", "graduating-class", "cohort",
  "previous-cohort", "retention", "prior-year",
];

/** One template item, as data/reference/cds-template-2025-26.json lists it. */
export interface TemplateItem {
  code: CdsCode;
  /** The template's "US News PDF Tag": the fillable PDF form's field name for this item (null for formula totals). */
  tag: string | null;
  question: string;
  section: CdsSection;
  /** The CDS item the code belongs to: "C1", "C9", "H2A", "C8D", "B22"; all of section J is "J". */
  item: string;
  /** The template's own descriptors, as its ANSWER SHEET gives them (null where blank). */
  sub: string | null;
  category: string | null;
  group: string | null;
  cohort: string | null;
  residency: string | null;
  unit: string | null;
  gender: string | null;
  value_type: ValueType;
  call: CallAssignment;
  /** The spec slug that displays this item (specs/data-expansion/<slug>.md or specs/<slug>.md); null = store-only. */
  owner: string | null;
  /** Other specs that read this item besides its owner (e.g. religious-life for C7's religion row). */
  also?: string[];
  year_rule: YearRule;
}

/** The committed JSON file. */
export interface TemplateFile {
  edition: string;
  built: string;
  source: string;
  counts: { total: number; model: number; C: number; rest: number; store: number };
  items: TemplateItem[];
}

/** The loaded table with its indexes. */
export interface TemplateTable {
  edition: string;
  items: readonly TemplateItem[];
  byCode: ReadonlyMap<CdsCode, TemplateItem>;
  /** Items by CDS item ("C1" → its 30 codes), in template order. */
  byItem: ReadonlyMap<string, readonly TemplateItem[]>;
}

/** Indexes a parsed template file, refusing one whose codes or enums are malformed (the table drives every reader). */
export function loadTemplate(file: TemplateFile): TemplateTable {
  const byCode = new Map<CdsCode, TemplateItem>();
  const byItem = new Map<string, TemplateItem[]>();
  const types = new Set<string>(VALUE_TYPES);
  const rules = new Set<string>(YEAR_RULES);
  for (const it of file.items) {
    if (!CDS_CODE.test(it.code)) throw new Error(`template: malformed code "${it.code}"`);
    if (byCode.has(it.code)) throw new Error(`template: duplicate code ${it.code}`);
    if (!types.has(it.value_type)) throw new Error(`template: ${it.code} has unknown value_type "${it.value_type}"`);
    if (!rules.has(it.year_rule)) throw new Error(`template: ${it.code} has unknown year_rule "${it.year_rule}"`);
    if (it.call !== "C" && it.call !== "rest" && it.call !== "store") throw new Error(`template: ${it.code} has unknown call "${it.call}"`);
    if (it.call === "store" && it.owner) throw new Error(`template: ${it.code} is store-only but owned by ${it.owner}`);
    if (it.call !== "store" && !it.owner) throw new Error(`template: ${it.code} is in the model schema but has no owner`);
    byCode.set(it.code, it);
    const list = byItem.get(it.item) ?? [];
    list.push(it);
    byItem.set(it.item, list);
  }
  return { edition: file.edition, items: file.items, byCode, byItem };
}

/** Parts of a code for ordering and item derivation: "H.2A01" → ["H", 2, "A", 1]; "C.1201" → ["C", 12, "", 1]. */
function codeParts(code: CdsCode): [string, number, string, number] {
  const [section, body] = code.split(".");
  const lettered = /^(\d)([A-Z])(\d{2})?$/.exec(body);
  if (lettered) return [section, Number(lettered[1]), lettered[2], lettered[3] ? Number(lettered[3]) : 0];
  // Three digits: a one-digit item and a two-digit row (C.101); four digits: a two-digit item (C.1201).
  const item = body.length === 3 ? body.slice(0, 1) : body.slice(0, 2);
  return [section, Number(item), "", Number(body.slice(item.length))];
}

/** The CDS item a code belongs to ("C.101" → "C1", "C.1201" → "C12", "H.2A01" → "H2A", "C.8D" → "C8D"). */
export function itemOfCode(code: CdsCode): string {
  const [section, n, letter, row] = codeParts(code);
  // Section J is one table (degrees by field, three award levels) whose 120 codes run J.101–J.220.
  if (section === "J") return "J";
  // H0 (aid year and methodology, formerly H3) was numbered into H1's code range: H.101–H.104.
  if (section === "H" && n === 1 && !letter && row <= 4) return "H0";
  return `${section}${n}${letter}`;
}

/** Template order: section, item number, item letter, row. */
export function compareCodes(a: CdsCode, b: CdsCode): number {
  const x = codeParts(a);
  const y = codeParts(b);
  for (let i = 0; i < 4; i++) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Records: data/cds-records/<unit_id>.json (Decision 2)               */
/* ------------------------------------------------------------------ */

/** Decided from the bytes, never the URL (Decision 3). */
export type DocumentType = "xlsx-template" | "xlsx-classic" | "pdf-form" | "pdf-flat" | "pdf-scanned" | "html" | "class-profile";
export const DOCUMENT_TYPES: readonly DocumentType[] = ["xlsx-template", "xlsx-classic", "pdf-form", "pdf-flat", "pdf-scanned", "html", "class-profile"];

/**
 * passed: publishable. failed: goes to review. blank: the college left it empty or wrote a placeholder (known only from
 * deterministic reads). not-found: a model read found no value. not-read: a store-only item in a model-read document.
 */
export type ItemStatus = "passed" | "failed" | "blank" | "not-found" | "not-read";
export const ITEM_STATUSES: readonly ItemStatus[] = ["passed", "failed", "blank", "not-found", "not-read"];

export interface ItemFailure {
  /** A check id ("type-range", "form-vs-code", "aid-year", …; per-item checks live in lib/cds-checks.ts). */
  check: string;
  detail: string;
}

/** One item of one document. */
export interface ItemResult {
  /**
   * The normalized value: numbers as numbers (percent items as a 0–1 share), yes/no and checkboxes as booleans, a
   * one-cell date as "--MM-DD", text as text (including text a college typed in a numeric cell: "varies").
   */
  v?: number | string | boolean | null;
  /** Where it is: PDF page and numbered layout line(s), or the workbook cell ("CDS-C!AC5"), or the form field name. */
  page?: number;
  line?: number;
  lines?: number[];
  cell?: string;
  field?: string;
  /** Verbatim text (≤ 160 characters), kept for items an owning spec displays. */
  quote?: string;
  status: ItemStatus;
  failures?: ItemFailure[];
  /** "derived" when code computed the value from printed parts (a "##" total summed from its rows); absent = as printed. */
  method?: "reported" | "derived";
  /** When a workbook's visible form disagrees with its code table: the form's value and cell, kept beside the code's. */
  form?: { v: number | string | boolean | null; cell: string };
  /**
   * When the checks published the visible form's value instead (lib/cds-checks.ts: the form passed every check of its
   * group, the code table didn't): the code table's value, cell, and quote as read, so both values stay in the record.
   */
  code_table?: { v: number | string | boolean | null; cell?: string; quote?: string };
}

/** How one part of a document was read. */
export interface CallRead {
  /** The model schema version (SCHEMA_VERSIONS) or, for a deterministic read, the reader's version (READER_VERSIONS). */
  schema_version: number;
  /** A model id ("claude-haiku-4-5") or a deterministic reader ("xlsx-template", "pdf-form"). */
  read_by: string;
  mode: "batch" | "interactive" | "deterministic";
  batch?: string;
  /** ISO date of the read. */
  extracted: string;
  /** First and last page the call read. */
  pages?: [number, number];
  stop?: string;
}

/** One archived document and everything read from it. */
export interface DocumentRecord {
  sha256: string;
  /** The CDS edition the document states about itself, "2025-26". */
  edition: string;
  type: DocumentType;
  url: string;
  final_url?: string;
  /** ISO date the bytes were fetched (or dropped by the owner). */
  retrieved: string;
  /** Model calls by key, plus `deterministic` for a template-workbook or form-PDF read. */
  reads: Partial<Record<CallKey | "deterministic", CallRead>>;
  /** The year label of every item group this document has values for (yearsForEdition). */
  years: Partial<Record<ItemGroupKey, string>>;
  items: Record<CdsCode, ItemResult>;
}

/** One college's file: its documents, newest edition first. */
export interface CollegeRecord {
  unit_id: string;
  documents: DocumentRecord[];
}

/* ------------------------------------------------------------------ */
/* Manifest: data/college-docs.json (Decision 1)                       */
/* ------------------------------------------------------------------ */

/** One fetched document, keyed by the sha256 of its bytes. */
export interface ManifestEntry {
  sha256: string;
  unit_id: string;
  url: string;
  final_url?: string;
  kind: "cds" | "class-profile";
  type: DocumentType;
  edition: string | null;
  /** Where the edition came from: the cover, item text, the workbook's own cells, or a person. */
  edition_from?: "cover" | "items" | "workbook" | "manual";
  retrieved: string;
  bytes: number;
  pages?: number;
  body_chars?: number;
  definitions_from_page?: number;
  /** Page range each section was found on: next year's hint. */
  sections?: Partial<Record<CdsSection, [number, number]>>;
  /** Where the archive keeps the bytes ("gh:docs-2026-10/<sha>.pdf", "local:<sha>.xlsx"); null before archiving. */
  archive: string | null;
}

export interface CollegeDocsFile {
  updated: string | null;
  documents: ManifestEntry[];
}

/* ------------------------------------------------------------------ */
/* Editions and years per item group                                   */
/* ------------------------------------------------------------------ */

/** "2025-26", "2025–26", "2025-2026" (or "2025/26") → { start: 2025, key: "2025-26" }; null for anything else. */
export function parseEdition(edition: string | null | undefined): { start: number; key: string } | null {
  const m = /^\s*(20\d{2})\s*[-–—/]\s*(\d{2}|\d{4})\s*$/.exec(edition ?? "");
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2].length === 2 ? `${m[1].slice(0, 2)}${m[2]}` : m[2]);
  if (end !== start + 1) return null;
  return { start, key: `${start}-${String(end).slice(2)}` };
}

/** "2025–26" with an en dash, the display form. */
const academicYear = (start: number) => `${start}–${String(start + 1).slice(2)}`;

/** The aid year a college states in H.101 (H0): which academic year H1, H2, H2A and H6 describe, and whether final. */
export interface AidYear {
  start: number;
  status: "estimated" | "final";
}

/**
 * "2024-2025 Final", "2025-2026 Estimated", "2025-26 Est." → AidYear. Anything else (Howard's "2023", a blank) is null:
 * the aid figures then have no year and can't be published (cds-financial-aid.md).
 */
export function parseAidYear(raw: unknown): AidYear | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*(20\d{2})\s*[-–]\s*(\d{2}|\d{4})\s+(final|estimated|estimate|est\.?)\s*$/i.exec(raw);
  if (!m) return null;
  const ed = parseEdition(`${m[1]}-${m[2]}`);
  if (!ed) return null;
  return { start: ed.start, status: /^final$/i.test(m[3]) ? "final" : "estimated" };
}

/**
 * What each year rule describes, and its label for an edition starting in fall `y`. The labels are what lineage
 * records carry as `year`, so the UI never writes a year itself.
 */
export const ITEM_GROUPS: Record<ItemGroupKey, { describes: string; label: (y: number, aid?: AidYear) => string | null }> = {
  edition: { describes: "Standing policy as of the edition (A, C3–C6, C15, C19, C21–C22 dates, D policies, E, F2–F4, H0 methodology, H12–H15)", label: (y) => academicYear(y) },
  fall: { describes: "The edition's own fall: C1, C2, C7, C9–C12, C21 counts, B1, B2, D2, F1, I", label: (y) => `Fall ${y}` },
  "test-policy-cycle": { describes: "C8 test policy: students applying two falls out", label: (y) => `Fall ${y + 2} applicants` },
  "next-cycle": { describes: "C13–C14, C16–C18, D9, H7–H11: the application cycle that opens next", label: (y) => `Fall ${y + 1} cycle` },
  "next-year": { describes: "G: next academic year's prices", label: (y) => academicYear(y + 1) },
  "aid-year": { describes: "H1, H2, H2A, H6: the aid year the college states in H.101", label: (_y, aid) => (aid ? `${academicYear(aid.start)} ${aid.status}` : null) },
  "graduating-class": { describes: "H4–H5: the bachelor's class that graduated in the year before the edition", label: (y) => `Class of ${y}` },
  cohort: { describes: "B4–B11 current grid: the cohort six falls back", label: (y) => `Fall ${y - 6} cohort` },
  "previous-cohort": { describes: "B4–B11 previous grid (B5 block): seven falls back", label: (y) => `Fall ${y - 7} cohort` },
  retention: { describes: "B22: last fall's first-years, still enrolled this fall", label: (y) => `Fall ${y - 1} cohort to Fall ${y}` },
  "prior-year": { describes: "B3, J: degrees conferred in the academic year before the edition", label: (y) => academicYear(y - 1) },
};

/**
 * The year label of every item group for an edition. `aidYear` is H.101's raw text; the aid-year group is left out
 * when it doesn't parse, so its items can't be published (validateCdsRecords requires a year for each passed item).
 */
export function yearsForEdition(edition: string, opts: { aidYear?: string | null } = {}): Partial<Record<ItemGroupKey, string>> {
  const ed = parseEdition(edition);
  if (!ed) throw new Error(`not a CDS edition: "${edition}"`);
  const aid = parseAidYear(opts.aidYear) ?? undefined;
  const out: Partial<Record<ItemGroupKey, string>> = {};
  for (const key of YEAR_RULES) {
    const label = ITEM_GROUPS[key].label(ed.start, aid);
    if (label) out[key] = label;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Normalizing values (Decision 3)                                     */
/* ------------------------------------------------------------------ */

/** A month/day with no year: the year lives in the item group's lineage label. */
export interface MonthDay {
  month: number;
  day: number;
}

/**
 * A normalized raw value. `value`: a number, boolean, or string of the item's type. `blank`: empty or a placeholder.
 * `text`: words in a typed cell ("varies", "$50/$75", "Early April"), kept verbatim, never coerced. `overflow`: a total
 * printed as "##" (Excel's overflow marks), which the caller sums from its parts.
 */
export type Normalized =
  | { status: "value"; v: number | string | boolean }
  | { status: "text"; v: string }
  | { status: "blank"; v: null }
  | { status: "overflow"; v: null };

const BLANK: Normalized = { status: "blank", v: null };

const PLACEHOLDER = /^(?:-+|–|—|n\/?a|n\/av|not applicable|x{3,}|yes or no|\.)$/i;

/** Empty cells and the placeholders colleges write for "nothing here": "-", "N/A", "N/Av", "XXXXX", "Yes or No". */
export function isPlaceholder(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  return s === "" || PLACEHOLDER.test(s);
}

/**
 * A checkbox or yes/no mark: true for "X", "x", "✔", "✓", "☒", "☑", "Yes", "Y", and private-use glyphs (Spelman's
 * check font); false for "No", "N"; null for an unchecked box ("☐") or anything else.
 */
export function readMark(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^(?:x|yes|y|true|✔|✓|☒|☑|✗)$/i.test(s)) return true;
  if (s.length === 1 && s.charCodeAt(0) >= 0xe000 && s.charCodeAt(0) <= 0xf8ff) return true;
  if (/^(?:no|n|false)$/i.test(s)) return false;
  return null;
}

/**
 * A number from a cell, joining digits a printer split ("$3 4 , 604" → 34604) and dropping "$", ",", and spaces.
 * Null when the text isn't one number.
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[$,\s]/g, "");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}

/** Dividing by 100 leaves float noise (27.4 / 100 = 0.27399999999999997); shares never need more than 10 places. */
const per100 = (n: number) => Math.round(n * 1e8) / 1e10;

/** A percent as a 0–1 share: 0.274, 27.4, "27.4%", "1%%", "0.61%" → 0.0061. Null when it isn't one. */
function percentShare(raw: unknown): number | null {
  if (typeof raw === "string" && /%/.test(raw)) {
    const n = parseNumber(raw.replace(/%+/g, ""));
    return n === null ? null : per100(n);
  }
  const n = parseNumber(raw);
  if (n === null) return null;
  // Excel percent cells hold fractions (0.274); typed percents are 27.4. A share can't exceed 1 by much (totals of
  // 1.0001 occur), so anything over 1.5 is a percent. Ambiguous small percents ("0.61" meaning 0.61%, Howard's F1)
  // can only be told apart per column, by the owning spec's checks.
  return n > 1.5 ? per100(n) : n;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** "Nov", "Nov.", "November", "Sept" → 11, 11, 11, 9; null for anything that isn't a month name of 3+ letters. */
const monthOf = (word: string): number | null => {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w === "sept") return 9;
  const i = w.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(w)) : -1;
  return i < 0 ? null : i + 1;
};
const valid = (month: number, day: number): MonthDay | null =>
  Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN[month - 1] ? { month, day } : null;

/** Excel serial date (days since 1899-12-30) → month/day. */
function fromSerial(serial: number): MonthDay | null {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return valid(d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * One month/day from a cell: "--04-01", "11/1", "1-Nov", "1 Nov", "Nov 1st", "Nov. 1", "November 1", "Feb. 15"; with
 * `excel`, a serial number (William & Mary's C16 "46113" → April 1). Null for anything that isn't exactly one calendar
 * date ("mid-Dec", "Early April", "11 months 1 day").
 */
export function monthDay(raw: unknown, opts: { excel?: boolean } = {}): MonthDay | null {
  if (typeof raw === "number" || (typeof raw === "string" && /^\s*\d{4,5}\s*$/.test(raw))) {
    const n = Number(raw);
    return opts.excel && Number.isInteger(n) && n >= 367 && n <= 80000 ? fromSerial(n) : null;
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = /^--(\d{2})-(\d{2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})\s*[/-]\s*(\d{1,2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]+\.?)$/.exec(s);
  if (m) {
    const mo = monthOf(m[2]);
    return mo ? valid(mo, Number(m[1])) : null;
  }
  m = /^([A-Za-z]+\.?)\s*(\d{1,2})(?:st|nd|rd|th)?$/.exec(s);
  if (m) {
    const mo = monthOf(m[1]);
    return mo ? valid(mo, Number(m[2])) : null;
  }
  return null;
}

/** The stored form of a one-cell date: "--04-01" (ISO 8601's year-less month-day). */
export const formatMonthDay = (d: MonthDay) => `--${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

const NUMERIC: ReadonlySet<ValueType> = new Set(["count", "currency", "decimal", "gpa", "sat-section", "sat-composite", "act", "act-writing", "day"]);

/**
 * Normalizes one raw cell or model value by the item's value type. `excel`: the value came from a workbook cell, so a
 * bare integer in a date cell is a serial date.
 */
export function normalizeValue(item: Pick<TemplateItem, "value_type">, raw: unknown, opts: { excel?: boolean } = {}): Normalized {
  if (raw === null || raw === undefined) return BLANK;
  if (typeof raw === "string") {
    const s = raw.replace(/\s+/g, " ").trim();
    if (isPlaceholder(s)) return BLANK;
    raw = s;
  }
  const t = item.value_type;
  if (typeof raw === "string" && /^#{2,}$/.test(raw) && (NUMERIC.has(t) || t === "percent")) return { status: "overflow", v: null };
  const text = (): Normalized => ({ status: "text", v: String(raw) });
  if (NUMERIC.has(t)) {
    const n = parseNumber(raw);
    return n === null ? text() : { status: "value", v: n };
  }
  switch (t) {
    case "percent": {
      const n = percentShare(raw);
      return n === null ? text() : { status: "value", v: n };
    }
    case "month": {
      const n = parseNumber(raw) ?? (typeof raw === "string" ? monthOf(raw) : null);
      return n === null ? text() : { status: "value", v: n };
    }
    case "date": {
      const d = monthDay(raw, opts);
      return d ? { status: "value", v: formatMonthDay(d) } : text();
    }
    case "yes-no": {
      const b = readMark(raw);
      return b === null ? text() : { status: "value", v: b };
    }
    case "check": {
      if (typeof raw === "string" && /^☐$/.test(raw)) return BLANK;
      const b = readMark(raw);
      return b === null ? text() : { status: "value", v: b };
    }
    default:
      // choice, text, url: words stay words (a number typed in a text cell is kept as its digits)
      return { status: "value", v: typeof raw === "string" ? raw : String(raw) };
  }
}

/**
 * The universal type check of Decision 9 for a normalized number: percentages 0–100 (as a share, totals to 101%),
 * counts whole and ≥ 0 (catches Vanderbilt's 0.97 in a count), money ≥ 0, GPA 0–5, SAT section 200–800, composite
 * 400–1600, ACT 1–36, and months and days of the calendar. Null when the value fits; text and booleans aren't checked.
 */
export function typeFailure(item: Pick<TemplateItem, "value_type">, v: unknown): ItemFailure | null {
  if (typeof v !== "number") return null;
  const fail = (detail: string): ItemFailure => ({ check: "type-range", detail });
  const between = (lo: number, hi: number, what: string) => (v >= lo && v <= hi ? null : fail(`${what} ${v} is outside ${lo}–${hi}`));
  switch (item.value_type) {
    case "count":
      return Number.isInteger(v) && v >= 0 ? null : fail(`count ${v} is not a whole number ≥ 0`);
    case "percent":
      return between(0, 1.01, "share");
    case "currency":
    case "decimal":
      return v >= 0 ? null : fail(`${item.value_type} ${v} is negative`);
    case "gpa":
      return v > 0 && v <= 5 ? null : fail(`GPA ${v} is outside 0–5`);
    case "sat-section":
      return between(200, 800, "SAT section score");
    case "sat-composite":
      return between(400, 1600, "SAT composite");
    case "act":
      return between(1, 36, "ACT score");
    case "act-writing":
      return between(2, 12, "ACT Writing score");
    case "month":
      return Number.isInteger(v) && v >= 1 && v <= 12 ? null : fail(`month ${v} is not 1–12`);
    case "day":
      return Number.isInteger(v) && v >= 1 && v <= 31 ? null : fail(`day ${v} is not 1–31`);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* The model schema (Decision 4)                                       */
/* ------------------------------------------------------------------ */

/** Bump a call's version when its codes or labels change; records read at an older version are re-read from the archive. */
export const SCHEMA_VERSIONS: Record<CallKey, number> = { C: 1, rest: 1 };

/** Deterministic readers' versions: a bump re-runs them over the archive for $0. */
export const READER_VERSIONS: Record<string, number> = { "xlsx-template": 1, "pdf-form": 1 };

/** About twice the expected output of each call (~4 K and ~8 K tokens with line ids). */
export function maxTokensFor(call: CallKey): number {
  return call === "C" ? 8192 : 16384;
}

/** The codes one model call asks for, in template order. */
export function codesFor(table: TemplateTable, call: CallKey): CdsCode[] {
  return table.items.filter((it) => it.call === call).map((it) => it.code);
}

/** Codes read only by deterministic readers (no owning spec): `not-read` in model-read documents. */
export function storeOnlyCodes(table: TemplateTable): CdsCode[] {
  return table.items.filter((it) => it.call === "store").map((it) => it.code);
}

/**
 * The structured-output JSON schema for one call: an object keyed by template code, every property optional (codes the
 * model doesn't find are left out), each `{ v, lines }` with the value and the numbered line(s) it sits on. No numeric
 * or length constraints (structured outputs reject them; ranges are checked in code), `additionalProperties: false` on
 * every object.
 */
export function schemaFor(table: TemplateTable, call: CallKey) {
  const value = {
    type: "object",
    additionalProperties: false,
    required: ["v", "lines"],
    properties: {
      v: { type: ["number", "string", "boolean", "null"] },
      lines: { type: "array", items: { type: "integer" } },
    },
  } as const;
  const properties: Record<CdsCode, typeof value> = {};
  for (const code of codesFor(table, call)) properties[code] = value;
  return { type: "object", additionalProperties: false, properties } as const;
}

/**
 * The code table a call's static prompt carries: one line per code, "C.101 | Total first-time, first-year males who
 * applied | count". The labels live here rather than in the schema so the cached prefix holds them once.
 */
export function codeTableText(table: TemplateTable, call: CallKey): string {
  return table.items
    .filter((it) => it.call === call)
    .map((it) => `${it.code} | ${it.question.replace(/\s+/g, " ").trim()} | ${it.value_type}`)
    .join("\n");
}
