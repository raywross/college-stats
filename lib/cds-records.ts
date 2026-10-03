/**
 * Reading CDS records (data/cds-records/<unit_id>.json, specs/college-reported-round-3.md Decision 2): the helpers
 * every display spec uses to turn a college's record into `school.reported.*` values with lineage, and the records
 * validator `npm run check:lineage` runs.
 *
 * Pure module: type-only imports plus lib/cds-sections.ts (itself import-free). File reading lives in
 * scripts/lib/college-reported/records.mts.
 */
import type { LineageRecord } from "./types";
import {
  CDS_CODE,
  DOCUMENT_TYPES,
  ITEM_STATUSES,
  monthDay,
  parseEdition,
  READER_VERSIONS,
  SCHEMA_VERSIONS,
  type CdsCode,
  type CollegeDocsFile,
  type CollegeRecord,
  type DocumentRecord,
  type ItemResult,
  type MonthDay,
  type TemplateTable,
} from "./cds-sections.ts";

/* ------------------------------------------------------------------ */
/* Editions                                                            */
/* ------------------------------------------------------------------ */

/** "2025-26" → 2025, the fall the edition's own class entered; null for anything that isn't an edition. */
export function editionFallYear(edition: string | null | undefined): number | null {
  return parseEdition(edition)?.start ?? null;
}

/** "2025-26" → "2025–26" (en dash), the display form lineage records carry as `edition`. */
export function editionLabel(edition: string): string {
  const ed = parseEdition(edition);
  if (!ed) throw new Error(`not a CDS edition: "${edition}"`);
  return `${ed.start}–${String(ed.start + 1).slice(2)}`;
}

/** Newest edition first; for one edition, the latest retrieval first. */
export function compareDocuments(a: DocumentRecord, b: DocumentRecord): number {
  return (editionFallYear(b.edition) ?? 0) - (editionFallYear(a.edition) ?? 0) || b.retrieved.localeCompare(a.retrieved);
}

/** Records by unit id. */
export function indexRecords(records: readonly CollegeRecord[]): Map<string, CollegeRecord> {
  return new Map(records.map((r) => [r.unit_id, r]));
}

/* ------------------------------------------------------------------ */
/* The newest passed values                                            */
/* ------------------------------------------------------------------ */

/** An item when it passed its checks; null otherwise (failed, blank, not read). */
export function passedItem(doc: DocumentRecord, code: CdsCode): ItemResult | null {
  const it = doc.items[code];
  return it?.status === "passed" ? it : null;
}

/**
 * The newest document where the codes passed: all of them (`mode: "all"`, the default, for a block that must come
 * from one class, like C11 with C12), or at least one (`"any"`). `maxEditionsBack` limits how far behind the college's
 * newest document the answer may be (cds-admissions.md: at most two editions, so a college that stopped publishing
 * GPA doesn't keep a five-year-old average). `items` holds the passed items among `codes`.
 */
export function newestPassed(
  college: CollegeRecord,
  codes: readonly CdsCode[],
  opts: { mode?: "all" | "any"; maxEditionsBack?: number } = {}
): { document: DocumentRecord; items: Record<CdsCode, ItemResult> } | null {
  const docs = [...college.documents].sort(compareDocuments);
  const newest = editionFallYear(docs[0]?.edition);
  for (const doc of docs) {
    const fall = editionFallYear(doc.edition);
    if (opts.maxEditionsBack !== undefined && newest !== null && fall !== null && newest - fall > opts.maxEditionsBack) break;
    const items: Record<CdsCode, ItemResult> = {};
    for (const c of codes) {
      const it = passedItem(doc, c);
      if (it) items[c] = it;
    }
    const found = Object.keys(items).length;
    if (opts.mode === "any" ? found > 0 : found === codes.length && found > 0) return { document: doc, items };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Typed accessors: null unless the item passed and has that type      */
/* ------------------------------------------------------------------ */

/** The passed value, whatever its type. */
export function itemValue(doc: DocumentRecord, code: CdsCode): number | string | boolean | null {
  return passedItem(doc, code)?.v ?? null;
}

export function itemNumber(doc: DocumentRecord, code: CdsCode): number | null {
  const v = itemValue(doc, code);
  return typeof v === "number" ? v : null;
}

/** A percent item as a 0–1 share (records store percents as shares). */
export function itemShare(doc: DocumentRecord, code: CdsCode): number | null {
  const v = itemNumber(doc, code);
  return v !== null && v >= 0 && v <= 1.01 ? v : null;
}

export function itemBoolean(doc: DocumentRecord, code: CdsCode): boolean | null {
  const v = itemValue(doc, code);
  return typeof v === "boolean" ? v : null;
}

export function itemText(doc: DocumentRecord, code: CdsCode): string | null {
  const v = itemValue(doc, code);
  return typeof v === "string" ? v : null;
}

/** A one-cell date ("--04-01"), or with `dayCode` a split month/day pair (C.1402 + C.1403). */
export function itemMonthDay(doc: DocumentRecord, code: CdsCode, dayCode?: CdsCode): MonthDay | null {
  if (!dayCode) return monthDay(itemText(doc, code));
  const month = itemNumber(doc, code);
  const day = itemNumber(doc, dayCode);
  return month === null || day === null ? null : monthDay(`${month}/${day}`);
}

/* ------------------------------------------------------------------ */
/* Lineage                                                             */
/* ------------------------------------------------------------------ */

const QUOTE_MAX = 160;

/** The year label of a code's item group in this document (yearsForEdition), or null when the record has none. */
export function itemYear(doc: DocumentRecord, table: TemplateTable, code: CdsCode): string | null {
  const rule = table.byCode.get(code)?.year_rule;
  return (rule && doc.years[rule]) || null;
}

/**
 * The lineage record for a value taken from a record item: source `college-site`, method `extracted` (as printed) or
 * `derived` (computed from printed parts, e.g. a share from two counts: cite the item the reader checks first),
 * the document's url and retrieval date, the quote (≤ 160 characters), where it is (page and line, cell, or field),
 * the year the caller's spec gives the value (usually `itemYear`), and the edition. Throws when the item didn't pass
 * or has no quote, so an uncitable value can't be published.
 */
export function lineageFromItem(
  doc: DocumentRecord,
  code: CdsCode,
  opts: { year: string; method?: "extracted" | "derived"; path?: string }
): LineageRecord {
  const it = doc.items[code];
  const where = `${opts.path ?? code} (${code}, ${doc.url})`;
  if (it?.status !== "passed") throw new Error(`${where}: item ${it?.status ?? "missing"}, not passed`);
  if (!it.quote) throw new Error(`${where}: no quote`);
  if (!opts.year) throw new Error(`${where}: no year`);
  const quote = it.quote.length <= QUOTE_MAX ? it.quote : `${it.quote.slice(0, QUOTE_MAX - 1)}…`;
  return {
    source: "college-site",
    method: opts.method ?? "extracted",
    year: opts.year,
    edition: editionLabel(doc.edition),
    url: doc.url,
    retrieved: doc.retrieved,
    quote,
    ...(it.page !== undefined ? { page: it.page } : {}),
    ...(it.cell ? { cell: it.cell } : {}),
    ...(it.field ? { field: it.field } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Validation (npm run check:lineage)                                  */
/* ------------------------------------------------------------------ */

const STATUSES = new Set<string>(ITEM_STATUSES);
const TYPES = new Set<string>(DOCUMENT_TYPES);

/**
 * Problems with the committed records (Decision 2's validator): every document's sha256 is in the manifest for that
 * college; its edition parses; it was read at a known schema or reader version; every item is a template code with a
 * known status; every passed value says where it is (page and line, a cell, or a form field) and, for an item a spec
 * owns, quotes it; failed items say why; and every item group with a passed value has a year.
 */
export function validateCdsRecords(records: readonly CollegeRecord[], manifest: CollegeDocsFile, table: TemplateTable): string[] {
  const errors: string[] = [];
  const bySha = new Map(manifest.documents.map((d) => [d.sha256, d]));
  for (const rec of records) {
    const at = `cds-records/${rec.unit_id}`;
    if (!/^\d+$/.test(rec.unit_id)) errors.push(`${at}: unit_id "${rec.unit_id}" isn't an IPEDS id`);
    if (!rec.documents.length) errors.push(`${at}: no documents`);
    const sorted = [...rec.documents].sort(compareDocuments);
    if (sorted.some((d, i) => d !== rec.documents[i])) errors.push(`${at}: documents aren't newest first`);
    for (const doc of rec.documents) {
      const where = `${at} ${doc.edition} ${doc.sha256.slice(0, 8)}`;
      const entry = bySha.get(doc.sha256);
      if (!entry) errors.push(`${where}: sha256 isn't in data/college-docs.json`);
      else if (entry.unit_id !== rec.unit_id) errors.push(`${where}: the manifest lists this document for ${entry.unit_id}`);
      if (!parseEdition(doc.edition)) errors.push(`${where}: edition "${doc.edition}" isn't an edition`);
      if (!TYPES.has(doc.type)) errors.push(`${where}: unknown document type "${doc.type}"`);
      if (!doc.url || !/^\d{4}-\d{2}-\d{2}$/.test(doc.retrieved ?? "")) errors.push(`${where}: needs url and an ISO retrieved date`);
      const reads = Object.entries(doc.reads ?? {});
      if (!reads.length) errors.push(`${where}: no reads`);
      for (const [key, read] of reads) {
        if (!read) continue;
        if (read.mode === "deterministic") {
          const current = READER_VERSIONS[read.read_by];
          if (key !== "deterministic" || current === undefined || read.schema_version < 1 || read.schema_version > current) {
            errors.push(`${where}: unknown deterministic read ${key} ${read.read_by} v${read.schema_version}`);
          }
        } else {
          const current = SCHEMA_VERSIONS[key as keyof typeof SCHEMA_VERSIONS];
          if (current === undefined || read.schema_version < 1 || read.schema_version > current) {
            errors.push(`${where}: call ${key} has unknown schema_version ${read.schema_version}`);
          }
        }
      }
      const needYear = new Set<string>();
      for (const [code, it] of Object.entries(doc.items)) {
        const item = table.byCode.get(code);
        if (!CDS_CODE.test(code) || !item) {
          errors.push(`${where}: ${code} isn't a ${table.edition} template code`);
          continue;
        }
        if (!STATUSES.has(it.status)) errors.push(`${where}: ${code} has unknown status "${it.status}"`);
        if (it.status === "failed" && !it.failures?.length) errors.push(`${where}: ${code} failed without saying why`);
        if (it.status !== "passed") continue;
        if (it.v === undefined || it.v === null) errors.push(`${where}: ${code} passed with no value`);
        const located = (it.page !== undefined && (it.line !== undefined || !!it.lines?.length)) || !!it.cell || !!it.field;
        if (!located) errors.push(`${where}: ${code} passed without a page and line, cell, or field`);
        if (item.owner && !it.quote) errors.push(`${where}: ${code} is shown by ${item.owner} but has no quote`);
        if (it.quote && it.quote.length > QUOTE_MAX) errors.push(`${where}: ${code} quote is over ${QUOTE_MAX} characters`);
        needYear.add(item.year_rule);
      }
      for (const rule of needYear) {
        if (!doc.years?.[rule as keyof typeof doc.years]) errors.push(`${where}: passed items need a year for group "${rule}"`);
      }
    }
  }
  return errors;
}
