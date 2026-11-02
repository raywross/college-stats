/**
 * The Data Steward's console reads (specs/product/data-steward.md "The console: where it all shows"): the clusters,
 * live from the review queue (`readQueue`, cached with it: the clusters are recomputed only when the queue was read
 * again); the Steward's documents in `steward.*` (issues, proposals, To do, decisions, audits, runs); one college's
 * Review page rows; the To do rows merged from the stored documents and the engines' records; and "Colleges to
 * review". Server code: every read takes the admin's client (`adminSupabase()`, lib/admin/people.ts), and the callers
 * check `requireAdmin()` first. `data_documents` selects for everyone, so the reads need no service key.
 *
 * Fail soft: a missing table (a project before the data platform's migration) reads as empty. Pure but for the reads.
 */
import { CDS_TEMPLATE } from "../cds-template.ts";
import type { CollegeRecord } from "../cds-sections.ts";
import type { FieldPath } from "../fields.ts";
import type { Cited } from "../lineage.ts";
import type { ReviewItem } from "../reported.ts";
import type { School } from "../types.ts";
import { clusterQueue, freeDetailChecks } from "../steward/cluster.ts";
import { kindContext, kindOf } from "../steward/kinds.ts";
import { reviewColleges, reviewRows, type CollegeToReview, type ReviewGroup } from "../steward/review-rows.ts";
import { mergeTodo, todoRows, type BlockedDirectoryLike, type FailureRowLike } from "../steward/todo-sources.ts";
import type { AuditDoc, Cluster, DecisionDoc, IssueDoc, IssueKind, ProposalDoc, ProposalStatus, RunDoc, TodoDoc } from "../steward/types.ts";
import { readCollection, readDocuments, readQueue, type StoreClient } from "./review-queue.ts";

/** The collections these reads use (scripts/lib/data-platform/layers.mts `COLLECTIONS.steward`; a test checks they agree). */
export const STEWARD_COLLECTIONS = {
  issues: "steward.issues",
  proposals: "steward.proposals",
  todo: "steward.todo",
  decisions: "steward.decisions",
  audits: "steward.audits",
  runs: "steward.runs",
} as const;
/** The engines' records the To do rows and the clusters' kinds come from. */
export const SOURCE_COLLECTIONS = {
  cdsRecords: "reported.cds_records",
  docs: "reported.docs",
  failures: "reported.failures",
  blocked: "directories.blocked",
} as const;

/** A missing table or an unknown relation (PostgREST's PGRST205, Postgres 42P01), by its message. */
export function isMissingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /42P01|PGRST205|does not exist|schema cache/i.test(message);
}

/** A collection's documents, or an empty map when the table is missing. Other errors throw (the page's error boundary). */
async function readSoft<T>(client: StoreClient, collection: string): Promise<Map<string, T>> {
  try {
    return await readCollection<T>(client, collection);
  } catch (e) {
    if (isMissingTable(e)) return new Map();
    throw e;
  }
}

async function readSomeSoft<T>(client: StoreClient, collection: string, keys: readonly string[]): Promise<Map<string, T>> {
  try {
    return await readDocuments<T>(client, collection, keys);
  } catch (e) {
    if (isMissingTable(e)) return new Map();
    throw e;
  }
}

const PAGE = 1000;
const MAX_PAGES = 50;

/** The keys of a collection (no bodies), a page at a time; null when they couldn't be read. Never throws. */
async function readKeys(client: StoreClient, collection: string): Promise<Set<string> | null> {
  try {
    const out = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = client.from("data_documents").select("key").eq("collection", collection);
      if (after !== null) q = q.gt("key", after);
      const { data, error } = await q.order("key", { ascending: true }).limit(PAGE);
      if (error) return null;
      const rows = (data ?? []) as { key: string }[];
      for (const r of rows) out.add(r.key);
      if (rows.length < PAGE) return out;
      after = rows[rows.length - 1].key;
    }
    return out;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Clusters                                                            */
/* ------------------------------------------------------------------ */

/** Whether publishing an item would change what a visitor sees: a round-1/2 C1 extraction, or a code an owning spec displays. */
export function shownOnSite(item: ReviewItem): boolean {
  if (!item.code) return true;
  return (CDS_TEMPLATE.byCode.get(item.code)?.owner ?? null) !== null;
}

export interface ClusterView {
  cluster: Cluster;
  kind: IssueKind;
}

export type ClustersRead =
  | {
      ok: true;
      /** The queue's newest write. */
      updated: string | null;
      clusters: ClusterView[];
      /** The open and resolved items the clusters came from (the cached queue). */
      items: ReviewItem[];
      /** The checks that cluster by the check alone in this queue. */
      free: Set<string>;
    }
  | { ok: false; reason: string };

let clusterCache: { items: ReviewItem[]; clusters: ClusterView[]; free: Set<string> } | null = null;

/** Forgets the cached clusters (tests; the queue's own cache is `resetQueueCache`). */
export function resetClusterCache(): void {
  clusterCache = null;
}

/**
 * The queue's clusters with their kinds, largest first. The queue comes through `readQueue` (5-minute cache); the
 * clusters are recomputed only when it returns a newly read queue. The kinds read the manifest's keys
 * (`reported.docs`) for "every document unfetched"; when they can't be read, every document counts as fetched.
 */
export async function readClusters(client: StoreClient, now: () => number = Date.now): Promise<ClustersRead> {
  const queue = await readQueue(client, now);
  if (!queue.ok) return isMissingTable(queue.reason) ? { ok: true, updated: null, clusters: [], items: [], free: new Set() } : queue;
  if (!clusterCache || clusterCache.items !== queue.items) {
    const docs = await readKeys(client, SOURCE_COLLECTIONS.docs);
    const context = kindContext(queue.items, { fetched: docs && docs.size ? (sha) => docs.has(sha) : undefined });
    const clusters = clusterQueue(queue.items, { publishedBy: shownOnSite }).map((cluster) => ({ cluster, kind: kindOf(cluster, context) }));
    clusterCache = { items: queue.items, clusters, free: freeDetailChecks(queue.items) };
  }
  return { ok: true, updated: queue.updated, clusters: clusterCache.clusters, items: queue.items, free: clusterCache.free };
}

/* ------------------------------------------------------------------ */
/* The Steward's documents                                             */
/* ------------------------------------------------------------------ */

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The issue documents by cluster key. */
export async function readIssues(client: StoreClient): Promise<Map<string, IssueDoc>> {
  return readSoft<IssueDoc>(client, STEWARD_COLLECTIONS.issues);
}

const PROPOSAL_ORDER: Record<ProposalStatus, number> = { open: 0, asked: 1, approved: 2, applied: 3, declined: 4 };

/** Systemic first, then by status (open, asked, approved, applied, declined), newest first. */
export function compareProposals(a: ProposalDoc, b: ProposalDoc): number {
  return (
    Number(b.kind === "systemic") - Number(a.kind === "systemic") ||
    PROPOSAL_ORDER[a.status] - PROPOSAL_ORDER[b.status] ||
    byText(b.created, a.created) ||
    byText(a.key, b.key)
  );
}

/** The proposals, optionally of one status, in `compareProposals` order. */
export async function readProposals(client: StoreClient, status?: ProposalStatus | null): Promise<ProposalDoc[]> {
  const docs = [...(await readSoft<ProposalDoc>(client, STEWARD_COLLECTIONS.proposals)).values()];
  return docs.filter((p) => !status || p.status === status).sort(compareProposals);
}

/** One proposal by key, or null. */
export async function readProposal(client: StoreClient, key: string): Promise<ProposalDoc | null> {
  return (await readSomeSoft<ProposalDoc>(client, STEWARD_COLLECTIONS.proposals, [key])).get(key) ?? null;
}

/** Unanswered first, then newest. */
export async function readDecisions(client: StoreClient): Promise<DecisionDoc[]> {
  const docs = [...(await readSoft<DecisionDoc>(client, STEWARD_COLLECTIONS.decisions)).values()];
  return docs.sort((a, b) => Number(a.answer !== null) - Number(b.answer !== null) || byText(b.created, a.created) || byText(a.key, b.key));
}

/** Newest first. */
export async function readAudits(client: StoreClient): Promise<AuditDoc[]> {
  const docs = [...(await readSoft<AuditDoc>(client, STEWARD_COLLECTIONS.audits)).values()];
  return docs.sort((a, b) => byText(b.created, a.created) || byText(a.key, b.key));
}

/** The newest `limit` run summaries, newest first. */
export async function readRuns(client: StoreClient, limit = 20): Promise<RunDoc[]> {
  const docs = [...(await readSoft<RunDoc>(client, STEWARD_COLLECTIONS.runs)).values()];
  return docs.sort((a, b) => byText(b.started, a.started) || byText(b.key, a.key)).slice(0, Math.max(0, limit));
}

/* ------------------------------------------------------------------ */
/* To do                                                               */
/* ------------------------------------------------------------------ */

/** A `reported.failures` document's rows (an array of rows per college; a `{rows}` body is read too). */
function failureRows(body: unknown): FailureRowLike[] {
  if (Array.isArray(body)) return body as FailureRowLike[];
  if (body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows)) return (body as { rows: FailureRowLike[] }).rows;
  return body && typeof body === "object" && "reason_code" in body ? [body as FailureRowLike] : [];
}

/**
 * Every To do row: the stored `steward.todo` documents over the rows the engines' records give (`reported.failures`,
 * the queue's unreachable and not-a-url items, `directories.blocked`), highest reach first. `demand` (unit id → the
 * families' lists it is on: lib/admin/essays.ts `listsByUnit`) fills each college's demand when given.
 */
export async function readTodo(client: StoreClient, opts: { demand?: ReadonlyMap<string, number> | null; now?: () => number } = {}): Promise<TodoDoc[]> {
  const [stored, failures, blocked, queue] = await Promise.all([
    readSoft<TodoDoc>(client, STEWARD_COLLECTIONS.todo),
    readSoft<unknown>(client, SOURCE_COLLECTIONS.failures),
    readSomeSoft<{ blocked?: BlockedDirectoryLike[] }>(client, SOURCE_COLLECTIONS.blocked, ["blocked"]),
    readQueue(client, opts.now),
  ]);
  const generated = todoRows({
    failures: [...failures.values()].flatMap(failureRows),
    queueItems: queue.ok ? queue.items : [],
    blockedDirectories: blocked.get("blocked")?.blocked ?? [],
  });
  return mergeTodo(generated, stored.values(), opts.demand);
}

/* ------------------------------------------------------------------ */
/* One college's Review page, and Colleges to review                   */
/* ------------------------------------------------------------------ */

/** What the Review page needs from the dataset (`await getData()`). */
export interface ReviewData {
  getSchoolById(id: string): School | null | undefined;
  citeField(path: FieldPath, school?: School): Cited;
}

export interface ReviewRead {
  /** The college's acquisition rows (no CDS found, a blocked host), shown on top. */
  todo: TodoDoc[];
  groups: ReviewGroup[];
  /** Whether the queue was read (false: the rows are the proposals' alone). */
  queueOk: boolean;
}

/** One college's Review page: its To do rows, then its open items and pending proposal rows grouped by code. */
export async function readReviewRows(client: StoreClient, unit: string, data: ReviewData, opts: { now?: () => number } = {}): Promise<ReviewRead> {
  const [clusters, records, proposals, failures, stored] = await Promise.all([
    readClusters(client, opts.now),
    readSomeSoft<CollegeRecord>(client, SOURCE_COLLECTIONS.cdsRecords, [unit]),
    readProposals(client),
    readSomeSoft<unknown>(client, SOURCE_COLLECTIONS.failures, [unit]),
    readSoft<TodoDoc>(client, STEWARD_COLLECTIONS.todo),
  ]);
  const items = clusters.ok ? clusters.items.filter((i) => i.unit_id === unit) : [];
  const generated = todoRows({ failures: failureRows(failures.get(unit)), queueItems: items, blockedDirectories: [] });
  const todo = mergeTodo(generated, [...stored.values()].filter((t) => t.unit_id === unit)).filter((t) => t.status === "open" || t.status === "found");
  const groups = reviewRows(unit, {
    items,
    record: records.get(unit) ?? null,
    proposals,
    citeField: data.citeField,
    school: data.getSchoolById(unit) ?? null,
    free: clusters.ok ? clusters.free : undefined,
    template: CDS_TEMPLATE,
  });
  return { todo, groups, queueOk: clusters.ok };
}

/** Colleges with pending rows, most visible changes first, then "your call" rows (the Issues screen). */
export async function collegesToReview(client: StoreClient, opts: { names?: ReadonlyMap<string, string>; now?: () => number } = {}): Promise<CollegeToReview[]> {
  const [queue, proposals] = await Promise.all([readQueue(client, opts.now), readProposals(client)]);
  return reviewColleges(queue.ok ? queue.items : [], proposals, opts.names);
}
