/**
 * Applying a data/overrides.json patch to a school (the legacy overrides; specs/data-lineage.md): `sync-data` applies
 * each patch right after identity, and the data platform's publisher applies `overrides.legacy` the same way
 * (specs/data-platform/publish.md step 3). Moved out of scripts/sync-data.mts, which runs its sync on import, so both
 * share one copy. Pure.
 */
import type { School } from "../../lib/types";
import { lineageForPatch } from "../../lib/lineage.ts";
import { trendSummary, type CpiTable, type HistoryMeta, type SchoolHistory } from "../../lib/history.ts";

/** One college's patch: nested values to set; keys starting with `_` are notes and are skipped. */
export type Patch = { [key: string]: unknown };

/** `target` with `patch` merged in (objects merged key by key, everything else replaced), as a new object. */
export function deepMerge<T>(target: T, patch: Patch): T {
  const out = structuredClone(target) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith("_")) continue; // comments / provenance notes
    const cur = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)
        ? deepMerge(cur, v as Patch)
        : v;
  }
  return out as T;
}

/**
 * One college's legacy override applied as sync-data applies it, right after identity: every value the patch sets is
 * attributed to the patch's source (`lineageForPatch`, which throws when the patch names none), the patch merged in,
 * and its records laid over the school's lineage. Returns a new school. sync-data and the publisher
 * (scripts/lib/data-platform/compose.mts) both call this, so the two can't drift.
 */
export function applyOverride(school: School, patch: Patch): School {
  const patchLineage = lineageForPatch(school.unit_id, patch);
  const merged = deepMerge(school, patch);
  merged.lineage = { ...(merged.lineage ?? {}), ...patchLineage };
  return merged;
}

/**
 * `school.trends` carried from an earlier copy of the dataset (sync-data: the committed data/schools.json; the
 * publisher: the previous snapshot), since only `npm run sync-history` rebuilds it. In place; a college the earlier
 * copy has no trends for keeps what it has.
 */
export function carryTrends(schools: School[], previous: ReadonlyMap<string, School["trends"]>): void {
  for (const s of schools) {
    const t = previous.get(s.unit_id);
    if (t) s.trends = t;
  }
}

/**
 * `school.trends` derived from the history layer, the way `npm run sync-history` writes it: each college's
 * `trendSummary` over its history (no history, or an empty summary, removes the block). In place; returns how many
 * colleges have trends. Data platform phase 2: sync-history writes `history.*` only, so the publisher can call this in
 * place of `carryTrends` and a history run reaches the site (on the committed data it gives every college's trends
 * back byte for byte; tests/data-platform-sources.test.mts).
 */
export function deriveTrends(schools: School[], histories: ReadonlyMap<string, SchoolHistory>, cpi: CpiTable, hmeta: Pick<HistoryMeta, "latest">): number {
  let withTrends = 0;
  for (const s of schools) {
    const h = histories.get(s.unit_id);
    const t = h ? trendSummary(h, cpi, hmeta) : {};
    if (Object.keys(t).length) {
      s.trends = t;
      withTrends++;
    } else delete s.trends;
  }
  return withTrends;
}
