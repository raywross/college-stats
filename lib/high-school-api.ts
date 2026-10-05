"use client";

import type { HighSchoolHit } from "@/lib/high-school-types";

/** Client helpers for /api/high-schools (the `/high-schools` search page and the `/me` picker). */

export async function searchHighSchoolsApi(
  q: string,
  opts: { state?: string; kind?: "public" | "private"; limit?: number; signal?: AbortSignal } = {},
): Promise<HighSchoolHit[]> {
  const params = new URLSearchParams({ q, limit: String(opts.limit ?? 8) });
  if (opts.state) params.set("state", opts.state);
  if (opts.kind) params.set("kind", opts.kind);
  const res = await fetch(`/api/high-schools?${params}`, { signal: opts.signal });
  if (!res.ok) return [];
  return (await res.json()) as HighSchoolHit[];
}

/** Resolves a saved high school id back to its display row (null if unknown or the fetch fails). */
export async function fetchHighSchoolHit(id: string): Promise<HighSchoolHit | null> {
  const res = await fetch(`/api/high-schools/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as HighSchoolHit;
}
