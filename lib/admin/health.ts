import "server-only";
/**
 * Data health per college (specs/product/admin.md "Health"): when we received data, group by group, and what decides
 * each status. Nothing new is collected; health is read from what is already on hand:
 *
 *   - the dataset's lineage (`retrieved` on links, social, brand, directories, religion, LGBTQ records),
 *   - the college-reported documents (`data/college-docs.json`, `data/cds-records/<unit>.json`),
 *   - the pipeline's open failures (`data/college-failures.json`) and review queue (`data/review-queue.json`),
 *   - the link prober's findings (`data/link-issues.json`),
 *   - each publish's changed fields (`dataset_changes` in Supabase; informational).
 *
 * `collegeHealth()` is pure and takes its thresholds from lib/admin/health-rules.ts, so the tests pin both.
 * `healthOverview()` builds the inputs for every college once per server instance and caches them; the changes read is
 * kept for a few minutes only, since "Publish changes" writes it after the deploy that started the instance.
 *
 * Server only (reads files and, for `familyListUnits`, the admin's own Supabase session): never import this from a
 * client component. The types and rules a client may need are in health-rules.ts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../types";
import {
  CAMPUS_LINEAGE_KEYS,
  CHANGES_PUBLISHES_READ,
  CHANGES_TTL_MS,
  CORE_FEDERAL_FIELDS,
  HEALTH_GROUPS,
  HEALTH_RULES,
  HEALTH_STATUSES,
  IDENTITY_LINEAGE_PREFIXES,
  editionStart,
  statusRank,
  type HealthGroup,
  type HealthRules,
  type HealthStatus,
} from "./health-rules.ts";

export { HEALTH_GROUPS, HEALTH_STATUSES, type HealthGroup, type HealthStatus } from "./health-rules.ts";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface HealthRow {
  group: HealthGroup;
  /** Null when the group could not be judged (its files are not in this deploy); never counted toward overall. */
  status: HealthStatus | null;
  /** ISO date the status is judged by: the newest retrieval, or the newest failure run. Null when there is none. */
  judgedBy: string | null;
  /** What decided the status, in a sentence. */
  reason: string;
  /** The document or failing page the reason names. */
  link?: string;
}

export interface CollegeHealth {
  unitId: string;
  overall: HealthStatus;
  /** One row per group, in HEALTH_GROUPS order. */
  rows: HealthRow[];
  /** The newest publish that changed this college: its date (ISO) and how many fields. Informational; null when none is known. */
  changed: { at: string; fields: number } | null;
  /** Open `college_data_failures` rows for the college. */
  failures: { reason: string; stage: string }[];
  /** Review-queue items held for the college. */
  queueItems: number;
}

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

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** Whole days from `from` to `to` (ISO dates or timestamps; the date part is used). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
}

const newer = (a: string | null, b: string | null): string | null => (a && b ? (a >= b ? a : b) : (a ?? b));

const dayLabel = (iso: string, today: string) => {
  const age = daysBetween(iso, today);
  return age <= 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} (${age} day${age === 1 ? "" : "s"} ago)`;
};

const words = (code: string) => code.replace(/_/g, " ");

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ */
/* The rows                                                            */
/* ------------------------------------------------------------------ */

function federalRow(inputs: HealthInputs): HealthRow {
  const { retrieved, missing } = inputs.federal;
  if (!missing.length) {
    return { group: "federal", status: "fresh", judgedBy: retrieved, reason: `All ${CORE_FEDERAL_FIELDS.length} core fields present (${CORE_FEDERAL_FIELDS.map((f) => f.label).join(", ")}).` };
  }
  // Federal data has no Stale or Failing: a field a college does not report (an open-admission college has no admit rate) is a Watch.
  return { group: "federal", status: "watch", judgedBy: retrieved, reason: `Missing ${plural(missing.length, "core field")}: ${missing.join(", ")}.` };
}

/** Which of a document's calls were archived but never read, in words; empty when everything archived was read. */
export function unreadParts(doc: Pick<ReportedDoc, "archivedSections" | "reads">): string[] {
  if (doc.reads === null) return ["the document (no record)"];
  if (doc.reads.includes("deterministic")) return [];
  const archived = doc.archivedSections;
  const out: string[] = [];
  if ((archived === null || archived.includes("C")) && !doc.reads.includes("C")) out.push("section C");
  if ((archived === null || archived.some((s) => s !== "C")) && !doc.reads.includes("rest")) out.push("the other sections");
  return out;
}

function reportedRow(inputs: HealthInputs, rules: HealthRules["reported"]): HealthRow {
  const r = inputs.reported;
  if (!r) {
    return { group: "reported", status: null, judgedBy: null, reason: "Not judged: the college-reported files (data/college-docs.json and the rest) are not in this deploy." };
  }
  const cds = r.docs.filter((d) => d.kind === "cds");
  const profiles = r.docs.filter((d) => d.kind === "class-profile");
  const byNewest = (a: ReportedDoc, b: ReportedDoc) => (editionStart(b.edition) ?? 0) - (editionStart(a.edition) ?? 0) || b.retrieved.localeCompare(a.retrieved);
  const edition = cds.filter((d) => editionStart(d.edition) !== null).sort(byNewest)[0] ?? null;
  const profile = [...profiles].sort((a, b) => b.retrieved.localeCompare(a.retrieved))[0] ?? null;

  // Failing: an open failure at fetch or read, or held values with a review-queue item to resolve.
  const deciding = r.failures.filter((f) => rules.failingStages.includes(f.stage) || (f.reason === rules.failingWithQueueReason && r.queueItems > 0));
  if (deciding.length) {
    const codes = [...new Set(deciding.map((f) => `${words(f.reason)} (${f.stage})`))];
    const lastRun = deciding.reduce<string | null>((acc, f) => newer(acc, f.lastRun), null);
    const queued = deciding.some((f) => f.reason === rules.failingWithQueueReason) ? `; ${plural(r.queueItems, "review-queue item")} waiting` : "";
    return {
      group: "reported",
      status: "failing",
      judgedBy: lastRun ?? edition?.retrieved ?? null,
      reason: `${plural(deciding.length, "open failure")}: ${codes.join(", ")}${queued}.`,
      link: deciding.find((f) => f.url)?.url ?? edition?.url ?? undefined,
    };
  }

  if (!edition) {
    if (profile) {
      return { group: "reported", status: "watch", judgedBy: profile.retrieved, reason: "Class profile only: no Common Data Set with a stated edition.", link: profile.url };
    }
    return { group: "reported", status: "stale", judgedBy: null, reason: cds.length ? "No document with a stated edition." : "No document found." };
  }

  const current = editionStart(rules.currentEdition) ?? 0;
  const behind = current - (editionStart(edition.edition) ?? current);
  const read = edition.extracted ? `, read ${edition.extracted}` : "";
  const base = `${edition.edition} edition, retrieved ${edition.retrieved}${read}`;
  if (behind >= rules.staleEditionsBehind) {
    return { group: "reported", status: "stale", judgedBy: edition.retrieved, reason: `${base}: ${plural(behind, "edition")} behind ${rules.currentEdition}.`, link: edition.url };
  }
  const unread = unreadParts(edition);
  if (behind >= rules.watchEditionsBehind) {
    const also = unread.length ? `; ${unread.join(" and ")} archived but not read` : "";
    return { group: "reported", status: "watch", judgedBy: edition.retrieved, reason: `${base}: ${plural(behind, "edition")} behind ${rules.currentEdition}${also}.`, link: edition.url };
  }
  if (unread.length) {
    return { group: "reported", status: "watch", judgedBy: edition.retrieved, reason: `${base}: ${unread.join(" and ")} archived but not read.`, link: edition.url };
  }
  return { group: "reported", status: "fresh", judgedBy: edition.retrieved, reason: `${base}; every section read.`, link: edition.url };
}

function identityRow(inputs: HealthInputs, rules: HealthRules["identity"]): HealthRow {
  const { newest, linkIssues } = inputs.identity;
  if (linkIssues === null) {
    return { group: "identity", status: null, judgedBy: newest, reason: "Not judged: data/link-issues.json is not in this deploy." };
  }
  const issue = linkIssues[0];
  const dead = linkIssues.length ? ` ${plural(linkIssues.length, "dead link")}: ${linkIssues.map((i) => `${i.field}${i.status ? ` ${i.status}` : ""}`).join(", ")}.` : "";
  if (!newest) {
    return { group: "identity", status: "stale", judgedBy: null, reason: `No probe on record.${dead}`, link: issue?.url };
  }
  const age = daysBetween(newest, inputs.today);
  let status: HealthStatus = age <= rules.freshDays ? "fresh" : age <= rules.watchDays ? "watch" : "stale";
  if (status === "fresh" && linkIssues.length) status = "watch";
  const probed = `Probed ${dayLabel(newest, inputs.today)}.`;
  return { group: "identity", status, judgedBy: newest, reason: `${probed}${dead || " No link issues."}`, link: issue?.url };
}

function campusRow(inputs: HealthInputs, rules: HealthRules["campus"]): HealthRow {
  const { newest } = inputs.campus;
  if (!newest) {
    return { group: "campus", status: rules.neverCollected, judgedBy: null, reason: "Never collected: no directory, religion, or LGBTQ record is dated." };
  }
  const age = daysBetween(newest, inputs.today);
  const status: HealthStatus = age <= rules.freshDays ? "fresh" : age <= rules.watchDays ? "watch" : "stale";
  return { group: "campus", status, judgedBy: newest, reason: `Collected ${dayLabel(newest, inputs.today)}.` };
}

/**
 * One college's health. Pure: the same inputs and rules give the same answer. Overall is the worst row's status in the
 * order Failing > Stale > Watch > Fresh; a group that could not be judged (null) is left out, and a college with no
 * judged group is Fresh by default.
 */
export function collegeHealth(unitId: string, inputs: HealthInputs, rules: HealthRules = HEALTH_RULES): CollegeHealth {
  const rows = [federalRow(inputs), reportedRow(inputs, rules.reported), identityRow(inputs, rules.identity), campusRow(inputs, rules.campus)];
  const overall = rows.reduce<HealthStatus>((worst, row) => (row.status && statusRank(row.status) > statusRank(worst) ? row.status : worst), "fresh");
  return {
    unitId,
    overall,
    rows,
    changed: inputs.changes,
    failures: (inputs.reported?.failures ?? []).map((f) => ({ reason: f.reason, stage: f.stage })),
    queueItems: inputs.reported?.queueItems ?? 0,
  };
}

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
      ? mapGroups(files.failures, (f) => f.unit_id, (f) => ({ reason: f.reason_code, stage: f.stage, url: f.url, lastRun: f.last_run }))
      : null,
    queue: files.queue,
    linkIssues: files.linkIssues ? mapGroups(files.linkIssues, (l) => l.unit_id, (l) => ({ field: l.field, url: l.url, status: l.last_status })) : null,
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
/* What changed (dataset_changes)                                      */
/* ------------------------------------------------------------------ */

/** The two reads the newest-change lookup needs; the default wraps Supabase, tests pass a fake. */
export interface ChangesReader {
  /** The newest publish with an id below `before` (the newest overall when null): its id and ISO time. */
  newestPublishBefore(before: number | null): Promise<{ id: number; at: string } | null>;
  /** The college of every changed field in a publish (one entry per field). */
  unitsOfPublish(publishId: number): Promise<string[]>;
}

/**
 * Each college's newest change: the date of the newest publish that changed it, and how many fields it changed. Reads
 * the newest `publishes` publishes, newest first; a college not changed in any of them has none.
 */
export async function latestChanges(reader: ChangesReader, publishes: number = CHANGES_PUBLISHES_READ): Promise<Map<string, { at: string; fields: number }>> {
  const out = new Map<string, { at: string; fields: number }>();
  let before: number | null = null;
  for (let i = 0; i < publishes; i++) {
    const publish = await reader.newestPublishBefore(before);
    if (!publish) break;
    const counts = new Map<string, number>();
    for (const unit of await reader.unitsOfPublish(publish.id)) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    for (const [unit, fields] of counts) if (!out.has(unit)) out.set(unit, { at: publish.at.slice(0, 10), fields });
    before = publish.id;
  }
  return out;
}

const PAGE = 1000;
/** A hard stop on paging so a runaway table cannot hang the page: 100,000 rows. */
const MAX_PAGES = 100;

type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
interface QueryLike<T> extends Rows<T> {
  eq(column: string, value: unknown): QueryLike<T>;
  lt(column: string, value: unknown): QueryLike<T>;
  order(column: string, opts?: { ascending?: boolean }): QueryLike<T>;
  range(from: number, to: number): QueryLike<T>;
  limit(n: number): QueryLike<T>;
}
/** The slice of a Supabase client the two reads use. */
export interface TableClient {
  from(table: string): { select(columns: string): QueryLike<Record<string, unknown>> };
}

/** Pages `build(range)` until a short page; throws on an error, or when the cap is hit (an incomplete read would mislead). */
async function readAll<T>(build: (from: number, to: number) => Rows<T>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Supabase: reading ${what} failed: ${error.message}`);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
  throw new Error(`Supabase: ${what} has more than ${MAX_PAGES * PAGE} rows; refusing to read a partial list`);
}

export function supabaseChangesReader(client: TableClient): ChangesReader {
  return {
    async newestPublishBefore(before) {
      let q = client.from("dataset_changes").select("publish_id, published_at").order("publish_id", { ascending: false }).limit(1);
      if (before !== null) q = q.lt("publish_id", before);
      const { data, error } = await q;
      if (error) throw new Error(`Supabase: reading the newest publish failed: ${error.message}`);
      const row = data?.[0];
      return row ? { id: Number(row.publish_id), at: String(row.published_at) } : null;
    },
    async unitsOfPublish(publishId) {
      const rows = await readAll((from, to) => client.from("dataset_changes").select("unit_id").eq("publish_id", publishId).order("id").range(from, to), `the changes of publish ${publishId}`);
      return rows.map((r) => String(r.unit_id));
    },
  };
}

/* ------------------------------------------------------------------ */
/* On a family's list                                                  */
/* ------------------------------------------------------------------ */

let familyWarned = false;

/**
 * Every college on any family's list (distinct `list_items.unit_id`), read through the signed-in admin's own session and
 * the admin policy (lib/supabase-server.ts), or null when that read is unavailable: sign-in isn't configured, the
 * policy or table isn't there, the read failed, or it was too large to read whole. Callers show "on a family's list" as
 * unavailable rather than as empty. Not cached: it depends on who is asking and changes as families work.
 */
export async function familyListUnits(deps: { client?: () => Promise<TableClient | null> } = {}): Promise<ReadonlySet<string> | null> {
  try {
    const client = await (deps.client ?? defaultAdminClient)();
    if (!client) return null;
    const rows = await readAll((from, to) => client.from("list_items").select("unit_id").order("unit_id").order("id").range(from, to), "list_items");
    return new Set(rows.map((r) => String(r.unit_id)));
  } catch (err) {
    if (!familyWarned) {
      familyWarned = true;
      console.error("[admin health] reading the colleges on families' lists failed; the filter is unavailable.", err);
    }
    return null;
  }
}

async function defaultAdminClient(): Promise<TableClient | null> {
  const { supabaseAuthEnv, createServerSupabase } = await import("../supabase-server");
  if (!supabaseAuthEnv()) return null;
  return (await createServerSupabase()) as unknown as TableClient;
}

/* ------------------------------------------------------------------ */
/* The overview                                                        */
/* ------------------------------------------------------------------ */

export interface HealthCounts {
  total: number;
  overall: Record<HealthStatus, number>;
  /** Per group; `unjudged` counts colleges whose group had no files to judge from. */
  groups: Record<HealthGroup, Record<HealthStatus | "unjudged", number>>;
}

export interface HealthOverview {
  /** Worst first (then by how many groups are not fresh, then unit id). */
  colleges: CollegeHealth[];
  counts: HealthCounts;
  /** ISO date the overview was measured on. */
  today: string;
  /** False when `dataset_changes` could not be read (no Supabase configured, or the read failed): `changed` is null for every college. */
  changesAvailable: boolean;
}

export function countHealth(colleges: readonly CollegeHealth[]): HealthCounts {
  const zero = () => Object.fromEntries(HEALTH_STATUSES.map((s) => [s, 0])) as Record<HealthStatus, number>;
  const groups = Object.fromEntries(HEALTH_GROUPS.map((g) => [g, { ...zero(), unjudged: 0 }])) as HealthCounts["groups"];
  const overall = zero();
  for (const c of colleges) {
    overall[c.overall]++;
    for (const row of c.rows) groups[row.group][row.status ?? "unjudged"]++;
  }
  return { total: colleges.length, overall, groups };
}

/** Worst overall first; then more non-fresh groups first; then unit id, so the order is stable. */
export function sortWorstFirst(colleges: CollegeHealth[]): CollegeHealth[] {
  const notFresh = (c: CollegeHealth) => c.rows.filter((r) => r.status && r.status !== "fresh").length;
  return [...colleges].sort((a, b) => statusRank(b.overall) - statusRank(a.overall) || notFresh(b) - notFresh(a) || a.unitId.localeCompare(b.unitId, "en", { numeric: true }));
}

/** Everything the overview needs from outside, so tests can stand in for the files, the dataset, the clock, and Supabase. */
export interface HealthDeps {
  schools(): Promise<{ schools: readonly HealthSchool[]; metaRetrieved: string | null }>;
  files(): Promise<HealthFiles>;
  /** The newest change per college; null when `dataset_changes` is unavailable. */
  changes(): Promise<Map<string, { at: string; fields: number }> | null>;
  now(): number;
}

/**
 * An overview function over `deps` that reads the files and the dataset once (the first call; a failed read is not
 * kept) and `dataset_changes` again after CHANGES_TTL_MS. `healthOverview` below is this with the real dependencies.
 */
export function createHealthOverview(deps: HealthDeps): () => Promise<HealthOverview> {
  let base: Promise<{ schools: readonly HealthSchool[]; metaRetrieved: string | null; index: HealthIndex }> | null = null;
  let changes: { at: number; value: Map<string, { at: string; fields: number }> | null } | null = null;
  return async function overview() {
    base ??= Promise.all([deps.schools(), deps.files()]).then(([s, files]) => ({ ...s, index: indexHealthFiles(files) }));
    let loaded;
    try {
      loaded = await base;
    } catch (err) {
      base = null;
      throw err;
    }
    const now = deps.now();
    if (!changes || now - changes.at > CHANGES_TTL_MS) {
      let value: Map<string, { at: string; fields: number }> | null = null;
      try {
        value = await deps.changes();
      } catch (err) {
        console.error("[admin health] reading dataset_changes failed; \"what changed\" is left out.", err);
      }
      changes = { at: now, value };
    }
    const today = new Date(now).toISOString().slice(0, 10);
    const colleges = sortWorstFirst(loaded.schools.map((s) => collegeHealth(s.unit_id, healthInputsFor(s, loaded.index, { today, metaRetrieved: loaded.metaRetrieved, changes: changes!.value }))));
    return { colleges, counts: countHealth(colleges), today, changesAvailable: changes.value !== null };
  };
}

// The five files below are health-only inputs (specs/product/admin.md "Files the deploy must carry"), so they are read
// here and not through getData(). Each path spells out its folder and file with literals so the tracer ships exactly
// these (next.config.ts "/admin/**"; tests/tracing.test.mts).
function readOptionalJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

/** Reads the five files, reducing each CDS record as it goes so only one is in memory at a time. */
export function readHealthFilesFromDisk(): HealthFiles {
  const docs = readOptionalJson<{ documents: ManifestDocLite[] }>(join(process.cwd(), "data", "college-docs.json"));
  const failures = readOptionalJson<{ rows: FailureRowLite[] }>(join(process.cwd(), "data", "college-failures.json"));
  const queue = readOptionalJson<{ items: { unit_id: string }[] }>(join(process.cwd(), "data", "review-queue.json"));
  const links = readOptionalJson<LinkIssueRowLite[]>(join(process.cwd(), "data", "link-issues.json"));
  const recordsDir = join(process.cwd(), "data", "cds-records");
  let records: Map<string, RecordDocLite[]> | null = null;
  if (existsSync(recordsDir)) {
    records = new Map();
    for (const file of readdirSync(recordsDir).filter((f) => f.endsWith(".json"))) {
      const rec = JSON.parse(readFileSync(join(recordsDir, file), "utf8")) as { unit_id: string; documents?: never };
      records.set(rec.unit_id, summarizeRecord(rec as Parameters<typeof summarizeRecord>[0]));
    }
  }
  return {
    manifest: docs?.documents ?? null,
    records,
    failures: failures?.rows ?? null,
    queue: queue ? groupCounts(queue.items.map((i) => i.unit_id)) : null,
    linkIssues: links,
  };
}

function groupCounts(units: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const u of units) out.set(u, (out.get(u) ?? 0) + 1);
  return out;
}

const realDeps: HealthDeps = {
  async schools() {
    const { getData } = await import("../data");
    const data = await getData();
    return { schools: data.getAllSchools(), metaRetrieved: data.getMeta().retrieved ?? null };
  },
  async files() {
    return readHealthFilesFromDisk();
  },
  async changes() {
    // Changes live only in Supabase, written after each deploy (lib/data.ts getSchoolChanges): without SUPABASE_URL there are none.
    const fixture = process.env.CHANGES_FIXTURE;
    if (fixture && existsSync(fixture)) {
      const rows = JSON.parse(readFileSync(fixture, "utf8")) as { unit_id: string; publish_id: number; published_at: string }[];
      const publishes = [...new Map(rows.map((r) => [r.publish_id, r.published_at])).entries()].sort((a, b) => b[0] - a[0]);
      return latestChanges({
        newestPublishBefore: async (before) => {
          const next = publishes.find(([id]) => before === null || id < before);
          return next ? { id: next[0], at: next[1] } : null;
        },
        unitsOfPublish: async (id) => rows.filter((r) => r.publish_id === id).map((r) => r.unit_id),
      });
    }
    if (!process.env.SUPABASE_URL) return null;
    const { supabaseClient } = await import("../supabase");
    return latestChanges(supabaseChangesReader(supabaseClient("read") as unknown as TableClient));
  },
  now: () => Date.now(),
};

/** Every college by data health, worst first, with counts. Computed once per server instance (the changes read: every few minutes). */
export const healthOverview = createHealthOverview(realDeps);

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** One CSV cell: quoted when it holds a comma, quote, or line break; a leading = + - @ is defused so a spreadsheet won't run it. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const HEALTH_CSV_COLUMNS: readonly string[] = [
  "unit_id",
  "name",
  "overall",
  ...HEALTH_GROUPS.flatMap((g) => [`${g}_status`, `${g}_date`, `${g}_reason`]),
  "changed_at",
  "changed_fields",
  "open_failures",
  "queue_items",
];

/** The overview as CSV: one line per college in the order given, `names` by unit id (a missing name is blank). */
export function healthCsv(rows: CollegeHealth[], names: Record<string, string>): string {
  const lines = [HEALTH_CSV_COLUMNS.map(csvCell).join(",")];
  for (const c of rows) {
    const byGroup = new Map(c.rows.map((r) => [r.group, r]));
    const cells: (string | number | null)[] = [c.unitId, names[c.unitId] ?? "", c.overall];
    for (const g of HEALTH_GROUPS) {
      const r = byGroup.get(g);
      cells.push(r?.status ?? "", r?.judgedBy ?? "", r?.reason ?? "");
    }
    cells.push(c.changed?.at ?? "", c.changed?.fields ?? "", [...new Set(c.failures.map((f) => f.reason))].join("; "), c.queueItems);
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
