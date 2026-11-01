/**
 * What `collegeHealth()` judges from, and how it is gathered (specs/product/admin.md "Health").
 *
 * Pure module (type-only imports plus health-rules.ts), so the data PR script (`npm run college-health`), its check,
 * and the tests load it directly; lib/admin/health.ts is the side that runs only on the server. Two paths lead to the same inputs:
 *
 *   - the source files (college-docs, cds-records, college-failures, review-queue, link-issues, plus the dataset's
 *     lineage), read by scripts/lib/college-health.mts: `indexHealthFiles()` then `healthInputsFor()`;
 *   - `data/college-health.json`, the compact file the script writes from them with exactly what the rules need per
 *     college (about 1 MB where the sources are 42 MB). The deployed page reads only this: `inputsFromCompact()`.
 *
 * `compactHealth()` keeps only the documents the rules look at (`pickReportedDocs`, shared with `collegeHealth()`),
 * so both paths give the same `CollegeHealth`; tests/admin-health.test.mts checks that on the real data.
 */
import type { School } from "../types";
import { CAMPUS_LINEAGE_KEYS, CORE_FEDERAL_FIELDS, IDENTITY_LINEAGE_PREFIXES, editionStart } from "./health-rules.ts";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** One document from the manifest, joined with what was read from it. */
export interface ReportedDoc {
  kind: "cds" | "class-profile";
  /** "2025-26"; null when none was detected. */
  edition: string | null;
  type: string;
  retrieved: string;
  url: string;
  /** Section letters the manifest says were archived; null when it lists none (an HTML page). */
  archivedSections: string[] | null;
  /** Keys of the record's reads ("C", "rest", "deterministic"); null when the document has no record (never read). */
  reads: string[] | null;
  /** The newest `extracted` date among the reads. */
  extracted: string | null;
}

export interface FailureInput {
  reason: string;
  stage: string;
  url: string | null;
  lastRun: string | null;
}

export interface LinkIssueInput {
  field: string;
  url: string;
  status: number | null;
}

/** Everything `collegeHealth()` judges from. Built by `healthInputsFor()`; tests write them by hand. */
export interface HealthInputs {
  /** ISO date "today" is measured from. */
  today: string;
  federal: { retrieved: string | null; missing: string[] };
  /** Null when the college-reported files are not in this deploy. */
  reported: { docs: ReportedDoc[]; failures: FailureInput[]; queueItems: number } | null;
  /** `linkIssues` null when data/link-issues.json is not in this deploy. */
  identity: { newest: string | null; linkIssues: LinkIssueInput[] | null };
  campus: { newest: string | null };
  changes: { at: string; fields: number } | null;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The later of two ISO dates; a null loses to a date. */
export const newer = (a: string | null, b: string | null): string | null => (a && b ? (a >= b ? a : b) : (a ?? b));

/* ------------------------------------------------------------------ */
/* Inputs from the files                                               */
/* ------------------------------------------------------------------ */

/** The slice of a school the health rules read. */
export type HealthSchool = Pick<School, "unit_id" | "name" | "admissions" | "cost" | "outcomes" | "lineage">;

function valueAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** The core federal fields this college lacks, as their labels. */
export function missingCoreFields(school: HealthSchool): string[] {
  return CORE_FEDERAL_FIELDS.filter((f) => !f.paths.some((p) => valueAt(school, p) != null)).map((f) => f.label);
}

/** Whether a lineage key is one of `keys` or under one of them ("campus." matches "campus.housing"; "religion" matches "religion.cccu_member"). */
function lineageKeyMatches(key: string, keys: readonly string[]): boolean {
  return keys.some((k) => (k.endsWith(".") ? key.startsWith(k) : key === k || key.startsWith(`${k}.`)));
}

/** The newest `retrieved` date among the college's lineage records under `keys`; null when none is dated. */
export function newestLineageDate(lineage: Readonly<Record<string, { retrieved?: string } | undefined>> | undefined, keys: readonly string[]): string | null {
  let newest: string | null = null;
  for (const [key, rec] of Object.entries(lineage ?? {})) {
    const retrieved = rec?.retrieved;
    if (retrieved && lineageKeyMatches(key, keys)) newest = newer(newest, retrieved);
  }
  return newest;
}

/** A manifest document, as data/college-docs.json lists it (only what health reads). */
export interface ManifestDocLite {
  sha256: string;
  unit_id: string;
  url: string;
  kind: "cds" | "class-profile";
  type: string;
  edition: string | null;
  retrieved: string;
  sections?: Record<string, unknown>;
}

/** What health reads from one record document (data/cds-records/<unit>.json). */
export interface RecordDocLite {
  sha256: string;
  edition: string | null;
  reads: string[];
  extracted: string | null;
}

/** A row of data/college-failures.json (only what health reads). */
export interface FailureRowLite {
  unit_id: string;
  reason_code: string;
  stage: string;
  url: string | null;
  last_run: string | null;
}

/** A row of data/link-issues.json. */
export interface LinkIssueRowLite {
  unit_id: string;
  field: string;
  url: string;
  last_status: number | null;
}

/** The five files, reduced to what health reads. A null file was not in this deploy. */
export interface HealthFiles {
  manifest: ManifestDocLite[] | null;
  /** Record documents by unit id. */
  records: Map<string, RecordDocLite[]> | null;
  failures: FailureRowLite[] | null;
  /** Review-queue items per unit id. */
  queue: Map<string, number> | null;
  linkIssues: LinkIssueRowLite[] | null;
}

/** One record file reduced to the reads that were made and when. */
export function summarizeRecord(record: { documents?: { sha256: string; edition?: string | null; reads?: Record<string, { extracted?: string } | undefined> }[] }): RecordDocLite[] {
  return (record.documents ?? []).map((d) => {
    const reads = Object.entries(d.reads ?? {}).filter(([, v]) => v);
    return {
      sha256: d.sha256,
      edition: d.edition ?? null,
      reads: reads.map(([k]) => k),
      extracted: reads.reduce<string | null>((acc, [, v]) => newer(acc, v?.extracted ?? null), null),
    };
  });
}

/** The files grouped by college, built once. */
export interface HealthIndex {
  docs: Map<string, ReportedDoc[]> | null;
  failures: Map<string, FailureInput[]> | null;
  queue: Map<string, number> | null;
  linkIssues: Map<string, LinkIssueInput[]> | null;
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function mapGroups<T, V>(items: readonly T[], key: (t: T) => string, value: (t: T) => V): Map<string, V[]> {
  const out = new Map<string, V[]>();
  for (const [k, list] of groupBy(items, key)) out.set(k, list.map(value));
  return out;
}

/** Each college's list in a fixed order, so the same sources always give the same inputs (and the same compact file). */
function sortLists<V>(map: Map<string, V[]>, compare: (a: V, b: V) => number): Map<string, V[]> {
  for (const list of map.values()) list.sort(compare);
  return map;
}

export function indexHealthFiles(files: HealthFiles): HealthIndex {
  let docs: HealthIndex["docs"] = null;
  // Documents need the manifest; the records say what was read. Without the records every document reads as never read,
  // which would mislead, so reported is judged only when both are present.
  if (files.manifest && files.records && files.failures && files.queue) {
    const records = files.records;
    const recordBySha = new Map<string, RecordDocLite>();
    for (const docsOfUnit of records.values()) for (const d of docsOfUnit) recordBySha.set(d.sha256, d);
    docs = new Map();
    for (const [unit, entries] of groupBy(files.manifest, (m) => m.unit_id)) {
      docs.set(
        unit,
        entries.map((m) => {
          const rec = recordBySha.get(m.sha256);
          return {
            kind: m.kind,
            edition: rec?.edition ?? m.edition ?? null,
            type: m.type,
            retrieved: m.retrieved,
            url: m.url,
            archivedSections: m.sections ? Object.keys(m.sections) : null,
            reads: rec ? rec.reads : null,
            extracted: rec?.extracted ?? null,
          };
        })
      );
    }
  }
  return {
    docs,
    failures: files.failures
      ? sortLists(mapGroups(files.failures, (f) => f.unit_id, (f) => ({ reason: f.reason_code, stage: f.stage, url: f.url, lastRun: f.last_run })), (a, b) => byText(a.reason, b.reason) || byText(a.stage, b.stage) || byText(a.url ?? "", b.url ?? ""))
      : null,
    queue: files.queue,
    linkIssues: files.linkIssues ? sortLists(mapGroups(files.linkIssues, (l) => l.unit_id, (l) => ({ field: l.field, url: l.url, status: l.last_status })), (a, b) => byText(a.field, b.field) || byText(a.url, b.url)) : null,
  };
}

/** The inputs for one college. `metaRetrieved` is `data/meta.json` `retrieved`: when the federal data was last pulled. */
export function healthInputsFor(
  school: HealthSchool,
  index: HealthIndex,
  ctx: { today: string; metaRetrieved: string | null; changes: ReadonlyMap<string, { at: string; fields: number }> | null }
): HealthInputs {
  const unit = school.unit_id;
  return {
    today: ctx.today,
    federal: { retrieved: ctx.metaRetrieved, missing: missingCoreFields(school) },
    reported: index.docs && index.failures && index.queue ? { docs: index.docs.get(unit) ?? [], failures: index.failures.get(unit) ?? [], queueItems: index.queue.get(unit) ?? 0 } : null,
    identity: { newest: newestLineageDate(school.lineage, IDENTITY_LINEAGE_PREFIXES), linkIssues: index.linkIssues ? (index.linkIssues.get(unit) ?? []) : null },
    campus: { newest: newestLineageDate(school.lineage, CAMPUS_LINEAGE_KEYS) },
    changes: ctx.changes?.get(unit) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Which documents the rules look at                                   */
/* ------------------------------------------------------------------ */

/**
 * The documents the reported rules read: the newest Common Data Set with a stated edition (newest edition, then the
 * latest retrieval), the newest class profile, and every Common Data Set (to tell "no document" from "no stated
 * edition"). `collegeHealth()` and the compact file both use this, so they cannot disagree.
 */
export function pickReportedDocs(docs: readonly ReportedDoc[]): { edition: ReportedDoc | null; profile: ReportedDoc | null; cds: ReportedDoc[] } {
  const cds = docs.filter((d) => d.kind === "cds");
  const byNewest = (a: ReportedDoc, b: ReportedDoc) => (editionStart(b.edition) ?? 0) - (editionStart(a.edition) ?? 0) || b.retrieved.localeCompare(a.retrieved);
  const edition = cds.filter((d) => editionStart(d.edition) !== null).sort(byNewest)[0] ?? null;
  const profile = docs.filter((d) => d.kind === "class-profile").sort((a, b) => b.retrieved.localeCompare(a.retrieved))[0] ?? null;
  return { edition, profile, cds };
}

/** The documents worth keeping in the compact file: what `pickReportedDocs` would choose from, and nothing else. */
export function reduceReportedDocs(docs: readonly ReportedDoc[]): ReportedDoc[] {
  const { edition, profile, cds } = pickReportedDocs(docs);
  const out: ReportedDoc[] = [];
  if (edition) out.push(edition);
  else if (cds.length) out.push([...cds].sort((a, b) => b.retrieved.localeCompare(a.retrieved))[0]);
  if (profile) out.push(profile);
  return out;
}

/* ------------------------------------------------------------------ */
/* The compact file: data/college-health.json                          */
/* ------------------------------------------------------------------ */

export const COMPACT_VERSION = 1;

/** One college's slice: every input of `collegeHealth()` except today's date and what changed. */
export interface CompactCollege {
  /** Core federal fields the college lacks (their labels). */
  missing: string[];
  docs: ReportedDoc[];
  failures: FailureInput[];
  /** Review-queue items held for the college. */
  queue: number;
  linkIssues: LinkIssueInput[];
  /** Newest `retrieved` among links, social, and brand lineage. */
  identity: string | null;
  /** Newest `retrieved` among directories, campus, religion, and LGBTQ lineage. */
  campus: string | null;
}

export interface CompactHealth {
  version: typeof COMPACT_VERSION;
  /** The newest date among the sources (not the day it was run), so the same sources always give the same file. */
  generated: string;
  /** `data/meta.json` `retrieved`: when the federal data was pulled; the Federal row is judged by it. */
  federalRetrieved: string | null;
  /** By unit id. */
  colleges: Record<string, CompactCollege>;
}

/** Builds the compact file's content from the sources. Pure and deterministic. */
export function compactHealth(files: HealthFiles, schools: readonly HealthSchool[], ctx: { metaRetrieved: string | null; generated: string }): CompactHealth {
  if (!files.manifest || !files.records || !files.failures || !files.queue || !files.linkIssues) {
    throw new Error("compactHealth: every source file is required (college-docs, cds-records, college-failures, review-queue, link-issues)");
  }
  const index = indexHealthFiles(files);
  const colleges: Record<string, CompactCollege> = {};
  for (const school of [...schools].sort((a, b) => byText(a.unit_id, b.unit_id))) {
    const inputs = healthInputsFor(school, index, { today: "", metaRetrieved: ctx.metaRetrieved, changes: null });
    const reported = inputs.reported!;
    colleges[school.unit_id] = {
      missing: inputs.federal.missing,
      docs: reduceReportedDocs(reported.docs),
      failures: reported.failures,
      queue: reported.queueItems,
      linkIssues: inputs.identity.linkIssues ?? [],
      identity: inputs.identity.newest,
      campus: inputs.campus.newest,
    };
  }
  return { version: COMPACT_VERSION, generated: ctx.generated, federalRetrieved: ctx.metaRetrieved, colleges };
}

/** The inputs for one college from the compact file; null when the college is not in it. */
export function inputsFromCompact(compact: CompactHealth, unit: string, ctx: { today: string; changes: ReadonlyMap<string, { at: string; fields: number }> | null }): HealthInputs | null {
  const c = compact.colleges[unit];
  if (!c) return null;
  return {
    today: ctx.today,
    federal: { retrieved: compact.federalRetrieved, missing: c.missing },
    reported: { docs: c.docs, failures: c.failures, queueItems: c.queue },
    identity: { newest: c.identity, linkIssues: c.linkIssues },
    campus: { newest: c.campus },
    changes: ctx.changes?.get(unit) ?? null,
  };
}

/** The file's text: one line per college so a data PR's diff shows which colleges moved. Deterministic. */
export function formatCompact(compact: CompactHealth): string {
  const head = `{\n"version": ${compact.version},\n"generated": ${JSON.stringify(compact.generated)},\n"federalRetrieved": ${JSON.stringify(compact.federalRetrieved)},\n"colleges": {\n`;
  const body = Object.entries(compact.colleges).map(([unit, c]) => `${JSON.stringify(unit)}: ${JSON.stringify(c)}`);
  return `${head}${body.join(",\n")}\n}\n}\n`;
}

/** Parses the file, refusing a shape this code does not know (a newer file under older code, or a hand edit). */
export function parseCompact(text: string): CompactHealth {
  const data = JSON.parse(text) as Partial<CompactHealth> | null;
  if (!data || typeof data !== "object" || data.version !== COMPACT_VERSION || typeof data.generated !== "string" || !data.colleges || typeof data.colleges !== "object") {
    throw new Error(`the health document is not version ${COMPACT_VERSION} of the compact health file; run npm run college-health`);
  }
  return data as CompactHealth;
}
