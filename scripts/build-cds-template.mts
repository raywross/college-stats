/**
 * Builds data/reference/cds-template-2025-26.json, the table of every 2025–26 Common Data Set template item
 * (specs/college-reported-round-3.md, Decision 3 and "Extraction scope").
 *
 *   npm run build-cds-template -- --workbook <template.xlsx> [--workbook <another.xlsx> …]
 *
 * Reads each workbook's ANSWER SHEET (code, US News PDF tag, question, the template's descriptors, value type) and the
 * code tables embedded in its CDS-A … CDS-J sheets, and takes the union of codes across the workbooks given (a college
 * that deleted a row still leaves the code in the others). Then assigns each code, from the SCOPE table below:
 *   - which model call reads it (`C`, `rest`) or that only deterministic readers do (`store`);
 *   - the spec that owns it (displays it), or none;
 *   - the year rule its value follows (lib/cds-sections.ts ITEM_GROUPS);
 * and normalizes the template's value type into lib/cds-sections.ts ValueType.
 *
 * Any 2025–26 template workbook serves (the inventory used Vanderbilt's, Cornell's, William & Mary's and Illinois's);
 * the codes and questions are the template's, not the college's. A new template edition (2026–27) gets its own output
 * file and a map from old codes to new; rename OUT and EDITION and re-check SCOPE against the new spec.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readWorkbook, type Workbook } from "./lib/cds-xlsx.mts";
import {
  CDS_CODE,
  compareCodes,
  itemOfCode,
  loadTemplate,
  type CallAssignment,
  type CdsCode,
  type CdsSection,
  type TemplateFile,
  type TemplateItem,
  type ValueType,
  type YearRule,
} from "../lib/cds-sections.ts";

const ROOT = join(import.meta.dirname, "..");
const EDITION = "2025-26";
const OUT = join(ROOT, "data", "reference", `cds-template-${EDITION}.json`);

/** The spec's totals (Extraction scope): the build reports any difference. */
const SPEC_TOTALS = { total: 1105, model: 766, C: 263, rest: 503, store: 339 };

/* ------------------------------------------------------------------ */
/* The scope table: code ranges in template order                      */
/* ------------------------------------------------------------------ */

// Owner slugs: specs/data-expansion/<slug>.md, or specs/<slug>.md for the three older specs.
const SB = "cds-student-body-and-outcomes";
const C1 = "college-reported-data";
const RES = "cds-residency-admissions";
const ADM = "cds-admissions";
const LOG = "cds-application-logistics";
const TST = "cds-test-scores-and-policy";
const TRF = "cds-transfer";
const ACA = "cds-academics";
const COST = "cds-cost-and-debt";
const AID = "cds-financial-aid";

/**
 * One row per line of the spec's Extraction scope table (split where the year differs inside a row): first code, last
 * code (inclusive, in template order), whether it's in the model schema, its owner, and its year rule. The call
 * follows from the section: model items in C go to call `C`, all others to `rest`.
 */
type ScopeRow = [from: CdsCode, to: CdsCode, model: boolean, owner: string | null, year: YearRule];
const SCOPE: ScopeRow[] = [
  ["A.001", "A.601", false, null, "edition"], // A0–A6 general information
  ["B.101", "B.178", true, SB, "fall"], // B1 enrollment
  ["B.201", "B.230", true, SB, "fall"], // B2 race/ethnicity
  ["B.301", "B.309", false, null, "prior-year"], // B3 degrees conferred
  ["B.401", "B.432", true, SB, "cohort"], // B4–B11 current grid (Fall Y−6)
  ["B.501", "B.532", true, SB, "previous-cohort"], // B4–B11 previous grid (Fall Y−7)
  ["B.1201", "B.2102", false, null, "edition"], // B12–B21 programs under 4 years
  ["B.2201", "B.2203", true, SB, "retention"], // B22 retention
  ["C.101", "C.118", true, C1, "fall"], // C1 totals by sex and FT/PT
  ["C.119", "C.130", true, RES, "fall"], // C1 by residency
  ["C.201", "C.207", true, ADM, "fall"], // C2 wait list
  ["C.301", "C.524", true, LOG, "edition"], // C3–C5 diploma, prep program, units
  ["C.601", "C.604", false, null, "edition"], // C6 open admission
  ["C.701", "C.719", true, ADM, "fall"], // C7 factors
  ["C.801", "C.8D", true, TST, "test-policy-cycle"], // C8A–C8D test policy
  ["C.8E01", "C.8E02", false, null, "edition"], // C8E latest test date
  ["C.8F", "C.8F", true, TST, "test-policy-cycle"], // C8F policy text
  ["C.8G01", "C.8G07", false, null, "edition"], // C8G placement tests
  ["C.901", "C.987", true, TST, "fall"], // C9 test scores
  ["C.1001", "C.1006", true, ADM, "fall"], // C10 class rank
  ["C.1101", "C.1130", true, ADM, "fall"], // C11 GPA bands
  ["C.1201", "C.1202", true, ADM, "fall"], // C12 average GPA
  ["C.1301", "C.1405", true, LOG, "next-cycle"], // C13 fee, C14 dates
  ["C.1501", "C.1501", false, null, "edition"], // C15 other terms
  ["C.1601", "C.1802", true, LOG, "next-cycle"], // C16 notification, C17 reply, C18 deferral
  ["C.1901", "C.1901", false, null, "edition"], // C19 early admission of high-school students
  ["C.2101", "C.2112", true, ADM, "edition"], // C21 early decision (counts: fall, below)
  ["C.2201", "C.2206", true, ADM, "edition"], // C22 early action
  ["D.101", "D.506", true, TRF, "edition"], // D1–D5 transfers (D2 counts: fall, below)
  ["D.601", "D.701", true, TRF, "edition"], // D6–D7 minimum GPA
  ["D.801", "D.801", false, null, "edition"], // D8 other requirements
  ["D.901", "D.936", true, TRF, "next-cycle"], // D9 transfer dates
  ["D.1001", "D.2201", false, null, "edition"], // D10–D22 other transfer policies
  ["E.101", "E.120", true, ACA, "edition"], // E1 special programs
  ["E.301", "E.314", true, ACA, "edition"], // E3 required coursework
  ["F.101", "F.116", true, null, "fall"], // F1: owners per code below; age store-only
  ["F.201", "F.201", true, "religious-life", "edition"], // F2 campus ministries
  ["F.202", "F.221", false, null, "edition"], // F2 other activities
  ["F.301", "F.307", false, null, "edition"], // F3 ROTC
  ["F.401", "F.407", false, null, "edition"], // F4 other housing
  ["F.408", "F.408", true, "greek-life", "edition"], // F4 fraternity/sorority housing
  ["F.409", "F.414", false, null, "edition"], // F4 other housing
  ["G.001", "G.003", true, COST, "next-year"], // G0 net price calculator, not-final flag and date
  ["G.101", "G.120", true, COST, "next-year"], // G1 tuition, fees, food and housing
  ["G.201", "G.202", false, null, "next-year"], // G2 credits covered by tuition
  ["G.301", "G.605", true, COST, "next-year"], // G3–G6 variation, expenses, per-credit charges
  ["H.101", "H.104", true, AID, "edition"], // H0 aid year (below) and methodology
  ["H.105", "H.127", true, AID, "aid-year"], // H1 aid dollars
  ["H.201", "H.239", true, AID, "aid-year"], // H2 need-based aid
  ["H.2A01", "H.2A12", true, AID, "aid-year"], // H2A non-need aid
  ["H.401", "H.401", true, COST, "graduating-class"], // H4 graduates who began as first-years
  ["H.501", "H.515", true, COST, "graduating-class"], // H5 borrowing
  ["H.601", "H.606", true, AID, "aid-year"], // H6 aid to international students
  ["H.701", "H.808", true, AID, "next-cycle"], // H7–H8 forms
  ["H.901", "H.1103", true, AID, "next-cycle"], // H9–H11 deadlines, notification, reply
  ["H.1201", "H.1309", false, null, "edition"], // H12–H13 loan and grant programs
  ["H.1401", "H.1419", true, AID, "edition"], // H14 criteria for institutional aid
  ["H.1501", "H.1501", true, AID, "edition"], // H15 recent policy changes
  ["I.101", "I.130", false, null, "fall"], // I-1 instructional faculty
  ["I.201", "I.203", true, ACA, "fall"], // I-2 student-to-faculty ratio
  ["I.301", "I.316", true, ACA, "fall"], // I-3 class sections by size
  ["J.101", "J.220", false, null, "prior-year"], // J degrees by field
];

/** Per-code exceptions to SCOPE, where an owning spec splits a row. */
const CODE_OWNER: Record<CdsCode, string | null> = {
  // F1 by column (first-years F.101–F.108, all undergraduates F.109–F.116): out of state, Greek, housing, age.
  "F.101": "residence", "F.109": "residence",
  "F.102": "greek-life", "F.103": "greek-life", "F.110": "greek-life", "F.111": "greek-life",
  "F.104": "housing-and-policies", "F.105": "housing-and-policies", "F.112": "housing-and-policies", "F.113": "housing-and-policies",
  "F.106": null, "F.107": null, "F.108": null, "F.114": null, "F.115": null, "F.116": null,
};
/** Specs that read an item besides its owner. */
const ALSO: Record<CdsCode, string[]> = {
  "C.715": ["religious-life"], // C7 religious affiliation/commitment
  "H.1409": ["religious-life"], // H14 religious affiliation (non-need)
  "H.1418": ["religious-life"], // H14 religious affiliation (need)
};
const CODE_YEAR: Record<CdsCode, YearRule> = {
  "C.2110": "fall", // C21 counts describe the entering class (cds-admissions.md Lineage)
  "C.2111": "fall",
  "H.101": "aid-year", // H0's own answer is the aid year
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`D.2${String(i + 1).padStart(2, "0")}`, "fall"])), // D2 counts (cds-transfer.md Years)
};

/* ------------------------------------------------------------------ */
/* Value types                                                         */
/* ------------------------------------------------------------------ */

/** The template's "Value type" column → ValueType, before the per-code fixes below. */
const TEMPLATE_TYPE: Record<string, ValueType> = {
  Number: "count",
  Numbers: "text", // phone numbers and ZIP codes
  "Email Address": "text",
  URL: "url",
  Text: "text",
  YesNo: "yes-no",
  x: "check",
  MM: "month",
  DD: "day",
  "Nearest $1": "currency",
  "Nearest 1%": "percent",
  "Whole Number or Round to Nearest Tenth": "percent", // shares (B4 rates, C9 bands, C10, C11, J); scores and ages fixed below
  "Whole Number or Round to Nearest Hundredths": "gpa",
  "Round to Nearest Hundredths": "gpa",
  "Carnegie units": "decimal",
  "Unit Type": "choice",
  "": "text",
};

const range = (prefix: string, from: number, to: number, pad = 3) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(pad, "0")}`);

/** Codes whose template type is wrong or too coarse for the checks they need. */
const CODE_TYPE: Record<CdsCode, ValueType> = {
  ...Object.fromEntries(range("C.", 905, 907).map((c) => [c, "sat-composite"])),
  ...Object.fromEntries(range("C.", 908, 913).map((c) => [c, "sat-section"])),
  ...Object.fromEntries([...range("C.", 914, 922), ...range("C.", 926, 931)].map((c) => [c, "act"])),
  ...Object.fromEntries(range("C.", 923, 925).map((c) => [c, "act-writing"])),
  ...Object.fromEntries(["F.107", "F.108", "F.115", "F.116"].map((c) => [c, "decimal"])), // average age
  "C.1302": "currency", // application fee
  "C.1711": "currency", // housing deposit
  "C.1705": "check", // "Must reply by May 1st or within…" is a checkbox
  "I.201": "decimal", // student-to-faculty ratio ("12.1")
  ...Object.fromEntries(["D.402", "D.1301", "D.1401", "D.1501", "D.1601", "D.1901", "D.2001", "G.201", "G.202"].map((c) => [c, "decimal"])), // credits
  "D.1201": "text", // lowest grade ("C")
  "C.524": "text", // "Other (specify)" under recommended units
  "C.1608": "date", // notification "Other:", where W&M's serial 46113 is April 1
  "G.003": "date", // date costs will be final
  "A.601": "url", // DEI office page
  "H.1418": "check", // H14 grid row typed as text
  // Closed sets of words
  ...Object.fromEntries([...range("C.", 701, 718), "C.802", "C.803", "C.804", ...range("D.", 501, 506), "A.201", "A.301", "A.401", "C.301", "C.401", "C.1304", "C.1712", "F.301", "F.303", "F.304", "F.306"].map((c) => [c, "choice"])),
};

/* ------------------------------------------------------------------ */
/* Reading the workbooks                                               */
/* ------------------------------------------------------------------ */

type Meta = Omit<TemplateItem, "section" | "item" | "value_type" | "call" | "owner" | "also" | "year_rule"> & { type: string };

const clean = (v: unknown) => (v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim());

/** ANSWER SHEET rows by code, keyed by the header row's column names. */
function answerSheet(book: Workbook): Map<CdsCode, Meta> {
  const sheet = book.get("ANSWER SHEET");
  if (!sheet) throw new Error("no ANSWER SHEET: not a 2025–26 template workbook");
  const colOf = new Map((sheet.get(1) ?? []).map((c) => [clean(c.value), c.col]));
  const get = (cells: { col: string; value: string | number }[], name: string) => clean(cells.find((c) => c.col === colOf.get(name))?.value);
  const out = new Map<CdsCode, Meta>();
  for (const [r, cells] of sheet) {
    if (r === 1) continue;
    const code = get(cells, "Question Number");
    if (!CDS_CODE.test(code)) continue;
    const orNull = (name: string) => get(cells, name) || null;
    out.set(code, {
      code,
      tag: orNull("US News PDF Tag"),
      question: get(cells, "Question"),
      sub: orNull("Sub-Section"),
      category: orNull("Category"),
      group: orNull("Student Group"),
      cohort: orNull("Cohort"),
      residency: orNull("Residency"),
      unit: orNull("Unit load"),
      gender: orNull("Gender"),
      type: get(cells, "Value type"),
    });
  }
  return out;
}

/** Codes in the CDS-A … CDS-J code tables (the cross-check that the ANSWER SHEET lists every code). */
function sheetCodes(book: Workbook): Set<CdsCode> {
  const out = new Set<CdsCode>();
  for (const [name, sheet] of book) {
    if (!/^CDS-[A-J]$/.test(name)) continue;
    for (const cells of sheet.values()) for (const c of cells) if (typeof c.value === "string" && CDS_CODE.test(c.value.trim())) out.add(c.value.trim());
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function build(paths: string[]): TemplateFile {
  const metas = new Map<CdsCode, Meta>();
  const inSheets = new Set<CdsCode>();
  for (const p of paths) {
    const book = readWorkbook(p);
    for (const [code, m] of answerSheet(book)) if (!metas.has(code)) metas.set(code, m);
    for (const code of sheetCodes(book)) inSheets.add(code);
  }
  const missing = [...inSheets].filter((c) => !metas.has(c));
  if (missing.length) throw new Error(`codes in sheet code tables but in no ANSWER SHEET: ${missing.join(", ")}`);
  const unknownTypes = [...new Set([...metas.values()].map((m) => m.type))].filter((t) => !(t in TEMPLATE_TYPE));
  if (unknownTypes.length) throw new Error(`unmapped template value types: ${unknownTypes.join(", ")}`);

  const codes = [...metas.keys()].sort(compareCodes);
  const scopeOf = (code: CdsCode) => SCOPE.find(([from, to]) => compareCodes(code, from) >= 0 && compareCodes(code, to) <= 0);
  const items: TemplateItem[] = codes.map((code) => {
    const m = metas.get(code)!;
    const row = scopeOf(code);
    if (!row) throw new Error(`${code} falls in no SCOPE row`);
    const [, , inModel, rowOwner, rowYear] = row;
    const owner = code in CODE_OWNER ? CODE_OWNER[code] : rowOwner;
    const section = code[0] as CdsSection;
    const call: CallAssignment = inModel && owner ? (section === "C" ? "C" : "rest") : "store";
    const { type, ...rest } = m;
    return {
      ...rest,
      section,
      item: itemOfCode(code),
      value_type: CODE_TYPE[code] ?? TEMPLATE_TYPE[type],
      call,
      owner: call === "store" ? null : owner,
      ...(ALSO[code] ? { also: ALSO[code] } : {}),
      year_rule: CODE_YEAR[code] ?? rowYear,
    };
  });
  const count = (call: CallAssignment) => items.filter((it) => it.call === call).length;
  const counts = { total: items.length, model: count("C") + count("rest"), C: count("C"), rest: count("rest"), store: count("store") };
  return {
    edition: EDITION,
    built: new Date().toISOString().slice(0, 10),
    source: "Common Data Set 2025–26 template (ANSWER SHEET and per-sheet code tables), read from colleges' filled workbooks",
    counts,
    items,
  };
}

/** Compact, one item per line: reviewable diffs without a 30,000-line file. */
function serialize(file: TemplateFile): string {
  const { items, ...head } = file;
  const top = JSON.stringify(head).slice(0, -1);
  return `${top},"items":[\n${items.map((it) => JSON.stringify(it)).join(",\n")}\n]}\n`;
}

const { values } = parseArgs({ options: { workbook: { type: "string", multiple: true } } });
const paths = values.workbook ?? [];
if (!paths.length) {
  console.error("usage: npm run build-cds-template -- --workbook <2025-26 template workbook.xlsx> [--workbook …]");
  process.exit(2);
}
const file = build(paths);
loadTemplate(file); // the same validation every reader applies
writeFileSync(OUT, serialize(file));
console.log(`Wrote ${OUT}`);
console.log(`  codes ${file.counts.total} (spec ${SPEC_TOTALS.total}); model ${file.counts.model} (spec ${SPEC_TOTALS.model}): C ${file.counts.C} (spec ${SPEC_TOTALS.C}), rest ${file.counts.rest} (spec ${SPEC_TOTALS.rest}); store-only ${file.counts.store} (spec ${SPEC_TOTALS.store})`);
for (const k of Object.keys(SPEC_TOTALS) as (keyof typeof SPEC_TOTALS)[]) {
  if (file.counts[k] !== SPEC_TOTALS[k]) console.warn(`  ${k}: ${file.counts[k]} differs from the spec's ${SPEC_TOTALS[k]} (see the spec's As built)`);
}
