"use client";

import { useEffect, useState } from "react";
import type { SchoolIndexEntry } from "@/lib/data";

/** Client helpers for /api/schools, with a small in-memory cache. */

const byId = new Map<string, SchoolIndexEntry>();

export async function searchSchoolsApi(q: string, opts: { limit?: number; exclude?: string[]; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams({ q, limit: String(opts.limit ?? 8) });
  if (opts.exclude?.length) params.set("exclude", opts.exclude.join(","));
  const res = await fetch(`/api/schools?${params}`, { signal: opts.signal });
  if (!res.ok) return [];
  const results = (await res.json()) as SchoolIndexEntry[];
  for (const r of results) byId.set(r.id, r);
  return results;
}

/** Resolve ids to display entries, fetching any we haven't seen yet. */
export function useSchoolEntries(ids: string[]): SchoolIndexEntry[] {
  const key = ids.join(",");
  const [, setVersion] = useState(0);

  useEffect(() => {
    const missing = key.split(",").filter((id) => id && !byId.has(id));
    if (!missing.length) return;
    let cancelled = false;
    fetch(`/api/schools?ids=${missing.join(",")}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SchoolIndexEntry[]) => {
        for (const r of rows) byId.set(r.id, r);
        if (!cancelled) setVersion((v) => v + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  return ids.map((id) => byId.get(id)).filter((e): e is SchoolIndexEntry => !!e);
}
