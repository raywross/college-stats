/**
 * One college's documents for the college page's Documents panel (specs/product/document-collisions.md): its CDS record,
 * the manifest entry of each document, and how many review-queue items each document has (what a drop removes), read
 * from `data_documents` with the admin's session (the table selects for everyone; the page checks `requireAdmin()`
 * first). The Steward's collision findings for the Inbox are read here too, by their key prefix, so the Inbox never
 * reads every issue.
 *
 * Fail soft: a read that fails is logged and the panel says it couldn't read the record.
 */
import type { CollegeRecord, ManifestEntry } from "../cds-sections.ts";
import type { ReviewItem } from "../reported.ts";
import type { IssueDoc } from "../steward/types.ts";

type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
interface Query<T> extends Rows<T> {
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  like(column: string, pattern: string): Query<T>;
  gt(column: string, value: string): Query<T>;
  order(column: string, opts?: { ascending?: boolean }): Query<T>;
  limit(n: number): Query<T>;
}
/** The slice of a Supabase client these reads use. */
export interface DocumentsClient {
  from(table: string): { select(columns: string): Query<{ key: string; body: unknown }> };
}

const PAGE = 1000;
const MAX_PAGES = 20;
const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

async function readPrefix<T>(client: DocumentsClient, collection: string, prefix: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = client.from("data_documents").select("key, body").eq("collection", collection).like("key", likePrefix(prefix));
    if (after !== null) q = q.gt("key", after);
    const { data, error } = await q.order("key", { ascending: true }).limit(PAGE);
    if (error) throw new Error(`admin: reading ${collection} failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) out.set(r.key, r.body as T);
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].key;
  }
  return out;
}

async function readKeys<T>(client: DocumentsClient, collection: string, keys: readonly string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (!keys.length) return out;
  const { data, error } = await client.from("data_documents").select("key, body").eq("collection", collection).in("key", [...keys]);
  if (error) throw new Error(`admin: reading ${collection} failed: ${error.message}`);
  for (const r of data ?? []) out.set(r.key, r.body as T);
  return out;
}

export interface CollegeDocuments {
  record: CollegeRecord | null;
  /** Manifest entries by sha256. */
  manifest: Map<string, ManifestEntry>;
  /** Review-queue items by the document's sha256 (every item, as a drop removes them all). */
  queue: Map<string, number>;
}

/** The college's record, its documents' manifest entries, and their queue counts; null when the record couldn't be read. */
export async function readCollegeDocuments(client: DocumentsClient, unit: string): Promise<CollegeDocuments | null> {
  try {
    const record = (await readKeys<CollegeRecord>(client, "reported.cds_records", [unit])).get(unit) ?? null;
    const shas = (record?.documents ?? []).map((d) => d.sha256);
    const [manifest, items] = await Promise.all([readKeys<ManifestEntry>(client, "reported.docs", shas), shas.length ? readPrefix<ReviewItem>(client, "reported.review_queue", `${unit}|`) : Promise.resolve(new Map<string, ReviewItem>())]);
    const queue = new Map<string, number>();
    for (const item of items.values()) if (item?.sha256) queue.set(item.sha256, (queue.get(item.sha256) ?? 0) + 1);
    return { record, manifest, queue };
  } catch (e) {
    console.error(`[admin college] ${unit}'s documents could not be read`, e);
    return null;
  }
}

/** One college's CDS record, or null (none, or the read failed). */
export async function readRecord(client: DocumentsClient, unit: string): Promise<CollegeRecord | null> {
  try {
    return (await readKeys<CollegeRecord>(client, "reported.cds_records", [unit])).get(unit) ?? null;
  } catch (e) {
    console.error(`[admin] ${unit}'s record could not be read`, e);
    return null;
  }
}

/** The Steward's collision findings (`steward.issues` keyed `collision|…`), for the Inbox. */
export async function readCollisionIssues(client: DocumentsClient): Promise<IssueDoc[]> {
  return [...(await readPrefix<IssueDoc>(client, "steward.issues", "collision|")).values()];
}
