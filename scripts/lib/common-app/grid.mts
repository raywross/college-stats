/**
 * The Common App Requirements Grid (specs/data-expansion/common-app.md, source 1): one row per member that takes
 * first-year applicants, read from the PDF's positioned text.
 *
 * The grid is a layout PDF, not a table. `rowsFromItems` (../college-reported/layout.mts) finds the two header rows
 * printed atop every page ("Common App | School | RD/ | …" over "member | type ¹ | ED | EDII | …"); the lower one
 * names every column, and each column's window runs from halfway to its left neighbour's header x to halfway to its
 * right neighbour's (so the narrow Writing column between Portfolio and Test policy gets its own window). A data row
 * is the row holding a School-type cell (Coed, Women, Men, Coordinate) under the "type" header; every other piece of
 * text below the header joins the data row nearest it by y, so wrapped names ("Abilene Christian" / "University")
 * and wrapped "tests used" / "English proficiency" cells land on their row whichever side of it they sit. Pieces are
 * placed by their own x, not by `rowsFromItems`' merged cells, which join adjacent dates ("11/01/2026 1/15/2027").
 *
 * The edition (cycle and "Updated" stamp) is read from the page header, never typed. The notes page has a header but
 * no School-type cell, so it yields no rows. `gridProblems` holds the checks that fail the sync. Pure.
 */
import { rowsFromItems, ROW_TOLERANCE, type Row, type TextItem } from "../college-reported/layout.mts";
import type {
  EnglishTestCode,
  FeeWaiver,
  GridEdition,
  GridRow,
  GridTestCode,
  Portfolio,
  SchoolTypeCode,
} from "../../../lib/common-app/types.ts";

export const GRID_URL = "https://content.commonapp.org/Files/ReqGrid.pdf";

/** The grid's columns, keyed by the text of the lower header row (superscript note marks stripped). */
export type ColumnKey =
  | "name"
  | "school_type"
  | "ed"
  | "ed2"
  | "ea"
  | "ea2"
  | "rea"
  | "regular"
  | "fee_us"
  | "fee_intl"
  | "fee_waiver"
  | "essay"
  | "courses_grades"
  | "portfolio"
  | "writing"
  | "test_policy"
  | "tests_used"
  | "english"
  | "te"
  | "oe"
  | "mr"
  | "cr"
  | "saves";

/** Lower header row text → column. */
const HEADER_KEYS: Record<string, ColumnKey> = {
  member: "name",
  type: "school_type",
  ed: "ed",
  edii: "ed2",
  ea: "ea",
  eaii: "ea2",
  rea: "rea",
  rolling: "regular",
  us: "fee_us",
  "int'l": "fee_intl",
  "fee waiver": "fee_waiver",
  essay: "essay",
  grades: "courses_grades",
  portfolio: "portfolio",
  writing: "writing",
  policy: "test_policy",
  "tests used": "tests_used",
  proficiency: "english",
  te: "te",
  oe: "oe",
  mr: "mr",
  cr: "cr",
  forms: "saves",
};
const ALL_KEYS = Object.values(HEADER_KEYS);

const SCHOOL_TYPES: Record<string, SchoolTypeCode> = { Coed: "coed", Women: "women", Men: "men", Coordinate: "coordinate" };
const FEE_WAIVERS: Record<string, FeeWaiver> = { Accepted: "accepted", "U.S. only": "us_only", "Not Accepted": "not_accepted" };
const PORTFOLIOS: Record<string, Portfolio> = { SR: "slideroom", COL: "own" };
export const TEST_CODES: readonly GridTestCode[] = ["A", "F", "I", "N", "S"];
export const ENGLISH_CODES: readonly EnglishTestCode[] = ["C", "D", "I", "P", "T", "N"];

/** A piece of text joins the nearest data row only within this many points (a row is about 22 pt tall). */
const MAX_ATTACH = 13;

/** Header text with note marks (¹ ² ³ …) removed, lower case. */
const headerText = (s: string) => s.replace(/[¹²³⁰-⁹*]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const rowText = (r: Row) => r.cells.map((c) => c.text).join(" ");
const isFooter = (s: string) => /^Page \d+$/i.test(s.trim());

export interface ColumnWindow {
  key: ColumnKey;
  /** The header's x. */
  x: number;
  lo: number;
  hi: number;
}

/** The columns of one page from its lower header row, or null when the page has none (or it lacks a column). */
export function pageColumns(rows: readonly Row[]): { windows: ColumnWindow[]; headerY: number } | null {
  for (const r of rows) {
    const found = new Map<ColumnKey, number>();
    for (const c of r.cells) {
      const key = HEADER_KEYS[headerText(c.text)];
      if (key && !found.has(key)) found.set(key, c.x);
    }
    if (found.size < ALL_KEYS.length) continue;
    const cols = [...found].map(([key, x]) => ({ key, x })).sort((a, b) => a.x - b.x);
    const windows = cols.map((c, i) => ({
      key: c.key,
      x: c.x,
      lo: i === 0 ? -Infinity : (cols[i - 1].x + c.x) / 2,
      hi: i === cols.length - 1 ? Infinity : (c.x + cols[i + 1].x) / 2,
    }));
    return { windows, headerY: r.y };
  }
  return null;
}

const columnOf = (windows: readonly ColumnWindow[], x: number) => windows.find((w) => x >= w.lo && x < w.hi)?.key ?? null;

export interface EditionStamp {
  /** "2026-27". */
  cycle: string;
  /** ISO date of the "Updated: 09-25-2026" stamp. */
  updated: string;
}

/** The stamp printed atop one page, or null. */
function pageStamp(rows: readonly Row[]): EditionStamp | null {
  let cycle: string | null = null;
  let updated: string | null = null;
  for (const r of rows.slice(0, 8)) {
    const t = rowText(r);
    const u = /Updated:\s*(\d{1,2})-(\d{1,2})-(\d{4})/i.exec(t);
    if (u && !updated) updated = isoDate(Number(u[3]), Number(u[1]), Number(u[2]));
    const c = /(?<![\d-])(20\d{2})\s*[-–]\s*(\d{2})(?![\d-])/.exec(t.replace(/Updated:.*$/i, ""));
    if (c && !cycle && (Number(c[1]) + 1) % 100 === Number(c[2])) cycle = `${c[1]}-${c[2]}`;
  }
  return cycle && updated ? { cycle, updated } : null;
}

/** The edition the grid states on its first page ("2026-27", "Updated: 09-25-2026"), never typed. Throws when absent. */
export function editionFromHeader(pages: readonly TextItem[][]): EditionStamp {
  for (const items of pages) {
    const stamp = pageStamp(rowsFromItems(items));
    if (stamp) return stamp;
  }
  throw new Error("Requirements Grid: no cycle and \"Updated:\" stamp found in the page headers");
}

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "11/1/2026" or "02/01/2027" → ISO; null for anything else. */
export function parseGridDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return m ? isoDate(Number(m[3]), Number(m[1]), Number(m[2])) : null;
}

/** "$0" → 0, "$1,000" → 1000; null when it isn't a dollar amount. */
export function parseFee(text: string): number | null {
  const m = /^\$\s*(\d{1,3}(?:,\d{3})*|\d+)$/.exec(text.trim());
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** One data row's raw text by column, before typing. */
export interface RawGridRow {
  page: number;
  cells: Partial<Record<ColumnKey, string>>;
}

export interface ParsedGrid extends EditionStamp {
  rows: GridRow[];
  pages: number;
  /** School-type cells found anywhere on the pages (the grid's own count of rows, for the 2% check). */
  school_type_cells: number;
  /** What the parse couldn't place or type; any entry fails the sync (gridProblems). */
  issues: string[];
  /** What the grid itself gets wrong and the parse reads as blank (a "#ERROR!" cell); printed, never fatal. */
  warnings: string[];
}

/** A spreadsheet error printed in a cell ("#ERROR!", "#N/A", "#REF!"): Common App's file, read as a blank cell. */
export const isSpreadsheetError = (s: string) => /^#(?:ERROR!|N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NULL!|NUM!)$/i.test(s.trim());

/** The raw rows of one page and the issues met (stray text, a missing header). */
export function rawRowsOfPage(items: readonly TextItem[], page: number): { rows: RawGridRow[]; issues: string[] } {
  const issues: string[] = [];
  const layout = rowsFromItems(items);
  const cols = pageColumns(layout);
  const hasType = items.some((i) => SCHOOL_TYPES[i.str.trim()] !== undefined);
  if (!cols) {
    if (hasType) issues.push(`page ${page}: School-type cells but no header row with every column`);
    return { rows: [], issues };
  }
  const body = items.filter((i) => i.str.trim() && i.y < cols.headerY - ROW_TOLERANCE && !isFooter(i.str));
  const anchors = body
    .filter((i) => columnOf(cols.windows, i.x) === "school_type" && SCHOOL_TYPES[i.str.trim()] !== undefined)
    .sort((a, b) => b.y - a.y);
  if (!anchors.length) return { rows: [], issues }; // the notes page
  const groups = anchors.map(() => [] as TextItem[]);
  for (const it of body) {
    let best = -1;
    let bestD = Infinity;
    let secondD = Infinity;
    anchors.forEach((a, k) => {
      const d = Math.abs(a.y - it.y);
      if (d < bestD) {
        secondD = bestD;
        bestD = d;
        best = k;
      } else if (d < secondD) secondD = d;
    });
    if (bestD > MAX_ATTACH) {
      issues.push(`page ${page}: "${it.str.trim()}" at x ${Math.round(it.x)} is ${bestD.toFixed(1)} pt from any row`);
      continue;
    }
    if (it !== anchors[best] && secondD - bestD < 0.5) {
      issues.push(`page ${page}: "${it.str.trim()}" at x ${Math.round(it.x)} sits halfway between two rows`);
      continue;
    }
    groups[best].push(it);
  }
  const rows = groups.map((g) => {
    const cells: Partial<Record<ColumnKey, string>> = {};
    for (const it of [...g].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const key = columnOf(cols.windows, it.x);
      if (!key) continue;
      const s = it.str.replace(/\s+/g, " ").trim();
      cells[key] = cells[key] ? `${cells[key]} ${s}` : s;
    }
    return { page, cells };
  });
  return { rows, issues };
}

const yes = (v: string | undefined, label: string, problems: string[]): boolean => {
  if (v === undefined) return false;
  if (v === "Y") return true;
  problems.push(`${label} "${v}" is not Y or blank`);
  return false;
};

const count = (v: string | undefined, label: string, problems: string[]): number => {
  if (v === undefined) return 0;
  if (/^\d$/.test(v)) return Number(v);
  problems.push(`${label} "${v}" is not a number`);
  return 0;
};

/** Types one raw row; null (with problems) when a required cell can't be read. */
export function typeRow(raw: RawGridRow): { row: GridRow | null; problems: string[] } {
  const c = raw.cells;
  const problems: string[] = [];
  const name = (c.name ?? "").trim();
  if (!name) problems.push("no name");
  const school_type = SCHOOL_TYPES[c.school_type ?? ""];
  const date = (key: ColumnKey, label: string): string | null => {
    const v = c[key];
    if (v === undefined) return null;
    const d = parseGridDate(v);
    if (!d) problems.push(`${label} "${v}" is not a date`);
    return d;
  };
  let regular: string | null = null;
  if (c.regular !== undefined) regular = c.regular === "Rolling" ? "rolling" : date("regular", "RD/Rolling");
  const fee = (key: ColumnKey, label: string): number | null => {
    const v = c[key];
    if (v === undefined) return null;
    const n = parseFee(v);
    if (n === null) problems.push(`${label} fee "${v}" is not a dollar amount`);
    return n;
  };
  let fee_waiver: FeeWaiver | null = null;
  if (c.fee_waiver !== undefined) {
    fee_waiver = FEE_WAIVERS[c.fee_waiver] ?? null;
    if (!fee_waiver) problems.push(`fee waiver "${c.fee_waiver}" is not Accepted, U.S. only, or Not Accepted`);
  }
  let portfolio: Portfolio | null = null;
  if (c.portfolio !== undefined) {
    portfolio = PORTFOLIOS[c.portfolio] ?? null;
    if (!portfolio) problems.push(`portfolio "${c.portfolio}" is not SR or COL`);
  }
  const code = c.test_policy as GridTestCode | undefined;
  if (!code || !TEST_CODES.includes(code)) problems.push(`test policy "${c.test_policy ?? ""}" is not one of ${TEST_CODES.join(", ")}`);
  const english_tests: EnglishTestCode[] = [];
  const eng = c.english;
  if (eng !== undefined && eng !== "See website") {
    for (const tok of eng.split(/\s+or\s+|\s*,\s*/)) {
      const t = tok.trim() as EnglishTestCode;
      if (ENGLISH_CODES.includes(t)) {
        if (!english_tests.includes(t)) english_tests.push(t);
      } else problems.push(`English proficiency "${eng}" has "${tok}", not one of ${ENGLISH_CODES.join(", ")}`);
    }
  }
  if (!school_type) problems.push(`school type "${c.school_type ?? ""}"`);
  const row: GridRow = {
    name,
    page: raw.page,
    unit_id: null,
    slug: null,
    school_type,
    deadlines: { ed: date("ed", "ED"), ed2: date("ed2", "EDII"), ea: date("ea", "EA"), ea2: date("ea2", "EAII"), rea: date("rea", "REA"), regular },
    fee: { us: fee("fee_us", "US"), international: fee("fee_intl", "Int'l") },
    fee_waiver,
    essay_required: yes(c.essay, "Personal essay", problems),
    courses_grades_required: yes(c.courses_grades, "Courses & Grades", problems),
    portfolio,
    writing_supplement: yes(c.writing, "Writing", problems),
    test_policy: { code: code as GridTestCode, tests_used: c.tests_used ?? null, english_tests },
    recommendations: {
      teacher: count(c.te, "TE", problems),
      other: count(c.oe, "OE", problems),
      counselor: yes(c.cr, "CR", problems),
      mid_year_report: yes(c.mr, "MR", problems),
    },
    saves_forms: yes(c.saves, "Saves forms", problems),
  };
  return { row: name && school_type && code && TEST_CODES.includes(code) ? row : null, problems };
}

/**
 * Parses the grid from `pdfTextItems` output (or `pagesFromLayoutText` for fixtures): the edition from the header,
 * one typed row per School-type cell, and every issue met on the way.
 */
export function parseGrid(pages: readonly TextItem[][]): ParsedGrid {
  const stamp = editionFromHeader(pages);
  const rows: GridRow[] = [];
  const issues: string[] = [];
  const warnings: string[] = [];
  let school_type_cells = 0;
  pages.forEach((items, i) => {
    const page = i + 1;
    school_type_cells += items.filter((it) => SCHOOL_TYPES[it.str.trim()] !== undefined).length;
    const s = pageStamp(rowsFromItems(items));
    if (s && (s.cycle !== stamp.cycle || s.updated !== stamp.updated)) issues.push(`page ${page}: stamp ${s.cycle} / ${s.updated} differs from page 1's ${stamp.cycle} / ${stamp.updated}`);
    const raw = rawRowsOfPage(items, page);
    issues.push(...raw.issues);
    for (const r of raw.rows) {
      for (const [key, v] of Object.entries(r.cells) as [ColumnKey, string][]) {
        if (!isSpreadsheetError(v)) continue;
        warnings.push(`page ${page}, "${r.cells.name ?? "?"}": the ${key} cell prints "${v}" (an error in Common App's file); read as blank`);
        delete r.cells[key];
      }
      const typed = typeRow(r);
      for (const p of typed.problems) issues.push(`page ${page}, "${r.cells.name ?? "?"}": ${p}`);
      if (typed.row) rows.push(typed.row);
    }
  });
  warnings.push(...gridWarnings(rows));
  return { ...stamp, rows, pages: pages.length, school_type_cells, issues, warnings };
}

/** A row without its page: two rows that are equal apart from the page are one row read twice. */
const rowKey = (r: GridRow) => JSON.stringify({ ...r, page: 0, unit_id: null, slug: null });

/** Names printed on more than one row with different values (2026-27: "Siena University" three times). */
export function repeatedNames(rows: readonly GridRow[]): Map<string, GridRow[]> {
  const by = new Map<string, GridRow[]>();
  for (const r of rows) {
    const k = r.name.trim().toLowerCase();
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return new Map([...by].filter(([, rs]) => rs.length > 1 && new Set(rs.map(rowKey)).size === rs.length));
}

/** What the grid itself prints oddly, for the sync's log: names on several differing rows (never joined). */
export function gridWarnings(rows: readonly GridRow[]): string[] {
  return [...repeatedNames(rows)].map(([, rs]) => `"${rs[0].name}" is printed on ${rs.length} rows with different values (pages ${[...new Set(rs.map((r) => r.page))].join(", ")}); none is joined, since nothing says which is which`);
}

/** Names that are header or notes text, never a member. */
const NOT_A_NAME = /^(common app|member|common app member|notes:?|school|type|transfer applicants\b.*)$|updated:|see bottom of document|first-year deadlines/i;

/** The cycle's window: September 1 of its first year to August 31 of the next. */
export function cycleWindow(cycle: string): [string, string] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(cycle);
  if (!m) return null;
  const y = Number(m[1]);
  return [`${y}-09-01`, `${y + 1}-08-31`];
}

/**
 * The checks that fail the sync (brief, U1a): parse issues; the row count within 2% of the grid's own School-type
 * count; every date inside the cycle's window (September of its first year to August of the next: an in-season
 * refresh stamped in January keeps the same window); fees $0–$250; codes in their vocabularies; no duplicate names;
 * no header or notes text as a row.
 */
export function gridProblems(edition: Pick<GridEdition, "cycle" | "updated" | "rows"> & { school_type_cells?: number; issues?: readonly string[] }): string[] {
  const out: string[] = [...(edition.issues ?? [])];
  const window = cycleWindow(edition.cycle);
  if (!window) out.push(`cycle "${edition.cycle}" is not YYYY-YY`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edition.updated)) out.push(`updated "${edition.updated}" is not an ISO date`);
  const rows = edition.rows;
  if (!rows.length) out.push("no rows parsed");
  if (edition.school_type_cells !== undefined) {
    const total = edition.school_type_cells;
    if (!total || Math.abs(rows.length - total) / total > 0.02) out.push(`${rows.length} rows parsed, but the grid has ${total} School-type cells (more than 2% apart)`);
  }
  const seen = new Map<string, number>();
  for (const r of rows) {
    const at = `page ${r.page}, "${r.name}"`;
    if (!r.name.trim() || NOT_A_NAME.test(r.name.trim())) out.push(`${at}: header or notes text parsed as a row`);
    const key = r.name.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!Object.values(SCHOOL_TYPES).includes(r.school_type)) out.push(`${at}: school type "${r.school_type}"`);
    for (const [round, d] of Object.entries(r.deadlines)) {
      if (d === null || d === "rolling") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) out.push(`${at}: ${round} "${d}" is not an ISO date`);
      else if (window && (d < window[0] || d > window[1])) out.push(`${at}: ${round} ${d} is outside the ${edition.cycle} cycle (${window[0]} to ${window[1]})`);
    }
    for (const [which, fee] of Object.entries(r.fee)) {
      if (fee !== null && !(Number.isInteger(fee) && fee >= 0 && fee <= 250)) out.push(`${at}: ${which} fee ${fee} is outside $0–$250`);
    }
    if (r.fee_waiver !== null && !Object.values(FEE_WAIVERS).includes(r.fee_waiver)) out.push(`${at}: fee waiver "${r.fee_waiver}"`);
    if (r.portfolio !== null && !Object.values(PORTFOLIOS).includes(r.portfolio)) out.push(`${at}: portfolio "${r.portfolio}"`);
    if (!TEST_CODES.includes(r.test_policy.code)) out.push(`${at}: test policy "${r.test_policy.code}"`);
    for (const e of r.test_policy.english_tests) if (!ENGLISH_CODES.includes(e)) out.push(`${at}: English code "${e}"`);
    for (const [k, n] of [["teacher", r.recommendations.teacher], ["other", r.recommendations.other]] as const) {
      if (!Number.isInteger(n) || n < 0 || n > 9) out.push(`${at}: ${k} evaluations ${n}`);
    }
  }
  // A name on several rows fails when two of them are the same row read twice (a parse fault); differing rows under one
  // name are the grid's own (gridWarnings) and stay unjoined.
  const repeated = repeatedNames(rows);
  for (const [name, n] of seen) if (n > 1 && !repeated.has(name)) out.push(`"${name}" appears ${n} times (a row read twice)`);
  return out;
}
