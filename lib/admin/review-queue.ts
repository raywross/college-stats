/**
 * Held items in the Data console's Holds (specs/data-platform/change-sets.md "Holds and review"): the review queue's
 * items, which are `reported.review_queue` documents keyed `unit|edition|code` (lib/reported.ts `reviewKey`, as
 * scripts/import-data-from-files.mts keys them), and the essay reader's held records (`essays.held`, by unit id). Read
 * from the store with the admin's session, never from GitHub.
 *
 * - **Accept the value** writes field edits (`admin_data_edit`, source `quad-edit`, note "Accepted from the review
 *   queue: {document}") with today's mapping (`acceptPlan`): a C1 total (applicants, admitted and enrolled together,
 *   with the derived acceptance rate and the class year, so the funnel stays one class), the SAT/ACT submission
 *   shares (C.901, C.902), and a round-1/2 C1 extraction from a Common Data Set. Everything else lives only in the
 *   college's CDS record, which no registered field reaches; `acceptPlan` says why. Then each settled item is
 *   resolved `accepted` (`admin_data_resolve_review`). lib/admin/ops-actions.ts runs it.
 * - **Reject** resolves the item `rejected`; `enqueueItems` (lib/reported.ts) keeps resolved items, so the next run
 *   doesn't queue the same document's value again.
 * - **Re-run discovery** dispatches a `college` run with `rediscover: true`, as before.
 *
 * The queue is read from its read model, `public.review_items` (supabase/migrations/20261110120000_admin_speed.sql,
 * specs/data-platform/change-sets.md "The review queue's read model"): `readQueue` in one round trip
 * (`review_items_light`, keyed for its cache on `review_items_counts`'s newest write, one read in flight per instance),
 * and the narrow readers (`readQueueCounts`, `readCollegeQueueItems`, `readAcquisitionQueueItems`) never touch the
 * whole queue. On a project without the migration each falls back to the documents, as before.
 *
 * Pure but for the reads, which take the client as an argument.
 */
import { editProblem } from "../data-platform/edits.ts";
import { labelYear } from "../newest-groups.ts";
import { reviewKey, type ReviewItem } from "../reported.ts";
import { ACQUISITION_QUEUE_CHECKS } from "../steward/todo-sources.ts";

/** The collections these reads use (scripts/lib/data-platform/layers.mts `COLLECTIONS`; a test checks they agree). */
export const REVIEW_QUEUE_COLLECTION = "reported.review_queue";
export const ESSAYS_HELD_COLLECTION = "essays.held";

export type QueueStatus = "open" | "accepted" | "rejected";

export interface QueueRow {
  /** The document's key: `unit|edition|code`. */
  id: string;
  item: ReviewItem;
  status: QueueStatus;
  /** Whether Accept the value is offered, and why not. */
  accept: { ok: true; fields: string[] } | { ok: false; reason: AcceptRefusal; message: string };
}

const statusOf = (item: ReviewItem): QueueStatus => (item.resolved === "accepted" ? "accepted" : item.resolved === "rejected" ? "rejected" : "open");

/** Pure: the items as rows, keyed by their documents, with each row's status and whether Accept is offered. Open rows first. */
export function queueRows(docs: ReadonlyMap<string, ReviewItem> | readonly ReviewItem[]): QueueRow[] {
  const entries: [string, ReviewItem][] = Array.isArray(docs) ? docs.map((i) => [reviewKey(i), i]) : [...(docs as ReadonlyMap<string, ReviewItem>).entries()];
  const items = entries.map(([, i]) => i);
  const rows = entries.map(([id, item]): QueueRow => {
    const plan = acceptPlan(item, items);
    return { id, item, status: statusOf(item), accept: plan.ok ? { ok: true, fields: Object.keys(plan.values) } : { ok: false, reason: plan.reason, message: plan.message } };
  });
  const order: Record<QueueStatus, number> = { open: 0, accepted: 1, rejected: 2 };
  return rows.sort((a, b) => order[a.status] - order[b.status]);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** A PostgREST error: `code` is PostgREST's (`PGRST202`) or Postgres's SQLSTATE (`42P01`). */
export type StoreError = { message: string; code?: string };
type Result<T> = PromiseLike<{ data: T | null; error: StoreError | null }>;
interface Query<T> extends Result<T[]> {
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  gt(column: string, value: string): Query<T>;
  /** `like` (PostgREST `like`): the documents' key-prefix fallback. */
  like(column: string, pattern: string): Query<T>;
  /** Array overlap (PostgREST `ov`): `review_items.checks` against a list. */
  overlaps(column: string, values: readonly string[]): Query<T>;
  order(column: string, opts?: { ascending?: boolean }): Query<T>;
  limit(n: number): Query<T>;
}
/** The slice of a Supabase client these reads use (the admin's session: `adminSupabase()`). */
export interface StoreClient {
  from(table: string): { select(columns: string): Query<Record<string, unknown>> };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: StoreError | null }>;
}

/**
 * Whether an error says the read model isn't there: a missing function (PostgREST `PGRST202`, Postgres `42883`) or
 * table (`PGRST205`, `42P01`), by its code or its message. A project before 20261110120000_admin_speed.sql.
 */
export function isMissingReadModel(error: unknown): boolean {
  if (!error) return false;
  const obj = typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : null;
  if (/^(PGRST202|PGRST205|42P01|42883)$/.test(String(obj?.code ?? ""))) return true;
  const message = error instanceof Error ? error.message : obj ? String(obj.message ?? "") : String(error);
  return /PGRST202|PGRST205|42P01|42883|does not exist|schema cache|could not find the function/i.test(message);
}

let warnedFallback = false;
/** One warning per instance that the read model is missing and the documents are read instead. */
function warnFallback(what: string): void {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(`[admin] review_items is missing (apply supabase/migrations/20261110120000_admin_speed.sql); ${what} reads the queue's documents instead`);
}

const PAGE = 1000;
/** A safety stop: 200 pages is 200,000 documents, ten times today's queue. */
const MAX_PAGES = 200;

/** Every current document of a collection as a Map by key, read in key order a page at a time (keyset paging). */
export async function readCollection<T>(client: StoreClient, collection: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = client.from("data_documents").select("key, body").eq("collection", collection);
    if (after !== null) q = q.gt("key", after);
    const { data, error } = await q.order("key", { ascending: true }).limit(PAGE);
    if (error) throw new Error(`admin: reading ${collection} failed: ${error.message}`);
    const rows = (data ?? []) as { key: string; body: T }[];
    for (const r of rows) out.set(r.key, r.body);
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1].key;
  }
  throw new Error(`admin: ${collection} has more than ${PAGE * MAX_PAGES} documents`);
}

/** Some documents of a collection by key (at most a few: an item and its C1 siblings). */
export async function readDocuments<T>(client: StoreClient, collection: string, keys: readonly string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (!keys.length) return out;
  const { data, error } = await client.from("data_documents").select("key, body").eq("collection", collection).in("key", [...keys]);
  if (error) throw new Error(`admin: reading ${collection} failed: ${error.message}`);
  for (const r of (data ?? []) as { key: string; body: T }[]) out.set(r.key, r.body);
  return out;
}

/** The newest write to a collection (any document's `updated_at`), or null when it is empty (an index lookup since 20261110120000). */
async function newestWrite(client: StoreClient, collection: string): Promise<string | null> {
  const { data, error } = await client.from("data_documents").select("updated_at").eq("collection", collection).order("updated_at", { ascending: false }).limit(1);
  if (error) throw new Error(`admin: reading ${collection} failed: ${error.message}`);
  return ((data ?? [])[0] as { updated_at?: string } | undefined)?.updated_at ?? null;
}

/** How long a cached queue is trusted without a new write before it is read again anyway (a deletion moves no `updated_at`). */
export const QUEUE_CACHE_MS = 5 * 60_000;

let cache: { newest: string | null; at: number; rows: QueueRow[]; items: ReviewItem[] } | null = null;
/** The read under way, which every caller meanwhile awaits instead of starting another. */
let inflight: Promise<QueueRead> | null = null;

/** Forgets the cached queue and any read in flight (tests; and after an action, so the page shows it at once). */
export function resetQueueCache(): void {
  cache = null;
  inflight = null;
  warnedFallback = false;
}

export type QueueRead = { ok: true; updated: string | null; rows: QueueRow[]; items: ReviewItem[] } | { ok: false; reason: string };

/**
 * The fields of an item `review_items_light` returns (the migration's list; a test checks they agree): what the
 * whole-queue readers use (`queueRows`, `clusterQueue`, `kindContext`, `todoRows`, `reviewColleges`). Not
 * `extraction`: only an Accept reads it, by key (`readDocuments`), and the Review page reads its college's whole items.
 */
export const LIGHT_FIELDS = ["unit_id", "name", "failures", "code", "edition", "sha256", "resolved"] as const;
/**
 * The fields `review_items_light` subtracts from each document (the migration's array; a test checks they agree):
 * `extraction`, and the ones only Holds' Accept or To do read (`urls`, `entering_term`, `queued`, `run`, `value`,
 * `resolved_on`, `resolved_note`); those paths read their items by key or through the narrow readers. Without `urls`,
 * `acceptPlan` over these items refuses every row ("names no document"); nothing renders `readQueue().rows[].accept`.
 */
export const LIGHT_DROPPED = ["extraction", "urls", "entering_term", "queued", "run", "value", "resolved_on", "resolved_note"] as const;

export interface QueueCounts {
  open: number;
  accepted: number;
  rejected: number;
  /** Open items queued in the last seven days. */
  newWeek: number;
  /** The queue's newest write (ISO), or null when it is empty. */
  newest: string | null;
}

/** `review_items_counts()`'s answer, or null when it isn't one. */
function parseCounts(data: unknown): QueueCounts | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const n = (k: string): number | null => (typeof d[k] === "number" && Number.isInteger(d[k]) && (d[k] as number) >= 0 ? (d[k] as number) : null);
  const [open, accepted, rejected, newWeek] = [n("open"), n("accepted"), n("rejected"), n("new_week")];
  if (open === null || accepted === null || rejected === null || newWeek === null) return null;
  return { open, accepted, rejected, newWeek, newest: typeof d.newest === "string" ? d.newest : null };
}

/** Marks "the read model is missing", so the caller falls back to the documents. */
class MissingReadModel extends Error {}

async function countsOrMissing(client: StoreClient): Promise<QueueCounts> {
  const { data, error } = await client.rpc("review_items_counts");
  if (error) {
    if (isMissingReadModel(error)) throw new MissingReadModel(error.message);
    throw new Error(`admin: reading the review queue's counts failed: ${error.message}`);
  }
  const counts = parseCounts(data);
  if (!counts) throw new Error("admin: review_items_counts gave an unexpected answer");
  return counts;
}

/** The queue's items from `review_items_light(null)` (every status), by key. */
async function lightItems(client: StoreClient): Promise<Map<string, ReviewItem>> {
  const { data, error } = await client.rpc("review_items_light", { p_status: null });
  if (error) {
    if (isMissingReadModel(error)) throw new MissingReadModel(error.message);
    throw new Error(`admin: reading the review queue failed: ${error.message}`);
  }
  if (!Array.isArray(data)) throw new Error("admin: review_items_light gave an unexpected answer");
  const out = new Map<string, ReviewItem>();
  for (const el of data as unknown[]) {
    if (!el || typeof el !== "object" || typeof (el as { key?: unknown }).key !== "string") continue;
    const { key, ...item } = el as { key: string } & ReviewItem;
    out.set(key, item);
  }
  return out;
}

function remember(newest: string | null, at: number, docs: ReadonlyMap<string, ReviewItem>): QueueRead {
  const rows = queueRows(docs);
  cache = { newest, at, rows, items: [...docs.values()] };
  return { ok: true, updated: newest, rows, items: cache.items };
}

/** The cached queue when it is still good for this newest write. */
function cached(newest: string | null, now: number): QueueRead | null {
  return cache && cache.newest === newest && now - cache.at < QUEUE_CACHE_MS ? { ok: true, updated: newest, rows: cache.rows, items: cache.items } : null;
}

/** Today's path on a project without the read model: the newest write, then every document a page at a time. */
async function readQueueFromDocuments(client: StoreClient, now: () => number): Promise<QueueRead> {
  const newest = await newestWrite(client, REVIEW_QUEUE_COLLECTION);
  return cached(newest, now()) ?? remember(newest, now(), await readCollection<ReviewItem>(client, REVIEW_QUEUE_COLLECTION));
}

async function readQueueOnce(client: StoreClient, now: () => number): Promise<QueueRead> {
  try {
    try {
      const { newest } = await countsOrMissing(client);
      return cached(newest, now()) ?? remember(newest, now(), await lightItems(client));
    } catch (e) {
      if (!(e instanceof MissingReadModel)) throw e;
      warnFallback("readQueue");
      return await readQueueFromDocuments(client, now);
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The review queue as rows, every status (the rows carry resolutions), each item without its `extraction`
 * (`LIGHT_FIELDS`). One call for the counts (whose newest write is the cache key) and, when that changed or the cache
 * is older than `QUEUE_CACHE_MS`, one call for the items; cached per instance, and a caller arriving while a read is
 * under way awaits that read instead of starting another. Without the read model: the documents, as before. Never
 * throws.
 */
export function readQueue(client: StoreClient, now: () => number = Date.now): Promise<QueueRead> {
  if (inflight) return inflight;
  const p: Promise<QueueRead> = readQueueOnce(client, now).finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

/** The queue's counts and newest write in one call; null when they couldn't be read (the read model missing included). Never cached. */
export async function readQueueCounts(client: StoreClient): Promise<QueueCounts | null> {
  try {
    return await countsOrMissing(client);
  } catch {
    return null;
  }
}

const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

type Page = PromiseLike<{ data: Record<string, unknown>[] | null; error: StoreError | null }>;

/** Every row of a query, paged by key (keyset, `PAGE` at a time); the error of the first page that failed. */
async function pagedByKey(page: (after: string | null) => Page): Promise<{ rows: { key: string; body: unknown }[]; error: StoreError | null }> {
  const rows: { key: string; body: unknown }[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(after);
    if (error) return { rows, error };
    const got = (data ?? []) as { key: string; body: unknown }[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, error: null };
    after = got[got.length - 1].key;
  }
  return { rows, error: null };
}

/**
 * One college's queue items, every status, whole (with `extraction`: the Review page's Accept plan reads it), in key
 * order: `review_items` by `unit_id`, or the documents by key prefix `unit|` without the read model. Never cached;
 * throws on failure.
 */
export async function readCollegeQueueItems(client: StoreClient, unit: string): Promise<ReviewItem[]> {
  const table = await pagedByKey((after) => {
    let q = client.from("review_items").select("key, body").eq("unit_id", unit);
    if (after !== null) q = q.gt("key", after);
    return q.order("key", { ascending: true }).limit(PAGE);
  });
  if (!table.error) return table.rows.map((r) => r.body as ReviewItem);
  if (!isMissingReadModel(table.error)) throw new Error(`admin: reading ${unit}'s review items failed: ${table.error.message}`);
  warnFallback("a college's Review page");
  const docs = await pagedByKey((after) => {
    let q = client.from("data_documents").select("key, body").eq("collection", REVIEW_QUEUE_COLLECTION).like("key", likePrefix(`${unit}|`));
    if (after !== null) q = q.gt("key", after);
    return q.order("key", { ascending: true }).limit(PAGE);
  });
  if (docs.error) throw new Error(`admin: reading ${REVIEW_QUEUE_COLLECTION} failed: ${docs.error.message}`);
  return docs.rows.map((r) => r.body as ReviewItem);
}

/** An open item that failed a check To do acts on (`ACQUISITION_QUEUE_CHECKS`: unreachable, not-a-url). */
const isAcquisition = (i: ReviewItem) => !i.resolved && Array.isArray(i.failures) && i.failures.some((f) => ACQUISITION_QUEUE_CHECKS.has(f.check));

/**
 * The open items To do acts on (a failure of an `ACQUISITION_QUEUE_CHECKS` check: a few hundred), whole, in key order:
 * `review_items` where `status = 'open'` and `checks` overlaps them; without the read model, the whole queue through
 * `readQueue`, filtered the same way. Never cached; throws on failure.
 */
export async function readAcquisitionQueueItems(client: StoreClient): Promise<ReviewItem[]> {
  const checks = [...ACQUISITION_QUEUE_CHECKS];
  const table = await pagedByKey((after) => {
    let q = client.from("review_items").select("key, body").eq("status", "open").overlaps("checks", checks);
    if (after !== null) q = q.gt("key", after);
    return q.order("key", { ascending: true }).limit(PAGE);
  });
  if (!table.error) return table.rows.map((r) => r.body as ReviewItem).filter(isAcquisition);
  if (!isMissingReadModel(table.error)) throw new Error(`admin: reading the review queue failed: ${table.error.message}`);
  warnFallback("To do");
  const queue = await readQueue(client);
  if (!queue.ok) throw new Error(queue.reason);
  return queue.items.filter(isAcquisition);
}

/** An essay record the reader held (scripts/lib/essay-prompts/store.mts `HeldRecord`), as Holds shows it. */
export interface HeldEssay {
  unit_id: string;
  name: string;
  /** ISO date it was held. */
  held: string;
  problems: string[];
  record: { url?: string | null; prompts?: unknown[] } & Record<string, unknown>;
}

/** The held essay records, by unit id. Never throws. */
export async function readHeldEssays(client: StoreClient): Promise<{ ok: true; records: HeldEssay[] } | { ok: false; reason: string }> {
  try {
    const docs = await readCollection<HeldEssay>(client, ESSAYS_HELD_COLLECTION);
    return { ok: true, records: [...docs.values()] };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Most-listed college first (the count of families' lists it is on: lib/admin/essays.ts `listsByUnit`), then by name. */
export function byLists<T>(rows: readonly T[], unitOf: (r: T) => string, nameOf: (r: T) => string, lists: ReadonlyMap<string, number> | null): T[] {
  return [...rows].sort((a, b) => (lists?.get(unitOf(b)) ?? 0) - (lists?.get(unitOf(a)) ?? 0) || nameOf(a).localeCompare(nameOf(b), "en") || unitOf(a).localeCompare(unitOf(b)));
}

/* ------------------------------------------------------------------ */
/* Accept                                                              */
/* ------------------------------------------------------------------ */

/** C1 totals: accepted together, so applicants, admitted, and enrolled always describe the same class. */
export const C1_TOTALS = { "C.116": "applicants", "C.117": "admitted", "C.118": "enrolled" } as const;
/** Single items with a registered field of their own. Shares are fractions (0.62), as the queue stores them. */
const SINGLE_TARGETS: Record<string, { path: "admissions.test_submission_rate_sat" | "admissions.test_submission_rate_act" }> = {
  "C.901": { path: "admissions.test_submission_rate_sat" },
  "C.902": { path: "admissions.test_submission_rate_act" },
};

export type AcceptRefusal = "not_open" | "no_override_path" | "c1_incomplete" | "not_cds" | "implausible" | "no_document" | "not_editable";

export type AcceptPlan =
  | {
      ok: true;
      /** The items the edits settle (the three C1 totals together). */
      items: ReviewItem[];
      edition: string;
      url: string;
      /** Registered field path → value. */
      values: Record<string, number>;
    }
  | { ok: false; reason: AcceptRefusal; message: string };

const refuse = (reason: AcceptRefusal, message: string): AcceptPlan => ({ ok: false, reason, message });

/** A Common Data Set by its link or name ("cds", "common data set", "common_data_set"). */
export function isCdsDocument(url: string): boolean {
  return /(^|[^a-z])cds([^a-z]|$)|common[\s_-]*data[\s_-]*set/i.test(decodeURIComponentSafe(url));
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "Fall 2025" → "2025-26". */
function editionFromTerm(term: string | null): string | null {
  const y = labelYear(term);
  return y === null ? null : `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

function c1Values(applicants: number, admitted: number, enrolled: number, edition: string): Record<string, number> | null {
  if (applicants < 10 || admitted > applicants || enrolled > admitted) return null;
  return {
    "admissions.year": Number(edition.slice(0, 4)),
    "admissions.applicants": applicants,
    "admissions.admitted": admitted,
    "admissions.enrolled": enrolled,
    "admissions.acceptance_rate": round4(admitted / applicants),
  };
}

/** The keys of a C1 total's two siblings and itself (`unit|edition|C.116` …), or just the key for anything else. */
export function siblingKeys(key: string): string[] {
  const [unit, edition, code] = key.split("|");
  if (code && code in C1_TOTALS && unit && edition) return Object.keys(C1_TOTALS).map((c) => `${unit}|${edition}|${c}`);
  return [key];
}

/** Whether `item` can be accepted as field edits, and what it would write. `queue` supplies a C1 total's siblings. */
export function acceptPlan(item: ReviewItem, queue: readonly ReviewItem[]): AcceptPlan {
  const plan = basePlan(item, queue);
  if (!plan.ok) return plan;
  // Every path must be one an admin edit may set (registered, not computed or hidden): the function checks only shape.
  for (const path of Object.keys(plan.values)) {
    if (editProblem({ unit_id: item.unit_id, path })) return refuse("not_editable", `The value would go to ${path}, which the console can't edit.`);
  }
  return plan;
}

function basePlan(item: ReviewItem, queue: readonly ReviewItem[]): AcceptPlan {
  if (item.resolved) return refuse("not_open", `This item was already ${item.resolved}.`);
  const url = item.urls[0];
  if (!url) return refuse("no_document", "The item names no document to cite.");

  // Round-1/2 entries: a whole C1 extraction from one document.
  if (!item.code) {
    const x = item.extraction;
    if (!x) return refuse("no_override_path", "Nothing was read from this document; fix its recipe or re-run discovery.");
    if (!isCdsDocument(url)) return refuse("not_cds", "The document isn't a Common Data Set; edit the college's values by hand if it should publish.");
    const edition = editionFromTerm(x.entering_term ?? item.entering_term);
    if (!edition) return refuse("no_document", "The document doesn't say which class it describes.");
    if (x.cohort === "transfer") return refuse("implausible", "These figures describe transfer students, not first-years.");
    if (!isCount(x.applicants) || !isCount(x.admitted) || !isCount(x.enrolled)) return refuse("c1_incomplete", "Applicants, admitted, and enrolled weren't all read.");
    const values = c1Values(x.applicants, x.admitted, x.enrolled, edition);
    if (!values) return refuse("implausible", "The counts don't make a funnel (applicants ≥ admitted ≥ enrolled, at least 10 applicants).");
    return { ok: true, items: [item], edition, url, values };
  }

  if (!item.edition) return refuse("no_document", "The item names no edition.");
  const edition = item.edition;

  if (item.code in C1_TOTALS) {
    const siblings = (Object.keys(C1_TOTALS) as (keyof typeof C1_TOTALS)[]).map((code) =>
      queue.find((q) => !q.resolved && q.unit_id === item.unit_id && q.edition === edition && q.sha256 === item.sha256 && q.code === code),
    );
    if (siblings.some((s) => !s || !isCount(s.value))) {
      return refuse("c1_incomplete", "Applicants, admitted, and enrolled (C.116–C.118) must all be held from this document to accept them together.");
    }
    const [applicants, admitted, enrolled] = siblings.map((s) => s!.value as number);
    const values = c1Values(applicants, admitted, enrolled, edition);
    if (!values) return refuse("implausible", "The counts don't make a funnel (applicants ≥ admitted ≥ enrolled, at least 10 applicants).");
    return { ok: true, items: siblings as ReviewItem[], edition, url, values };
  }

  const single = SINGLE_TARGETS[item.code];
  if (single) {
    const v = item.value;
    if (typeof v !== "number" || v < 0 || v > 1) return refuse("implausible", "A submission share must be a fraction between 0 and 1.");
    return { ok: true, items: [item], edition, url, values: { [single.path]: round4(v) } };
  }

  return refuse(
    "no_override_path",
    `${item.code} is published from the college's CDS record, which no editable field reaches. Re-run discovery, fix the recipe by hand, or leave it held.`,
  );
}

/** The longest note `admin_data_edit` takes. */
export const NOTE_MAX = 500;

/** "Accepted from the review queue: {document}", within the function's 500 characters. */
export function acceptNote(url: string): string {
  const note = `Accepted from the review queue: ${url}`;
  return note.length <= NOTE_MAX ? note : `${note.slice(0, NOTE_MAX - 1)}…`;
}
