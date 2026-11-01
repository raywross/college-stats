/**
 * A stand-in for lib/steward/cluster.ts (unit S1, built in parallel): the same name, signature and cluster-key rule
 * (the build brief's "Shared contracts"), so `list_clusters` works on this branch. **Replace the import in ./tools.mts
 * with `../../../lib/steward/cluster.ts` when S1 lands, and delete this file.**
 *
 * The key is `${check}|${maskedDetail}`: CDS codes become `CODE`, editions (`2025-26`) and four-digit years `Y`, other
 * digit runs `#`, whitespace collapsed. A check whose masked details take more than 30 values clusters by check alone
 * (`detail: ""`). Sorted by items, then colleges, then key.
 */
import { reviewKey, type ReviewItem } from "../../../lib/reported.ts";
import type { Cluster } from "../../../lib/steward/types.ts";

export const FREE_DETAIL_LIMIT = 30;

export function maskDetail(detail: string): string {
  return detail
    .replace(/\b[A-J]\.\d{3}\b/g, "CODE")
    .replace(/\b(19|20)\d{2}[-–](\d{4}|\d{2})\b/g, "Y")
    .replace(/\b(19|20)\d{2}\b/g, "Y")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

export const clusterKey = (check: string, maskedDetail: string) => `${check}|${maskedDetail}`;

export function clusterQueue(items: ReviewItem[], opts: { publishedBy?: (item: ReviewItem) => boolean } = {}): Cluster[] {
  const open = items.filter((i) => !i.resolved);
  const details = new Map<string, Set<string>>();
  for (const i of open) for (const f of i.failures) (details.get(f.check) ?? details.set(f.check, new Set()).get(f.check)!).add(maskDetail(f.detail));
  const free = new Set([...details].filter(([, s]) => s.size > FREE_DETAIL_LIMIT).map(([c]) => c));
  const groups = new Map<string, { check: string; detail: string; items: Map<string, ReviewItem> }>();
  for (const i of open) {
    for (const f of i.failures) {
      const detail = free.has(f.check) ? "" : maskDetail(f.detail);
      const key = clusterKey(f.check, detail);
      const g = groups.get(key) ?? groups.set(key, { check: f.check, detail, items: new Map() }).get(key)!;
      g.items.set(reviewKey(i), i);
    }
  }
  const out: Cluster[] = [...groups].map(([key, g]) => {
    const list = [...g.items].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const colleges = new Set(list.map(([, i]) => i.unit_id));
    const published = new Set(list.filter(([, i]) => opts.publishedBy?.(i)).map(([, i]) => i.unit_id));
    return {
      key,
      check: g.check,
      detail: g.detail,
      items: list.length,
      colleges: colleges.size,
      published: published.size,
      examples: list.slice(0, 5).map(([k]) => k),
      documents: [...new Set(list.map(([, i]) => i.sha256).filter((s): s is string => !!s))].sort().slice(0, 20),
    };
  });
  return out.sort((a, b) => b.items - a.items || b.colleges - a.colleges || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
