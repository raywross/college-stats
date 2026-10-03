/**
 * CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md): a college's round-3 record
 * (data/cds-records/<unit_id>.json) → `school.reported.admissions_by_residency`, with a lineage record per stored leaf.
 *
 * Which values. Each cell comes from a **passed** item. The one exception is the spec's `residency-form-vs-codes`
 * rule for 2025–26 template workbooks: an item that failed *only* because its code-table cell disagrees with the
 * visible grid (`form-vs-code`, the item's `form` value) takes the visible grid's value, and then only if the whole
 * grid assembled that way passes `residency-funnel` and `residency-sum` (Illinois 2025–26: the code table copied the
 * applied row into the in-state column; the visible grid is consistent). A failed item's code-table value is never
 * used. A grid that fails a check is not merged (it waits for review), and an older edition's passed grid is used only
 * when its class is within two falls of the headline admissions year.
 *
 * Pure: type-only imports plus lib/cds-records.ts (itself pure). Display helpers (rates, the insight, filters, Compare
 * rows) live in lib/cds/residency-display.ts so client code never loads the records helpers.
 */
import type { LineageRecord, ReportedResidencyAdmissions, ResidencyCounts, School } from "../types";
import type { CdsCode, CollegeRecord, DocumentRecord, ItemResult } from "../cds-sections.ts";
import { compareDocuments, editionFallYear, editionLabel, lineageFromItem } from "../cds-records.ts";

/** The grid's rows, as stored. `unknown` is kept for the sum check; `total` is C1's totals (C.116–C.118). */
export const RESIDENCY_GROUPS = ["in_state", "out_of_state", "international", "unknown", "total"] as const;
export type ResidencyGroup = (typeof RESIDENCY_GROUPS)[number];
export const RESIDENCY_COUNTS = ["applicants", "admitted", "enrolled"] as const;
export type ResidencyCount = (typeof RESIDENCY_COUNTS)[number];

/**
 * Template codes by group and count (2025–26). In the fillable PDF's tags `NRES` is out-of-state and `INTL` is
 * international, while the template's `res` column calls the international columns "Nonresidents": map by code.
 */
export const RESIDENCY_CODES: Record<ResidencyGroup, Record<ResidencyCount, CdsCode>> = {
  total: { applicants: "C.116", admitted: "C.117", enrolled: "C.118" },
  in_state: { applicants: "C.119", admitted: "C.120", enrolled: "C.121" },
  out_of_state: { applicants: "C.122", admitted: "C.123", enrolled: "C.124" },
  international: { applicants: "C.125", admitted: "C.126", enrolled: "C.127" },
  unknown: { applicants: "C.128", admitted: "C.129", enrolled: "C.130" },
};

/** The visible grid's column headers and row labels, for generated quotes on workbook cells. */
const COLUMN_LABEL: Record<ResidencyGroup, string> = {
  in_state: "In-State",
  out_of_state: "Out-of-State",
  international: "International",
  unknown: "Unknown",
  total: "Total",
};
const ROW_LABEL: Record<ResidencyCount, string> = {
  applicants: "Total first-time, first-year who applied",
  admitted: "Total first-time, first-year who were admitted",
  enrolled: "Total first-time, first-year who enrolled",
};

/** The groups shown as rates (never `unknown` or `total`). */
export const SHOWN_GROUPS = ["in_state", "out_of_state", "international"] as const;
export type ShownGroup = (typeof SHOWN_GROUPS)[number];

/** Every lineage path this module writes starts with this, so a re-merge can remove the previous ones. */
export const RESIDENCY_LINEAGE_PREFIX = "reported.admissions_by_residency.";

/** How far (falls) an older edition's grid may trail the headline admissions year and still be shown. */
export const RESIDENCY_MAX_FALLS_BEHIND = 2;
/** `residency-vs-federal`: enrolled shares within this many points of IPEDS EF-C's. */
export const RESIDENCY_FEDERAL_TOLERANCE = 0.1;

/** One grid cell as resolved from the record: its value and where it came from. */
export interface GridCell {
  v: number | null;
  /** "item": a passed item. "form": the visible grid's value of an item that failed only form-vs-code. */
  from: "item" | "form" | null;
  code: CdsCode;
}
export type ResidencyGrid = Record<ResidencyGroup, Record<ResidencyCount, GridCell>>;

/** A check failure for the whole grid (item `C1-residency`), keyed by the spec's check ids. */
export interface GridFailure {
  check: "residency-funnel" | "residency-sum" | "residency-vs-federal" | "residency-unusable-cell";
  detail: string;
}

const onlyFormVsCode = (it: ItemResult) => it.status === "failed" && !!it.failures?.length && it.failures.every((f) => f.check === "form-vs-code");

/**
 * One cell: a passed item's number; for an item that failed only form-vs-code, its visible-grid value; otherwise null.
 * `unusable` is true when the item failed for another reason (the grid can't be trusted then).
 */
function resolveCell(doc: DocumentRecord, code: CdsCode): { cell: GridCell; unusable: boolean } {
  const it = doc.items[code];
  if (it?.status === "passed") return { cell: { v: typeof it.v === "number" ? it.v : null, from: typeof it.v === "number" ? "item" : null, code }, unusable: typeof it.v !== "number" };
  if (it && onlyFormVsCode(it)) {
    const fv = it.form?.v;
    if (typeof fv === "number") return { cell: { v: fv, from: "form", code }, unusable: false };
    // The visible grid is empty where the code table had a value: the grid's own reading is "blank".
    if (fv === null || fv === undefined) return { cell: { v: null, from: null, code }, unusable: false };
    return { cell: { v: null, from: null, code }, unusable: true };
  }
  return { cell: { v: null, from: null, code }, unusable: it?.status === "failed" };
}

/** The grid of one document, and the codes whose items failed for a reason the visible grid can't settle. */
export function readGrid(doc: DocumentRecord): { grid: ResidencyGrid; unusable: CdsCode[] } {
  const unusable: CdsCode[] = [];
  const grid = {} as ResidencyGrid;
  for (const g of RESIDENCY_GROUPS) {
    grid[g] = {} as Record<ResidencyCount, GridCell>;
    for (const c of RESIDENCY_COUNTS) {
      const r = resolveCell(doc, RESIDENCY_CODES[g][c]);
      grid[g][c] = r.cell;
      if (r.unusable) unusable.push(RESIDENCY_CODES[g][c]);
    }
  }
  return { grid, unusable };
}

/** True when the grid has a value in any in-state, out-of-state, or international cell. */
export function gridHasResidency(grid: ResidencyGrid): boolean {
  return SHOWN_GROUPS.some((g) => RESIDENCY_COUNTS.some((c) => grid[g][c].v !== null));
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Within 1% of the total, or within 1 when the total is under 100 (`residency-sum`). */
export function sumMatches(parts: number, total: number): boolean {
  return total < 100 ? Math.abs(parts - total) <= 1 : Math.abs(parts - total) <= total * 0.01;
}

/**
 * The grid checks a merge relies on (`residency-funnel`, `residency-sum`, and `residency-vs-federal` when the school
 * has EF-C shares). Partial rows are allowed: a sum is checked only for a row whose three residency cells are all
 * filled (a blank Unknown counts as 0 only if the sum then matches, which is the same test). A row without a printed
 * total isn't sum-checked here (`residency-total-unreadable` belongs to lib/cds-checks.ts).
 */
export function checkGrid(grid: ResidencyGrid, federal?: School["demographics"]["residence"]): GridFailure[] {
  const out: GridFailure[] = [];
  for (const g of RESIDENCY_GROUPS) {
    const { applicants: ap, admitted: ad, enrolled: en } = grid[g];
    if (ap.v !== null && ad.v !== null && ad.v > ap.v) {
      out.push({ check: "residency-funnel", detail: `${COLUMN_LABEL[g]} admitted ${fmt(ad.v)} > applied ${fmt(ap.v)} (${ad.code}, ${ap.code})` });
    }
    if (ad.v !== null && en.v !== null && en.v > ad.v) {
      out.push({ check: "residency-funnel", detail: `${COLUMN_LABEL[g]} enrolled ${fmt(en.v)} > admitted ${fmt(ad.v)} (${en.code}, ${ad.code})` });
    }
  }
  for (const c of RESIDENCY_COUNTS) {
    const total = grid.total[c].v;
    const parts = SHOWN_GROUPS.map((g) => grid[g][c].v);
    if (total === null || parts.some((p) => p === null)) continue;
    const sum = (parts as number[]).reduce((a, b) => a + b, 0) + (grid.unknown[c].v ?? 0);
    if (!sumMatches(sum, total)) {
      out.push({ check: "residency-sum", detail: `${ROW_LABEL[c]}: parts add up to ${fmt(sum)}, total ${fmt(total)} (${grid.total[c].code})` });
    }
  }
  const enrolledTotal = grid.total.enrolled.v;
  if (federal && enrolledTotal) {
    for (const g of SHOWN_GROUPS) {
      const v = grid[g].enrolled.v;
      if (v === null) continue;
      const share = v / enrolledTotal;
      if (Math.abs(share - federal[g]) > RESIDENCY_FEDERAL_TOLERANCE) {
        out.push({ check: "residency-vs-federal", detail: `${COLUMN_LABEL[g]} enrolled ${(share * 100).toFixed(1)}% of first-years vs ${(federal[g] * 100).toFixed(1)}% federal` });
      }
    }
  }
  return out;
}

/** Why a document's grid wasn't merged, for the run summary and tests. */
export interface GridOutcome {
  edition: string;
  status: "merged" | "blank" | "failed" | "too-old";
  failures: GridFailure[];
}

function lineageFor(doc: DocumentRecord, cell: GridCell, year: string, group: ResidencyGroup, count: ResidencyCount): LineageRecord {
  const cellQuote = `${ROW_LABEL[count]}, ${COLUMN_LABEL[group]}: ${fmt(cell.v!)}`;
  if (cell.from === "item") {
    const rec = lineageFromItem(doc, cell.code, { year });
    // Workbook cells: the generated label + column + value line says which column the number is in.
    return rec.cell ? { ...rec, quote: cellQuote } : rec;
  }
  const form = doc.items[cell.code].form!;
  return {
    source: "college-site",
    method: "extracted",
    year,
    edition: editionLabel(doc.edition),
    url: doc.url,
    retrieved: doc.retrieved,
    quote: cellQuote,
    cell: form.cell,
  };
}

/** The entering class of the grid: the record's C-group fall year label ("Fall 2025"), never a page header. */
function enteringTerm(doc: DocumentRecord): string | null {
  const term = doc.years.fall;
  if (term && /^Fall \d{4}$/.test(term)) return term;
  const fall = editionFallYear(doc.edition);
  return fall === null ? null : `Fall ${fall}`;
}

/**
 * The block and its lineage from a college's record: the newest document whose grid passed, within two falls of
 * `admissionsYear` (when known). Returns null (and the outcomes) when no grid qualifies.
 */
export function residencyFromRecord(
  record: CollegeRecord,
  opts: { admissionsYear?: number | null; federal?: School["demographics"]["residence"] } = {}
): { block: ReportedResidencyAdmissions | null; lineage: Record<string, LineageRecord>; outcomes: GridOutcome[] } {
  const outcomes: GridOutcome[] = [];
  for (const doc of [...record.documents].sort(compareDocuments)) {
    const term = enteringTerm(doc);
    const year = term ? Number(term.slice(5)) : null;
    if (term === null || year === null) {
      outcomes.push({ edition: doc.edition, status: "blank", failures: [] });
      continue;
    }
    const { grid, unusable } = readGrid(doc);
    if (!gridHasResidency(grid)) {
      outcomes.push({ edition: doc.edition, status: "blank", failures: [] });
      continue;
    }
    if (opts.admissionsYear != null && opts.admissionsYear - year > RESIDENCY_MAX_FALLS_BEHIND) {
      outcomes.push({ edition: doc.edition, status: "too-old", failures: [] });
      continue;
    }
    const failures: GridFailure[] = [
      ...unusable.map((code) => ({ check: "residency-unusable-cell" as const, detail: `${code} failed a check the visible grid can't settle` })),
      ...checkGrid(grid, opts.federal),
    ];
    if (failures.length) {
      outcomes.push({ edition: doc.edition, status: "failed", failures });
      continue;
    }
    const lineage: Record<string, LineageRecord> = {};
    const counts = {} as Record<ResidencyGroup, ResidencyCounts>;
    for (const g of RESIDENCY_GROUPS) {
      counts[g] = { applicants: null, admitted: null, enrolled: null };
      for (const c of RESIDENCY_COUNTS) {
        const cell = grid[g][c];
        counts[g][c] = cell.v;
        if (cell.v !== null) lineage[`reported.admissions_by_residency.${g}.${c}`] = lineageFor(doc, cell, term, g, c);
      }
    }
    // The class's own labels cite the first total the grid printed (the C1 heading has no code of its own).
    const anchorPath = (["total", ...SHOWN_GROUPS] as const)
      .flatMap((g) => RESIDENCY_COUNTS.map((c) => `${RESIDENCY_LINEAGE_PREFIX}${g}.${c}`))
      .find((p) => lineage[p]);
    for (const k of ["entering_term", "year", "edition"]) lineage[`${RESIDENCY_LINEAGE_PREFIX}${k}`] = { ...lineage[anchorPath!] };
    const block: ReportedResidencyAdmissions = {
      entering_term: term,
      year,
      edition: doc.edition,
      in_state: counts.in_state,
      out_of_state: counts.out_of_state,
      international: counts.international,
      unknown: counts.unknown,
      total: counts.total,
    };
    outcomes.push({ edition: doc.edition, status: "merged", failures: [] });
    return { block, lineage, outcomes };
  }
  return { block: null, lineage: {}, outcomes };
}

/**
 * The school with its residency block from `record` (or without one). Idempotent: any previous block and its lineage
 * are removed first, and a school that ends with neither keeps its key order and serializes as before.
 */
export function mergeResidency(school: School, record: CollegeRecord | undefined): School {
  const hadLineage = Object.keys(school.lineage ?? {}).some((k) => k.startsWith(RESIDENCY_LINEAGE_PREFIX));
  let out: School = school;
  if (school.reported?.admissions_by_residency || hadLineage) {
    const reported = { ...school.reported };
    delete reported.admissions_by_residency;
    const lineage = Object.fromEntries(Object.entries(school.lineage ?? {}).filter(([k]) => !k.startsWith(RESIDENCY_LINEAGE_PREFIX)));
    out = { ...school, reported, lineage };
    if (!Object.keys(reported).length) delete (out as Partial<School>).reported;
    if (!Object.keys(lineage).length) delete (out as Partial<School>).lineage;
  }
  if (!record) return out;
  const { block, lineage } = residencyFromRecord(record, { admissionsYear: out.admissions.year, federal: out.demographics.residence });
  if (!block) return out;
  return { ...out, lineage: { ...out.lineage, ...lineage }, reported: { ...out.reported, admissions_by_residency: block } };
}
