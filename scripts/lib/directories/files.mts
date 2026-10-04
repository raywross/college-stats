/**
 * The files the directory runner writes (specs/campus-directories.md#files), all under data/directories/:
 *   <org>.json            matched entries, the list's credit, the date crawled, counts
 *   unmatched/<org>.json  entries below the match threshold, with the reason and nearest colleges, for review
 *   blocked.json          lists that refused us (owner decision 1): org, URL, what blocks it, first and last seen
 *   matches.json          hand-checked answers the matcher uses first: "campus|ST" → unit ids ([] = not on the site)
 *   organizations.json    one entry per adapter: website, Greek letters, colors, Wikidata id, logo (specs/campus-directories.md#organizations)
 * Entries are sorted and written one per line, so a re-crawl's diff shows only what changed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classificationProblem, type Classification, type DirectoryTier } from "../../../lib/directories.ts";
import type { Blocked, DirectoryAdapter, RawEntry } from "./contract.mts";
import type { Match } from "./matcher.mts";

export interface MatchedEntry extends Omit<RawEntry, "campuses"> {
  campuses?: string[];
  matches: Match[];
  /** The chapter serves several colleges. */
  multi?: true;
}

export interface UnmatchedEntry extends RawEntry {
  reason: string;
  candidates: { unit_id: string; name: string; score: number }[];
}

export interface DirectoryFile {
  org: string;
  organization: string;
  publisher: string;
  list_url: string;
  tier: DirectoryTier;
  classification: Classification;
  /** ISO date of the crawl (the "date read" in every credit). */
  crawled: string;
  counts: { entries: number; matched: number; multi: number; unmatched: number; colleges: number };
  entries: MatchedEntry[];
}

export interface UnmatchedFile {
  org: string;
  crawled: string;
  entries: UnmatchedEntry[];
}

export interface BlockedRecord {
  org: string;
  url: string;
  reason: Blocked["reason"];
  detail?: string;
  first_seen: string;
  last_seen: string;
}

export interface BlockedFile {
  blocked: BlockedRecord[];
}

export const directoriesDir = (root: string) => join(root, "data", "directories");
const RESERVED = new Set(["blocked.json", "matches.json", "organizations.json"]);

/** The classification fields of an adapter, alone (what every listing from it is). */
export function classificationOf(a: Classification): Classification {
  if (a.domain === "faith") return { domain: "faith", tradition: a.tradition };
  if (a.domain === "greek") return { domain: "greek", council: a.council };
  return a.kind === "policy" ? { domain: "lgbtq", kind: "policy", policy: a.policy } : { domain: "lgbtq", kind: a.kind };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const entryOrder = (a: RawEntry, b: RawEntry) =>
  cmp(a.state ?? "", b.state ?? "") || cmp(a.campus, b.campus) || cmp(a.name ?? "", b.name ?? "") || cmp(a.url ?? "", b.url ?? "");

export function sortEntries<T extends RawEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(entryOrder);
}

/** Pretty header, one entry per line. */
export function formatEntriesFile(file: { entries: readonly unknown[] } & Record<string, unknown>): string {
  const { entries, ...head } = file;
  const headLines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const body = entries.length ? `[\n${entries.map((e) => `    ${JSON.stringify(e)}`).join(",\n")}\n  ]` : "[]";
  return `{\n${[...headLines, `  "entries": ${body}`].join(",\n")}\n}\n`;
}

export function writeOrgFiles(root: string, file: DirectoryFile, unmatched: UnmatchedFile): void {
  const dir = directoriesDir(root);
  mkdirSync(join(dir, "unmatched"), { recursive: true });
  writeFileSync(join(dir, `${file.org}.json`), formatEntriesFile(file as unknown as { entries: unknown[] }));
  const u = join(dir, "unmatched", `${file.org}.json`);
  if (unmatched.entries.length) writeFileSync(u, formatEntriesFile(unmatched as unknown as { entries: unknown[] }));
  else if (existsSync(u)) rmSync(u);
}

/** Every data/directories/<org>.json, sorted by org. */
export function readDirectoryFiles(root: string): DirectoryFile[] {
  const dir = directoriesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !RESERVED.has(f))
    .sort()
    .map((f) => {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as DirectoryFile;
      if (`${d.org}.json` !== f) throw new Error(`data/directories/${f}: org "${d.org}" doesn't match the file name`);
      const cls = classificationProblem(d.classification);
      if (cls) throw new Error(`data/directories/${f}: ${cls}`);
      return d;
    });
}

export function readBlocked(root: string): BlockedFile {
  const f = join(directoriesDir(root), "blocked.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as BlockedFile) : { blocked: [] };
}

/** Adds or refreshes one refusal (keyed by org + URL); an org that was read successfully today drops its records. */
export function recordBlock(file: BlockedFile, b: { org: string; url: string; reason: Blocked["reason"]; detail?: string }, today: string): BlockedFile {
  const prev = file.blocked.find((x) => x.org === b.org && x.url === b.url);
  const rest = file.blocked.filter((x) => x !== prev);
  const rec: BlockedRecord = { org: b.org, url: b.url, reason: b.reason, ...(b.detail ? { detail: b.detail } : {}), first_seen: prev?.first_seen ?? today, last_seen: today };
  return { blocked: [...rest, rec].sort((x, y) => cmp(x.org, y.org) || cmp(x.url, y.url)) };
}

export function clearBlocks(file: BlockedFile, org: string): BlockedFile {
  return { blocked: file.blocked.filter((x) => x.org !== org) };
}

export function writeBlocked(root: string, file: BlockedFile): void {
  mkdirSync(directoriesDir(root), { recursive: true });
  writeFileSync(join(directoriesDir(root), "blocked.json"), `${JSON.stringify(file, null, 2)}\n`);
}

export function readReviewed(root: string): Record<string, string[]> {
  const f = join(directoriesDir(root), "matches.json");
  if (!existsSync(f)) return {};
  const raw = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")) as [string, string[]][]);
}

/** The adapter's credit fields for a file header. */
export function headerOf(a: DirectoryAdapter): Pick<DirectoryFile, "org" | "organization" | "publisher" | "list_url" | "tier" | "classification"> {
  return { org: a.key, organization: a.organization, publisher: a.publisher, list_url: a.listUrl, tier: a.tier, classification: classificationOf(a) };
}
