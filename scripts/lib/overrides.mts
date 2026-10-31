/**
 * Applying a data/overrides.json patch to a school (the legacy overrides; specs/data-lineage.md): `sync-data` applies
 * each patch right after identity, and the data platform's publisher applies `overrides.legacy` the same way
 * (specs/data-platform/publish.md step 3). Moved out of scripts/sync-data.mts, which runs its sync on import, so both
 * share one copy. Pure.
 */

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
