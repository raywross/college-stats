/**
 * The identity producers on the data store (specs/data-platform/pipelines.md, "identity-refresh"): sync-wikidata,
 * probe-sites and sync-brand read their own prior state from the `identity.*` layers and write them back per college,
 * keyed as scripts/import-data-from-files.mts keys them (one document per unit id; `identity.link_issues` and
 * `identity.wikidata_issues` hold a college's rows as a list, in file order). No producer writes a composed college:
 * the publisher applies identity (scripts/lib/data-platform/compose.mts step 2).
 *
 * `storeColleges` is the colleges as the publisher composes them through identity and the legacy overrides (steps 1-3),
 * which is what the scripts used to read from data/schools.json: names, homepages and stored links.
 */
import type { School } from "../../lib/types";
import type { BrandColorEntry, BrandLogoEntry, BrandOverride, LinkIssue, SiteProbeEntry, WikidataEntry } from "../../lib/identity-files";
import { applyIdentity } from "../../lib/identity.ts";
import { applyOverride } from "./overrides.mts";
import type { ChangeSetHandle, DataStore } from "./data-platform/store.mts";
import { COLLECTIONS, datasetOrder, loadIdentity, readLayer } from "./data-platform/layers.mts";
import { replaceCollection } from "./data-platform/change-set.mts";
import type { WikidataIssue } from "./wikidata.mts";
import type { ProbeState } from "./site-probe.mts";

/**
 * The base colleges with identity and the legacy overrides applied (compose steps 1-3), in the dataset's order. Reads
 * `base.colleges` alone of the base (not the detail tables `loadBase` also reads).
 */
export async function storeColleges(store: DataStore): Promise<School[]> {
  const [colleges, identity] = await Promise.all([readLayer<School>(store, COLLECTIONS.base.colleges), loadIdentity(store)]);
  const schools = [...colleges.values()];
  return datasetOrder(
    schools.map((s) => {
      const withIdentity = applyIdentity(s, identity);
      const patch = identity.overrides[s.unit_id];
      return patch ? applyOverride(withIdentity, patch) : withIdentity;
    })
  );
}

/** One document per row, by unit id. */
export function byUnit<T extends { unit_id: string }>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    if (out.has(r.unit_id)) throw new Error(`identity: two rows for ${r.unit_id}`);
    out.set(r.unit_id, r);
  }
  return out;
}

/** One document per unit id holding that college's rows, in their order (the import's `groupedPerUnit`). */
export function groupedByUnit<T extends { unit_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(r.unit_id, [...(out.get(r.unit_id) ?? []), r]);
  return out;
}

/** A per-college collection's rows, by unit id. */
export async function readRows<T>(store: DataStore, collection: string): Promise<T[]> {
  return [...(await readLayer<T>(store, collection)).values()];
}

/** A grouped collection's rows, flattened in unit id order. */
export async function readGroupedRows<T>(store: DataStore, collection: string): Promise<T[]> {
  return [...(await readLayer<T[]>(store, collection)).values()].flat();
}

/* ------------------------------------------------------------------ */
/* Each producer's collections                                        */
/* ------------------------------------------------------------------ */

export const readWikidata = (store: DataStore) => readRows<WikidataEntry>(store, COLLECTIONS.identity.wikidata);
export const readProbe = (store: DataStore) => readRows<SiteProbeEntry>(store, COLLECTIONS.identity.probe);
export const readLinkIssues = (store: DataStore) => readGroupedRows<LinkIssue>(store, COLLECTIONS.identity.linkIssues);
export const readBrandColors = (store: DataStore) => readRows<BrandColorEntry>(store, COLLECTIONS.identity.brandColors);
export const readBrandLogos = (store: DataStore) => readRows<BrandLogoEntry>(store, COLLECTIONS.identity.brandLogos);

/** identity.brand_overrides as the file's object (its `_` keys included, as imported). */
export async function readBrandOverrides(store: DataStore): Promise<Record<string, BrandOverride>> {
  return Object.fromEntries(await readLayer<BrandOverride>(store, COLLECTIONS.identity.brandOverrides));
}

/** sync-wikidata's two files: every entry, and the issues grouped by college. Both replace the collections whole. */
export async function writeWikidata(store: DataStore, handle: ChangeSetHandle, entries: readonly WikidataEntry[], issues: readonly WikidataIssue[]): Promise<void> {
  await replaceCollection(store, handle, COLLECTIONS.identity.wikidata, byUnit(entries));
  await replaceCollection(store, handle, COLLECTIONS.identity.wikidataIssues, groupedByUnit(issues));
}

/**
 * The site probe's state in the store (`runSiteProbe`'s `state`): the previous entries and issues, and the save into
 * `handle` (null for a dry run: the save writes nothing).
 */
export async function probeStateFromStore(store: DataStore, handle: ChangeSetHandle | null): Promise<ProbeState> {
  const [previous, issues] = await Promise.all([readProbe(store), readLinkIssues(store)]);
  return {
    previous,
    issues,
    async save(probe, nextIssues) {
      if (!handle) return;
      // The keys are the ones just read: no second read of the two large collections.
      await replaceCollection(store, handle, COLLECTIONS.identity.probe, byUnit(probe), { currentKeys: previous.map((e) => e.unit_id) });
      await replaceCollection(store, handle, COLLECTIONS.identity.linkIssues, groupedByUnit(nextIssues), { currentKeys: issues.map((i) => i.unit_id) });
    },
  };
}

/**
 * The brand colors after a run: a full run's rows replace the collection; a run on `ids` replaces only those
 * colleges' rows (a college in `ids` with no colors this run loses its row, as the file's merge did).
 */
export async function writeBrandColors(store: DataStore, handle: ChangeSetHandle, entries: readonly BrandColorEntry[], ids?: ReadonlySet<string>): Promise<void> {
  await replaceCollection(store, handle, COLLECTIONS.identity.brandColors, byUnit(entries), { keep: ids ? (k) => !ids.has(k) : undefined });
}

/** The marks after a run (`syncIcons` returns every row, kept ones included): they replace the collection. */
export async function writeBrandLogos(store: DataStore, handle: ChangeSetHandle, entries: readonly BrandLogoEntry[]): Promise<void> {
  await replaceCollection(store, handle, COLLECTIONS.identity.brandLogos, byUnit(entries));
}
