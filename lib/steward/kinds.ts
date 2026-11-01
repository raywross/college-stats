/**
 * Which of the four kinds of issue a cluster is (specs/product/data-steward.md "Four kinds of issue"), by rule, so the
 * Issues screen sorts the clusters before any agent runs and the Steward starts from the same answer. Checked in
 * order; every cluster gets exactly one kind:
 *
 * 1. **acquisition**: we can't get or read the document. The check is `unreachable` or `not-a-url`; or it is
 *    `line-in-document` and the cluster names no document we hold; or every document the items name is unfetched (not
 *    in the `reported.docs` manifest).
 * 2. **policy**: the check is one only the owner decides (`POLICY_CHECKS`).
 * 3. **systemic**: one masked detail holds more than 60% of the check's open items, across more than 10 colleges (a
 *    rule or the pipeline is wrong for every college it touches).
 * 4. **value**: everything else (one college's figure at a time).
 *
 * Pure; `kindContext` computes the per-check counts from the same items the clusters came from.
 */
import { reviewKey, type ReviewItem } from "../reported.ts";
import { maskDetail } from "./cluster.ts";
import type { Cluster, IssueKind } from "./types.ts";

/** Checks no decision about one value can help: the document couldn't be fetched, or a link isn't one. */
export const ACQUISITION_CHECKS: ReadonlySet<string> = new Set(["unreachable", "not-a-url"]);
/** Checks whose holds are the owner's choice (how old a figure may be, how far from federal it may move). */
export const POLICY_CHECKS: ReadonlySet<string> = new Set(["previous-cohort-disagrees", "plausible-change", "newer-than-federal"]);
/** A masked detail holding more than this share of its check's items… */
export const SYSTEMIC_SHARE = 0.6;
/** …across more than this many colleges is systemic. */
export const SYSTEMIC_COLLEGES = 10;

export interface CheckStats {
  /** The check's open items. */
  items: number;
  /** Its most common masked detail (by items, then colleges, then text), with that detail's items and colleges. */
  top: { detail: string; items: number; colleges: number } | null;
}

export interface KindContext {
  /** Per check, over the open items the clusters came from. */
  checks: ReadonlyMap<string, CheckStats>;
  /** Whether a document (sha256) was ever fetched (it has a manifest entry). Absent: every document counts as fetched. */
  fetched?: (sha256: string) => boolean;
}

/** The per-check counts `kindOf` reads. `fetched` is passed through. */
export function kindContext(items: readonly ReviewItem[], opts: { fetched?: (sha256: string) => boolean } = {}): KindContext {
  const per = new Map<string, { items: Set<string>; details: Map<string, { items: Set<string>; colleges: Set<string> }> }>();
  for (const item of items) {
    if (item.resolved) continue;
    const id = reviewKey(item);
    for (const f of item.failures) {
      let c = per.get(f.check);
      if (!c) per.set(f.check, (c = { items: new Set(), details: new Map() }));
      c.items.add(id);
      const masked = maskDetail(f.detail);
      let d = c.details.get(masked);
      if (!d) c.details.set(masked, (d = { items: new Set(), colleges: new Set() }));
      d.items.add(id);
      d.colleges.add(item.unit_id);
    }
  }
  const checks = new Map<string, CheckStats>();
  for (const [check, c] of per) {
    let top: CheckStats["top"] = null;
    for (const [detail, d] of c.details) {
      const cand = { detail, items: d.items.size, colleges: d.colleges.size };
      if (!top || cand.items > top.items || (cand.items === top.items && (cand.colleges > top.colleges || (cand.colleges === top.colleges && cand.detail < top.detail)))) top = cand;
    }
    checks.set(check, { items: c.items.size, top });
  }
  return { checks, fetched: opts.fetched };
}

/** Whether the cluster's documents are all unfetched: it names none we hold. `noneNamed` decides a cluster naming no document. */
function allUnfetched(cluster: Cluster, context: KindContext, noneNamed: boolean): boolean {
  if (!cluster.documents.length) return noneNamed;
  return !!context.fetched && cluster.documents.every((sha) => !context.fetched!(sha));
}

/** The kind of one cluster. */
export function kindOf(cluster: Cluster, context: KindContext): IssueKind {
  if (ACQUISITION_CHECKS.has(cluster.check)) return "acquisition";
  if (cluster.check === "line-in-document" && allUnfetched(cluster, context, true)) return "acquisition";
  if (allUnfetched(cluster, context, false)) return "acquisition";
  if (POLICY_CHECKS.has(cluster.check)) return "policy";
  const stats = context.checks.get(cluster.check);
  if (stats && stats.items > 0) {
    // A cluster with a detail is one masked detail; a check clustered alone is judged by its most common detail.
    const share = cluster.detail ? { items: cluster.items, colleges: cluster.colleges } : stats.top;
    if (share && share.items / stats.items > SYSTEMIC_SHARE && share.colleges > SYSTEMIC_COLLEGES) return "systemic";
  }
  return "value";
}

/** Every cluster with its kind, from the items it came from (the Issues screen's table). */
export function kindsOf(clusters: readonly Cluster[], items: readonly ReviewItem[], opts: { fetched?: (sha256: string) => boolean } = {}): Map<string, IssueKind> {
  const context = kindContext(items, opts);
  return new Map(clusters.map((c) => [c.key, kindOf(c, context)]));
}

