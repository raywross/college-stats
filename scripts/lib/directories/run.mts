/**
 * One adapter's run (specs/campus-directories.md#the-runner): crawl, clean, match, and build its two files. Pure apart
 * from the crawl itself; scripts/sync-directories.mts writes the results and records refusals.
 */
import { MAX_QUOTE } from "../../../lib/directories.ts";
import type { CrawlContext, DirectoryAdapter, RawEntry } from "./contract.mts";
import { headerOf, sortEntries, type DirectoryFile, type MatchedEntry, type UnmatchedEntry, type UnmatchedFile } from "./files.mts";
import { matchEntry, postalOf, type MatchIndex } from "./matcher.mts";

const clean = (s: unknown): string | undefined => {
  if (typeof s !== "string") return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t || undefined;
};

/** Trims every field, drops empty ones, writes states as postal codes, and refuses quotes over 160 characters. */
export function cleanEntry(e: RawEntry, org: string): RawEntry | null {
  const campus = clean(e.campus);
  if (!campus) return null;
  const quote = clean(e.quote);
  if (quote && quote.length > MAX_QUOTE) throw new Error(`${org}: quote for "${campus}" is over ${MAX_QUOTE} characters; store a short quote, never page text`);
  const state = clean(e.state);
  const out: RawEntry = { campus };
  const campuses = e.campuses?.map(clean).filter((x): x is string => !!x);
  if (campuses?.length) out.campuses = campuses;
  const set = <K extends keyof RawEntry>(k: K, v: RawEntry[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("city", clean(e.city));
  set("state", state ? (postalOf(state) ?? state) : undefined);
  set("name", clean(e.name));
  set("url", clean(e.url));
  set("status", clean(e.status));
  set("fact", clean(e.fact));
  set("quote", quote);
  set("tier", e.tier);
  return out;
}

const entryId = (e: RawEntry) => JSON.stringify([e.campus, e.campuses ?? null, e.city ?? null, e.state ?? null, e.name ?? null, e.url ?? null]);

/** Matches cleaned entries into the org file and the unmatched file (both sorted, duplicates dropped). */
export function buildFiles(adapter: DirectoryAdapter, raw: readonly RawEntry[], index: MatchIndex, crawled: string): { file: DirectoryFile; unmatched: UnmatchedFile } {
  const seen = new Set<string>();
  const entries: RawEntry[] = [];
  for (const r of raw) {
    const e = cleanEntry(r, adapter.key);
    if (!e || seen.has(entryId(e))) continue;
    seen.add(entryId(e));
    entries.push(e);
  }
  const matched: MatchedEntry[] = [];
  const unmatched: UnmatchedEntry[] = [];
  for (const e of sortEntries(entries)) {
    const r = matchEntry(index, e);
    if (r.status === "matched") matched.push({ ...e, matches: r.matches, ...(r.multi ? { multi: true as const } : {}) });
    else unmatched.push({ ...e, reason: r.reason, candidates: r.candidates });
  }
  const colleges = new Set(matched.flatMap((m) => m.matches.map((x) => x.unit_id)));
  return {
    file: {
      ...headerOf(adapter),
      crawled,
      counts: { entries: entries.length, matched: matched.length, multi: matched.filter((m) => m.multi).length, unmatched: unmatched.length, colleges: colleges.size },
      entries: matched,
    },
    unmatched: { org: adapter.key, crawled, entries: unmatched },
  };
}

/** Crawl + build. Throws what the crawl throws (`Blocked`, `HttpError`), so the caller can record or report it. */
export async function runAdapter(adapter: DirectoryAdapter, ctx: CrawlContext, index: MatchIndex): Promise<{ file: DirectoryFile; unmatched: UnmatchedFile }> {
  const raw = await adapter.crawl(ctx);
  if (!Array.isArray(raw)) throw new Error(`${adapter.key}: crawl() must return an array of entries`);
  if (!raw.length) throw new Error(`${adapter.key}: crawl() returned no entries; the list's layout may have changed (previous file kept)`);
  return buildFiles(adapter, raw, index, ctx.today);
}
