"use client";

import { matchIndex, toSchoolEntry, type SearchIndex } from "./search-index.ts";
import type { SchoolIndexEntry } from "./dataset.ts";

/**
 * Browser side of the search index (specs/serving-architecture.md#3-search-in-the-browser): `/search-index.json`
 * is fetched once per page load and kept in module memory; every search after that is local.
 */

let loading: Promise<SearchIndex> | null = null;
let loaded: SearchIndex | null = null;
let byId: Map<string, SchoolIndexEntry> | null = null;

/** Starts (or joins) the one index fetch. A failed fetch is forgotten so the next call retries. */
export function loadSearchIndex(): Promise<SearchIndex> {
  loading ??= fetch("/search-index.json", { cache: "force-cache" })
    .then((res) => {
      if (!res.ok) throw new Error(`/search-index.json returned ${res.status}`);
      return res.json() as Promise<SearchIndex>;
    })
    .then((index) => {
      loaded = index;
      byId = new Map(index.schools.map((e) => [e.id, toSchoolEntry(e)]));
      return index;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** True once the index is in memory, so a caller can tell "still loading" from "no matches". */
export function searchIndexReady(): boolean {
  return loaded !== null;
}

/** Matches against the loaded index (empty until `loadSearchIndex()` has resolved). */
export function searchLocal(q: string, opts: { limit?: number; exclude?: string[] } = {}): SchoolIndexEntry[] {
  return loaded ? matchIndex(loaded, q, opts) : [];
}

/** Entries for the ids that exist, in the order given (empty until the index is loaded). */
export function entriesByIds(ids: readonly string[]): SchoolIndexEntry[] {
  const map = byId;
  if (!map) return [];
  return ids.map((id) => map.get(id)).filter((e): e is SchoolIndexEntry => !!e);
}
