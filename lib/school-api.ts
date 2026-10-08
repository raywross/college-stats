"use client";

import { useEffect, useState } from "react";
import type { SchoolIndexEntry } from "@/lib/data";
import { entriesByIds, loadSearchIndex, searchIndexReady, searchLocal } from "@/lib/search-client";

/**
 * Client helpers for finding colleges, backed by the static search index (lib/search-client.ts): no request per
 * keystroke, and nothing after the index's one fetch.
 */

/**
 * Matches `q` against the index, waiting for it to load first. `signal` skips a stale result: an aborted search
 * resolves to nothing rather than overwriting the newer one.
 */
export async function searchSchoolsApi(q: string, opts: { limit?: number; exclude?: string[]; signal?: AbortSignal } = {}): Promise<SchoolIndexEntry[]> {
  await loadSearchIndex();
  if (opts.signal?.aborted) return [];
  return searchLocal(q, { limit: opts.limit ?? 8, exclude: opts.exclude });
}

/** Resolve ids to display entries from the index (they appear once it has loaded). */
export function useSchoolEntries(ids: string[]): SchoolIndexEntry[] {
  const key = ids.join(",");
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!key || searchIndexReady()) return;
    let cancelled = false;
    loadSearchIndex()
      .then(() => {
        if (!cancelled) setVersion((v) => v + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  return entriesByIds(key ? key.split(",") : []);
}
