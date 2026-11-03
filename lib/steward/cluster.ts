/**
 * The review queue's clusters (specs/product/data-steward.md "What a run does", step 1): open items grouped by check
 * and a normalized detail, so the owner reads a handful of causes instead of 21,000 rows. Pure code, run live by the
 * console's Issues screen (lib/admin/steward-reads.ts) and by the Steward's run (scripts/steward.mts); the cluster key
 * is the issue document's key in `steward.issues`.
 *
 * The key is `${check}|${maskedDetail}`. The mask replaces CDS codes ("C.116") with CODE, editions ("2025-26") and
 * four-digit years with Y, every other number ("1,436", "65.75") with #, and collapses whitespace, so the key is
 * stable when the numbers in a detail change and under any item order. A check whose masked details still vary
 * freely (more than `FREE_DETAIL_LIMIT` distinct values among the items given, or one listed in `FREE_DETAIL_CHECKS`)
 * clusters by the check alone, with detail "". Two checks never share a key: the check is the key's first part.
 *
 * An item with several failures is counted in each failure's cluster (resolving one cause doesn't clear the item).
 * Only open items (no `resolved`) are clustered. No I/O.
 */
import { reviewKey, type CheckFailure, type ReviewItem } from "../reported.ts";
import type { Cluster } from "./types.ts";

/** A check whose masked details leave more than this many distinct values clusters by the check alone. */
export const FREE_DETAIL_LIMIT = 30;

/**
 * Checks clustered by the check alone whatever their details: their details name a varying field or a quoted value
 * that is not the cause (`previous-cohort-disagrees` names each B5 column; `aid-year` quotes what H.101 says), and the
 * owner decides them as one question.
 */
export const FREE_DETAIL_CHECKS: ReadonlySet<string> = new Set(["previous-cohort-disagrees", "aid-year"]);

/** Up to this many example item keys per cluster. */
export const CLUSTER_EXAMPLES = 5;
/** Up to this many documents (sha256) per cluster. */
export const CLUSTER_DOCUMENTS = 20;
/** The store's longest document key (`data_write_documents`): a longer cluster key is cut and given a hash. */
export const CLUSTER_KEY_MAX = 200;

/** A CDS template code: "C.116", "B.2202", "H.2A01", "C.8D". */
const CODE_RE = /\b[A-J]\.(?:\d{3,4}|\d[A-Z](?:\d{2})?)\b/g;
/** An edition or academic year: "2025-26", "2024-2025", "2025–26", "2025/26". */
const EDITION_RE = /\b(?:19|20)\d{2}\s*[-–—/]\s*(?:\d{4}|\d{2})\b/g;
/** A four-digit year standing alone (not part of a longer number such as "1,2019" or "2019.5"). */
const YEAR_RE = /(?<![\d.,])(?:19|20)\d{2}(?![\d]|[.,]\d)/g;
/** Any other number, with its thousands separators and decimals: "1,436", "65.7534", "7". */
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

/** The detail with codes, editions, years and numbers masked and whitespace collapsed. */
export function maskDetail(detail: string): string {
  return detail
    .replace(CODE_RE, "CODE")
    .replace(EDITION_RE, "Y")
    .replace(YEAR_RE, "Y")
    .replace(NUMBER_RE, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a, 32 bits, as 8 hex digits: a short, stable tag for a cut key. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The cluster key for a check and its masked detail ("" when the check clusters alone), at most `CLUSTER_KEY_MAX` characters. */
export function clusterKey(check: string, maskedDetail: string): string {
  const key = `${check}|${maskedDetail}`;
  if (key.length <= CLUSTER_KEY_MAX) return key;
  const tag = `~${fnv1a(maskedDetail)}`;
  return `${key.slice(0, CLUSTER_KEY_MAX - tag.length)}${tag}`;
}

/** The check part of a cluster key. */
export function checkOfKey(key: string): string {
  const i = key.indexOf("|");
  return i < 0 ? key : key.slice(0, i);
}

const isOpen = (item: ReviewItem) => !item.resolved;

/** The checks that cluster by the check alone among these items: listed, or more than `FREE_DETAIL_LIMIT` distinct masked details. */
export function freeDetailChecks(items: readonly ReviewItem[]): Set<string> {
  const details = new Map<string, Set<string>>();
  for (const item of items) {
    if (!isOpen(item)) continue;
    for (const f of item.failures) {
      let set = details.get(f.check);
      if (!set) details.set(f.check, (set = new Set()));
      if (set.size <= FREE_DETAIL_LIMIT) set.add(maskDetail(f.detail));
    }
  }
  const out = new Set<string>(FREE_DETAIL_CHECKS);
  for (const [check, set] of details) if (set.size > FREE_DETAIL_LIMIT) out.add(check);
  return out;
}

/** The masked detail a failure clusters by: "" for a check that clusters alone. */
export function clusterDetail(failure: CheckFailure, free: ReadonlySet<string>): string {
  return free.has(failure.check) ? "" : maskDetail(failure.detail);
}

/** The cluster key of one failure, given the population's free-detail checks (`freeDetailChecks`). */
export function failureClusterKey(failure: CheckFailure, free: ReadonlySet<string>): string {
  return clusterKey(failure.check, clusterDetail(failure, free));
}

export interface ClusterOptions {
  /** Whether publishing the item would change what a visitor sees (the cluster's `published` counts such colleges). */
  publishedBy?: (item: ReviewItem) => boolean;
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The open items' clusters, largest first (items, then colleges, then key). Examples are the first five item keys in
 * key order; documents the distinct sha256s of the items in key order, up to twenty.
 */
export function clusterQueue(items: readonly ReviewItem[], opts: ClusterOptions = {}): Cluster[] {
  const open = items.filter(isOpen).map((item) => ({ id: reviewKey(item), item })).sort((a, b) => byKey(a.id, b.id));
  const free = freeDetailChecks(open.map((o) => o.item));
  const groups = new Map<string, { check: string; detail: string; ids: string[]; seen: Set<string>; colleges: Set<string>; published: Set<string>; documents: string[] }>();
  for (const { id, item } of open) {
    const published = opts.publishedBy?.(item) ?? false;
    for (const f of item.failures) {
      const detail = clusterDetail(f, free);
      const key = clusterKey(f.check, detail);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { check: f.check, detail, ids: [], seen: new Set(), colleges: new Set(), published: new Set(), documents: [] }));
      if (g.seen.has(id)) continue;
      g.seen.add(id);
      g.ids.push(id);
      g.colleges.add(item.unit_id);
      if (published) g.published.add(item.unit_id);
      if (item.sha256 && g.documents.length < CLUSTER_DOCUMENTS && !g.documents.includes(item.sha256)) g.documents.push(item.sha256);
    }
  }
  return [...groups.entries()]
    .map(([key, g]): Cluster => ({
      key,
      check: g.check,
      detail: g.detail,
      items: g.ids.length,
      colleges: g.colleges.size,
      published: g.published.size,
      examples: g.ids.slice(0, CLUSTER_EXAMPLES),
      documents: g.documents,
    }))
    .sort((a, b) => b.items - a.items || b.colleges - a.colleges || byKey(a.key, b.key));
}

/** The open items of one cluster, in key order (the Steward's `read_cluster`, the Issues screen's unfolded examples). */
export function clusterItems(items: readonly ReviewItem[], key: string): ReviewItem[] {
  const open = items.filter(isOpen);
  const free = freeDetailChecks(open);
  return open.filter((item) => item.failures.some((f) => failureClusterKey(f, free) === key)).sort((a, b) => byKey(reviewKey(a), reviewKey(b)));
}
