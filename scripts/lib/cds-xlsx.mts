/**
 * Reading a college's Common Data Set from the official Excel template, shared by `npm run import-cds` (which writes
 * data/overrides.json) and `npm run sync-college-reported` (which reads section C1 deterministically, without a
 * model). The .xlsx is a zip of XML read with the system `unzip`. Older and custom workbooks are read by row label;
 * the 2025–26 template is read by code (readTemplate, recordFromTemplate: specs/college-reported-round-3.md).
 */
import { execFileSync } from "node:child_process";
import {
  CDS_CODE,
  isPlaceholder,
  normalizeValue,
  parseAidYear,
  parseEdition,
  parseNumber,
  READER_VERSIONS,
  readMark,
  typeFailure,
  yearsForEdition,
  type CdsCode,
  type DocumentRecord,
  type ItemFailure,
  type ItemResult,
  type TemplateTable,
} from "../../lib/cds-sections.ts";

export type Cell = { col: string; value: string | number };
export type Sheet = Map<number, Cell[]>;
/** Sheets keyed by upper-cased name, with "CSD-" typos normalized to "CDS-" ("CDS-B", "CDS-C", "CDS-H"). */
export type Workbook = Map<string, Sheet>;

function decode(xml: string): string {
  return xml
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function readZipEntry(zip: string, entry: string): string {
  try {
    return execFileSync("unzip", ["-p", zip, entry], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** Every sheet of an .xlsx file on disk. */
export function readWorkbook(zip: string): Workbook {
  const shared = [...readZipEntry(zip, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
  );
  const rels = new Map(
    [...readZipEntry(zip, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(
      (m) => [m[1], m[2].replace(/^\/?xl\//, "")]
    )
  );
  const sheets: Workbook = new Map();
  for (const m of readZipEntry(zip, "xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels.get(m[2]);
    if (!target) continue;
    const xml = readZipEntry(zip, `xl/${target}`);
    const sheet: Sheet = new Map();
    for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, row, attrs, body = ""] = c;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value: string | number | undefined;
      if (type === "s") value = shared[Number(/<v>([^<]*)<\/v>/.exec(body)?.[1])];
      else if (type === "inlineStr") value = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else if (type === "str") value = decode(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "");
      else {
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        value = v === undefined || v === "" ? undefined : Number(v);
      }
      if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) continue;
      const r = Number(row);
      if (!sheet.has(r)) sheet.set(r, []);
      sheet.get(r)!.push({ col, value });
    }
    sheets.set(m[1].trim().toUpperCase().replace(/^CSD-/, "CDS-"), sheet);
  }
  return sheets;
}

/* ------------------------------------------------------------------ */
/* Label-based lookups                                                 */
/* ------------------------------------------------------------------ */

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** First row with a text cell starting with `label` that also has numbers. */
export function row(sheet: Sheet | undefined, label: string): Cell[] | null {
  if (!sheet) return null;
  const needle = norm(label);
  for (const r of [...sheet.keys()].sort((a, b) => a - b)) {
    const cells = sheet.get(r)!;
    if (cells.some((c) => typeof c.value === "string" && norm(c.value).startsWith(needle)) && cells.some((c) => typeof c.value === "number")) {
      return cells;
    }
  }
  return null;
}

export const numbers = (cells: Cell[] | null) => (cells ?? []).filter((c) => typeof c.value === "number").map((c) => c.value as number);
export const inCol = (cells: Cell[] | null, col: string) => {
  const c = cells?.find((x) => x.col === col && typeof x.value === "number");
  return c ? (c.value as number) : null;
};
/** Percent values appear as 0.274 or 27.4 depending on the college. */
export const frac = (v: number | null | undefined) => (v === null || v === undefined ? null : v > 1.5 ? v / 100 : v);
export const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Newer CDS templates (and a hidden table in some classic ones) include
 * machine-readable items: a question code cell ("C117", "C.905", "H2A01"),
 * then the label, then the value. Within one template edition the codes are
 * stable (the 2025–26 template's 1,105 codes are identical across colleges'
 * workbooks; readTemplate below reads by code). These label lookups serve
 * older and custom workbooks, whose codes differ by edition; `occurrence`
 * picks among repeats (e.g. H2 lists first-years, then full-time, then
 * part-time undergraduates).
 */
const CODE = /^[A-J]\d?A?\.?\d{2,5}$/;
const toNum = (v: string | number | undefined): number | null => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[,$%\s]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};
const stripLetter = (s: string) => norm(s).replace(/^[a-z]\.\s*/, "");

export type FlatItem = { label: string; value: number | null };

export function flatItems(sheet: Sheet | undefined): FlatItem[] {
  const items: FlatItem[] = [];
  for (const r of [...(sheet?.keys() ?? [])].sort((a, b) => a - b)) {
    const cells = sheet!.get(r)!;
    cells.forEach((c, i) => {
      const next = cells[i + 1];
      if (typeof c.value === "string" && CODE.test(c.value.trim()) && next && typeof next.value === "string" && !CODE.test(next.value.trim())) {
        items.push({ label: stripLetter(next.value), value: toNum(cells[i + 2]?.value) });
      }
    });
  }
  return items;
}

export function flat(items: FlatItem[], label: string, occurrence: number | "last" = 1): number | null {
  const hits = items.filter((it) => it.label.startsWith(norm(label)));
  const hit = occurrence === "last" ? hits.at(-1) : hits[occurrence - 1];
  return hit?.value ?? null;
}

/** Column holding full-time undergraduates in the H2 table (template: E). */
export function fullTimeUndergradCol(sheet: Sheet | undefined): string {
  for (const cells of sheet?.values() ?? []) {
    const hit = cells.find((c) => typeof c.value === "string" && norm(c.value).startsWith("full-time undergrad"));
    if (hit) return hit.col;
  }
  return "E";
}

/* ------------------------------------------------------------------ */
/* C1: applied / admitted / enrolled                                   */
/* ------------------------------------------------------------------ */

export type C1Verb = "applied" | "were admitted" | "enrolled";

/**
 * One C1 total, cross-checked against the gender rows and (classic layout) the residency columns on the same row.
 * Colleges' own files contain typos; when two independent breakdowns agree with each other but not the total, trust
 * them. Notes about disagreements are pushed onto `warnings`.
 */
export function c1Total(C: Sheet | undefined, FC: FlatItem[], verb: C1Verb, warnings: string[]): number | null {
  const classicRow = numbers(row(C, `Total first-time, first-year who ${verb}`));
  const total = flat(FC, `Total first-time, first-year students who ${verb}`) ?? classicRow[0] ?? null;
  const genders = ["men", "women", "another gender", "unknown gender"].map((g) => {
    const label = verb === "enrolled" ? null : `Total first-time, first-year ${g} who ${verb}`;
    return label ? (flat(FC, label) ?? numbers(row(C, label))[0] ?? 0) : 0;
  });
  const byGender = genders.reduce((a, b) => a + b, 0) || null;
  const byResidency = classicRow.length >= 4 ? classicRow.slice(1).reduce((a, b) => a + b, 0) : null;
  const off = (x: number | null) => x !== null && total !== null && Math.abs(x - total) / total > 0.01;
  if (total !== null && byGender !== null && byResidency !== null && off(byGender) && Math.abs(byGender - byResidency) <= 1) {
    warnings.push(`C1 "${verb}" total ${total} disagrees with its breakdowns (${byGender}); using ${byGender}.`);
    return byGender;
  }
  if (total !== null && byGender !== null && off(byGender)) {
    warnings.push(`C1 "${verb}" total ${total} differs from the gender rows (${byGender}); kept the total. Check the file.`);
  }
  return total;
}

/** C1's three totals from a workbook (null where not found), with any cross-check warnings. */
export function readC1(book: Workbook): { applicants: number | null; admitted: number | null; enrolled: number | null; warnings: string[] } {
  const C = book.get("CDS-C");
  const FC = flatItems(C);
  const warnings: string[] = [];
  return {
    applicants: c1Total(C, FC, "applied", warnings),
    admitted: c1Total(C, FC, "were admitted", warnings),
    enrolled: c1Total(C, FC, "enrolled", warnings),
    warnings,
  };
}

/**
 * The CDS edition a workbook states about itself ("Common Data Set 2025-2026" → "2025-26"), from any text cell that
 * names the Common Data Set with a year range; null when none does.
 */
export function workbookEdition(book: Workbook): string | null {
  for (const sheet of book.values()) {
    for (const cells of sheet.values()) {
      for (const c of cells) {
        if (typeof c.value !== "string" || !/common data set/i.test(c.value)) continue;
        const m = /(20\d{2})\s*[-–/]\s*(?:20)?(\d{2})\b/.exec(c.value);
        if (m) return `${m[1]}-${m[2]}`;
      }
    }
  }
  return null;
}

/** A sheet as plain text, one row per line (cells joined with " | "), for a model fallback when C1 isn't found. */
export function sheetText(sheet: Sheet | undefined): string {
  if (!sheet) return "";
  return [...sheet.keys()]
    .sort((a, b) => a - b)
    .map((r) => sheet.get(r)!.map((c) => String(c.value)).join(" | "))
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* The 2025–26 template workbook, read by code (round 3, Decision 3)   */
/* ------------------------------------------------------------------ */

const TEMPLATE_SHEETS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((s) => `CDS-${s}`);

/** A 2025–26 template workbook: sheets CDS-A … CDS-J (each with its code table) plus the ANSWER SHEET. */
export function isTemplateWorkbook(book: Workbook): boolean {
  return TEMPLATE_SHEETS.every((s) => book.has(s)) && book.has("ANSWER SHEET");
}

const colNumber = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** One code's answer as the workbook holds it, before normalizing. */
export interface TemplateCell {
  /** The cell's value; null when the cell is empty. */
  raw: string | number | null;
  /** "CDS-C!AC5" or "ANSWER SHEET!F269". */
  cell: string;
  sheet: string;
  source: "code-table" | "answer-sheet";
  /** The question text beside the answer, verbatim from this workbook (for quotes). */
  label: string;
}

/** A visible-form value that the code table doesn't match (or leaves empty). */
export interface FormVsCode {
  code: CdsCode;
  codeValue: string | number | null;
  formValue: string | number;
  formCell: string;
}

export interface TemplateRead {
  items: Record<CdsCode, TemplateCell>;
  formVsCode: FormVsCode[];
  /** The edition the workbook states about itself ("2025-26"), or null. */
  edition: string | null;
}

/** The column holding codes in a sheet: the one with the most code cells (the code table's first column). */
function codeColumn(sheet: Sheet): string | null {
  const counts = new Map<string, number>();
  for (const cells of sheet.values()) for (const c of cells) if (typeof c.value === "string" && CDS_CODE.test(c.value.trim())) counts.set(c.col, (counts.get(c.col) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const textOf = (v: string | number | undefined) => (v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

/**
 * Visible-form rows to cross-check against the code table, by label (the form is what the college sees and edits; the
 * code table is wired to it by cell references that can be off, as Cornell's C21 is by one row). Each row's value is
 * the first cell right of the label, or the cell under a named column header.
 */
const FORM_ROWS: { label: string; code?: CdsCode; byHeader?: Record<string, CdsCode> }[] = [
  { label: "total first-time, first-year males who applied", code: "C.101" },
  { label: "total first-time, first-year females who applied", code: "C.102" },
  { label: "total first-time, first-year students of unknown sex who applied", code: "C.103" },
  { label: "total first-time, first-year males who were admitted", code: "C.104" },
  { label: "total first-time, first-year females who were admitted", code: "C.105" },
  { label: "total first-time, first-year students of unknown sex who were admitted", code: "C.106" },
  { label: "total first-time, first-year males who enrolled", code: "C.107" },
  { label: "total first-time, first-year females who enrolled", code: "C.108" },
  { label: "total first-time, first-year students of unknown sex who enrolled", code: "C.109" },
  {
    label: "total first-time, first-year (degree-seeking) who applied",
    byHeader: { "in-state": "C.119", "out-of-state": "C.122", international: "C.125", unknown: "C.128", total: "C.116" },
  },
  {
    label: "total first-time, first-year (degree-seeking) who were admitted",
    byHeader: { "in-state": "C.120", "out-of-state": "C.123", international: "C.126", unknown: "C.129", total: "C.117" },
  },
  {
    label: "total first-time, first-year (degree-seeking) who enrolled",
    byHeader: { "in-state": "C.121", "out-of-state": "C.124", international: "C.127", unknown: "C.130", total: "C.118" },
  },
  { label: "does your institution offer an early decision plan", code: "C.2101" },
  { label: "number of early decision applications received", code: "C.2110" },
  { label: "number of applicants admitted under early decision", code: "C.2111" },
];

/** The visible form's values for FORM_ROWS (cells left of the code table), by code. */
function readForm(sheet: Sheet, sheetName: string, codeCol: string): Map<CdsCode, { raw: string | number; cell: string }> {
  const limit = colNumber(codeCol);
  const out = new Map<CdsCode, { raw: string | number; cell: string }>();
  let headers = new Map<string, string>(); // header text → column, from the latest row that names "In-State"
  for (const r of [...sheet.keys()].sort((a, b) => a - b)) {
    const cells = sheet.get(r)!.filter((c) => colNumber(c.col) < limit).sort((a, b) => colNumber(a.col) - colNumber(b.col));
    if (cells.some((c) => norm(textOf(c.value)) === "in-state")) headers = new Map(cells.map((c) => [norm(textOf(c.value)), c.col]));
    // The label is the first text cell that names a FORM_ROWS row (column A may hold an item number like "C21").
    const rowOf = (c: Cell) => (typeof c.value === "string" ? FORM_ROWS.find((f) => norm(textOf(c.value)).startsWith(f.label)) : undefined);
    const labelAt = cells.findIndex((c) => rowOf(c));
    const row = labelAt < 0 ? undefined : rowOf(cells[labelAt]);
    if (!row) continue;
    const put = (code: CdsCode, c: Cell | undefined) => {
      if (c && !out.has(code) && !isPlaceholder(c.value)) out.set(code, { raw: c.value, cell: `${sheetName}!${c.col}${r}` });
    };
    if (row.code) put(row.code, cells[labelAt + 1]);
    for (const [header, code] of Object.entries(row.byHeader ?? {})) {
      const col = headers.get(header);
      if (col) put(code, cells.find((c) => c.col === col));
    }
  }
  return out;
}

/** Two cell values say the same thing: equal numbers (to a half unit), the same mark, or the same words. */
function sameValue(a: string | number, b: string | number): boolean {
  const x = parseNumber(a);
  const y = parseNumber(b);
  if (x !== null && y !== null) return Math.abs(x - y) <= 0.5;
  const mx = readMark(a);
  const my = readMark(b);
  if (mx !== null && my !== null) return mx === my;
  return norm(String(a)) === norm(String(b));
}

/**
 * Reads every code of a 2025–26 template workbook (Decision 3): the per-sheet code tables first (the code column is
 * the one holding most codes; the answer sits two columns right, after the question), then the ANSWER SHEET for codes
 * the sheets left empty (Vanderbilt's ANSWER SHEET section H is blank while its H sheet has 104 values; the reverse
 * also happens), then the visible form's C1 and C21 rows against the code table.
 */
export function readTemplate(book: Workbook): TemplateRead {
  const items: Record<CdsCode, TemplateCell> = {};
  for (const name of TEMPLATE_SHEETS) {
    const sheet = book.get(name);
    const codeCol = sheet && codeColumn(sheet);
    if (!sheet || !codeCol) continue;
    const labelCol = colLetters(colNumber(codeCol) + 1);
    const answerCol = colLetters(colNumber(codeCol) + 2);
    for (const r of [...sheet.keys()].sort((a, b) => a - b)) {
      const cells = sheet.get(r)!;
      const code = textOf(cells.find((c) => c.col === codeCol)?.value);
      if (!CDS_CODE.test(code) || (items[code] && items[code].raw !== null)) continue;
      const answer = cells.find((c) => c.col === answerCol)?.value;
      items[code] = { raw: answer ?? null, cell: `${name}!${answerCol}${r}`, sheet: name, source: "code-table", label: textOf(cells.find((c) => c.col === labelCol)?.value) };
    }
  }
  const answers = book.get("ANSWER SHEET");
  if (answers) {
    const colOf = new Map((answers.get(1) ?? []).map((c) => [textOf(c.value), c.col]));
    const [codeCol, answerCol, questionCol] = ["Question Number", "Answer", "Question"].map((h) => colOf.get(h));
    for (const [r, cells] of answers) {
      if (r === 1 || !codeCol || !answerCol) continue;
      const code = textOf(cells.find((c) => c.col === codeCol)?.value);
      if (!CDS_CODE.test(code)) continue;
      const answer = cells.find((c) => c.col === answerCol)?.value;
      if (items[code] && (items[code].raw !== null || answer === undefined)) continue;
      items[code] = { raw: answer ?? null, cell: `ANSWER SHEET!${answerCol}${r}`, sheet: "ANSWER SHEET", source: "answer-sheet", label: textOf(cells.find((c) => c.col === questionCol)?.value) };
    }
  }
  const formVsCode: FormVsCode[] = [];
  const C = book.get("CDS-C");
  const cCol = C && codeColumn(C);
  if (C && cCol) {
    for (const [code, form] of readForm(C, "CDS-C", cCol)) {
      const codeValue = items[code]?.raw ?? null;
      if (codeValue === null || isPlaceholder(codeValue) || !sameValue(codeValue, form.raw)) {
        formVsCode.push({ code, codeValue, formValue: form.raw, formCell: form.cell });
      }
    }
  }
  return { items, formVsCode, edition: templateEdition(book, items) };
}

/**
 * The edition a template workbook states: a "Common Data Set 2025-2026" cell when there is one (many workbooks carry it
 * only in an image), else the item text that names the edition's fall: I.201 "Fall 2025 Student to Faculty ratio",
 * then B.2202 "…enrolled … as of the official enrollment date in Fall 2025". G.002's "2026-2027 academic year costs"
 * is the last resort: colleges edit that sentence (Illinois's says 2025-2026).
 */
function templateEdition(book: Workbook, items: Record<CdsCode, TemplateCell>): string | null {
  const stated = parseEdition(workbookEdition(book))?.key;
  if (stated) return stated;
  const fall = ["I.201", "B.2202"].map((c) => /fall (20\d{2})/i.exec(items[c]?.label ?? "")?.[1]).find(Boolean);
  const costs = /(20\d{2})\s*[-–]\s*20\d{2} academic year/i.exec(items["G.002"]?.label ?? "")?.[1];
  const start = fall ? Number(fall) : costs ? Number(costs) - 1 : null;
  return start === null ? null : (parseEdition(`${start}-${start + 1}`)?.key ?? null);
}

const QUOTE_MAX = 160;
const RESPONDENT = new Set(["A.001", "A.002", "A.003", "A.004", "A.012", "A.013"]);
/** "question | value", ≤ 160 characters: a long question is shortened so the value always shows. */
export function quoteOf(label: string, raw: string | number): string {
  const value = String(raw).replace(/\s+/g, " ").trim();
  const q = `${label} | ${value}`;
  if (q.length <= QUOTE_MAX) return q;
  const room = QUOTE_MAX - value.length - 4;
  return room > 20 ? `${label.slice(0, room)}… | ${value}` : `${q.slice(0, QUOTE_MAX - 1)}…`;
}

/**
 * One record document from a template workbook, with no model call: every template code normalized by its value
 * type and checked by the universal type checks; visible-form disagreements fail `form-vs-code` (both values kept);
 * the aid group fails `aid-year` when H.101 names no aid year. Quotes ("question | value", ≤ 160 characters) are kept
 * for owned items; every value carries its cell. Per-item checks (sums, order) are lib/cds-checks.ts's job.
 */
export function recordFromTemplate(
  book: Workbook,
  opts: { unit_id: string; url: string; sha256: string; retrieved: string; table: TemplateTable; edition?: string; final_url?: string }
): DocumentRecord {
  if (!isTemplateWorkbook(book)) throw new Error(`${opts.unit_id}: not a 2025–26 template workbook (no CDS-A…J and ANSWER SHEET)`);
  const read = readTemplate(book);
  const edition = parseEdition(opts.edition ?? read.edition)?.key;
  if (!edition) throw new Error(`${opts.unit_id}: the workbook states no edition; pass one`);
  const aidRaw = read.items["H.101"]?.raw;
  const aidYear = typeof aidRaw === "string" ? aidRaw : null;
  const aidOk = parseAidYear(aidYear) !== null;
  const mismatch = new Map(read.formVsCode.map((m) => [m.code, m]));
  const items: Record<CdsCode, ItemResult> = {};
  for (const it of opts.table.items) {
    // A0's respondent is a staff member: no spec shows their name, title, office, phone, or email, and the records are
    // committed to a public repository, so those aren't kept (the office address and the CDS page URL are).
    if (RESPONDENT.has(it.code)) {
      items[it.code] = { status: "not-read" };
      continue;
    }
    const cell = read.items[it.code];
    const n = normalizeValue(it, cell?.raw ?? null, { excel: true });
    const m = mismatch.get(it.code);
    if (n.status === "blank" && !m) {
      items[it.code] = { status: "blank" };
      continue;
    }
    const failures: ItemFailure[] = [];
    if (m) {
      const said = m.codeValue === null || isPlaceholder(m.codeValue) ? `is empty (${m.codeValue ?? "no value"})` : `says ${m.codeValue}`;
      failures.push({ check: "form-vs-code", detail: `code table ${said} at ${cell?.cell ?? "no cell"}; the visible form says ${m.formValue} at ${m.formCell}` });
    }
    if (n.status === "overflow") failures.push({ check: "overflow-total", detail: `"${cell?.raw}" is Excel's overflow mark; sum the parts` });
    const typeFail = n.status === "value" ? typeFailure(it, n.v) : null;
    if (typeFail) failures.push(typeFail);
    if (it.year_rule === "aid-year" && !aidOk && n.status !== "blank") failures.push({ check: "aid-year", detail: `H.101 is ${aidYear === null ? "blank" : `"${aidYear}"`}, which names no aid year` });
    const r: ItemResult = { status: failures.length ? "failed" : "passed" };
    if (n.v !== null) r.v = n.v;
    if (cell && cell.raw !== null && n.status !== "blank") {
      r.cell = cell.cell;
      if (it.owner) r.quote = quoteOf(cell.label || it.question, cell.raw);
    }
    if (failures.length) r.failures = failures;
    if (m) r.form = { v: normalizeValue(it, m.formValue, { excel: true }).v, cell: m.formCell };
    items[it.code] = r;
  }
  return {
    sha256: opts.sha256,
    edition,
    type: "xlsx-template",
    url: opts.url,
    ...(opts.final_url ? { final_url: opts.final_url } : {}),
    retrieved: opts.retrieved,
    reads: { deterministic: { schema_version: READER_VERSIONS["xlsx-template"], read_by: "xlsx-template", mode: "deterministic", extracted: opts.retrieved } },
    years: yearsForEdition(edition, { aidYear }),
    items,
  };
}
