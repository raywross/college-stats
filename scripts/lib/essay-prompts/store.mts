/**
 * The essay prompts' committed files (specs/product/essays/prompts.md "Store"):
 * - data/essay-prompts/records/<unit_id>.json: one college's page as read and checked, with the model's quotes; the
 *   merge applies these to data/schools.json (./merge.mts).
 * - data/essay-prompts/held/<unit_id>.json: a read the checks held, with why; never merged, listed in the run's PR.
 * - data/essay-prompts/confirmed/<unit_id>.json: a college's prompts read from the application form by a person
 *   through the admin console (specs/product/essays/sources.md "The hand read"); the merge applies these when the
 *   reader has no `published` record for the college.
 * - data/essay-prompts/pages.json: where each college's essay page was found (so a later run fetches it, conditional
 *   on its sha, instead of discovering it again), and colleges where nothing was found.
 * - data/reference/platform-prompts.json: the Common App's and the Coalition's own prompts, kept by hand.
 * Key order is fixed and prompts are one per line, so a run's diff shows exactly which prompts changed.
 *
 * Since the data platform's phase 2 the reader writes none of these files: a run reads and writes the `essays.*`
 * layers through the data store (the end of this file). The files stay in the repository for the merge CLI, the
 * import and the tests until phase 4; `confirmed/` is no longer exported (the publisher reads essay_prompt_overrides).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConfirmedRecord } from "../../../lib/essay-prompts/confirmed.ts";
import type { EssayPrompt, PlatformPromptsFile, SchoolEssays } from "../../../lib/types.ts";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";

/** Bumped when the reader's prompt or schema changes, so a re-read is distinguishable from a page change. */
export const READER_VERSION = "2026.10.30.1";

/** How the page was found (./discover.mts). */
export type FoundVia = "known-link" | "well-known-path" | "apply-page-link" | "sitemap" | "picker" | "recipe";

/**
 * One college's prompts as a person read them in the application form (sources.md "The hand read"; the console's
 * /admin/essays/[unit] form writes it). Declared in lib/essay-prompts/confirmed.ts (pure, so the console loads it too)
 * and re-exported here, so the two can never differ.
 */
export type { ConfirmedRecord, FormKind } from "../../../lib/essay-prompts/confirmed.ts";

/** One college's essay page as read: the block the merge applies, plus how it was read and the quotes behind it. */
export interface EssayRecord extends SchoolEssays {
  unit_id: string;
  name: string;
  /** The URL after redirects, when it differs from `source_url`. */
  final_url?: string;
  /** sha256 of the page's bytes (the archive key). */
  sha256: string;
  /** Where the archive keeps the bytes ("local:<sha>.html" or "gh:<release>/<sha>.html"). */
  archive?: string;
  /** The page's own words the cycle was read from ("2026–2027 Supplemental Essays"); empty when the page names none. */
  cycle_quote: string;
  /** True when the page names no cycle and `cycle` is the one open on the day it was read (listed in the PR for a look). */
  cycle_assumed?: boolean;
  /** For `none` and `refers_to_form`: the sentence that says so. */
  status_quote?: string;
  via: FoundVia;
  model: string;
  reader: string;
  /** The previous cycle's prompts, kept when a new cycle's differ (so the card can say "new this cycle"). */
  previous?: Pick<SchoolEssays, "cycle" | "source_url" | "retrieved" | "prompts">;
}

export interface HeldRecord {
  unit_id: string;
  name: string;
  held: string;
  /** What the checks found (./checks.mts). */
  problems: string[];
  /** The read as it came back, for the review queue. */
  record: EssayRecord;
}

export interface PageRecipe {
  url: string | null;
  via: FoundVia | null;
  sha256?: string;
  etag?: string;
  last_modified?: string;
  checked: string;
  /** Candidates tried on the last discovery that found nothing (at most ten), for the owner. */
  tried?: string[];
  /** A host that refused us (robots.txt or a 401/403/429). */
  blocked?: string;
}

export interface PagesFile {
  updated: string | null;
  pages: Record<string, PageRecipe>;
}

export function essayPaths(root: string) {
  const dir = join(root, "data", "essay-prompts");
  return {
    dir,
    records: join(dir, "records"),
    held: join(dir, "held"),
    confirmed: join(dir, "confirmed"),
    pages: join(dir, "pages.json"),
    platform: join(root, "data", "reference", "platform-prompts.json"),
    cache: join(root, ".cache", "essay-prompts"),
  };
}

function write(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const RECORD_KEYS: (keyof EssayRecord)[] = [
  "unit_id", "name", "cycle", "status", "source_url", "final_url", "retrieved", "sha256", "archive", "cycle_quote", "cycle_assumed", "status_quote", "choose", "via", "model", "reader",
];
const PROMPT_KEYS: (keyof EssayPrompt)[] = ["id", "text", "kind", "limit", "required", "applies_to", "quote"];

const ordered = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const promptLines = (prompts: readonly EssayPrompt[], indent: string) =>
  prompts.length ? `[\n${prompts.map((p) => `${indent}  ${JSON.stringify(ordered(p, PROMPT_KEYS))}`).join(",\n")}\n${indent}]` : "[]";

/** A record as text: fixed key order, one prompt per line. */
export function serializeRecord(r: EssayRecord): string {
  const head = JSON.stringify(ordered(r, RECORD_KEYS));
  const prev = r.previous
    ? `,\n  "previous": ${JSON.stringify({ cycle: r.previous.cycle, source_url: r.previous.source_url, retrieved: r.previous.retrieved }).slice(0, -1)}, "prompts": ${promptLines(r.previous.prompts, "  ")} }`
    : "";
  return `${head.slice(0, -1)},\n  "prompts": ${promptLines(r.prompts, "")}${prev}\n}\n`;
}

export function serializeHeld(h: HeldRecord): string {
  return `{ "unit_id": ${JSON.stringify(h.unit_id)}, "name": ${JSON.stringify(h.name)}, "held": ${JSON.stringify(h.held)},\n  "problems": ${JSON.stringify(h.problems, null, 2).replace(/\n/g, "\n  ")},\n  "record": ${serializeRecord(h.record).trimEnd().replace(/\n/g, "\n  ")}\n}\n`;
}

function readDir<T extends { unit_id: string }>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()
    .map((f) => {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
      if (`${r.unit_id}.json` !== f) throw new Error(`${f}: file name doesn't match unit_id ${r.unit_id}`);
      return r;
    });
}

export const readEssayRecords = (dir: string) => readDir<EssayRecord>(dir);
export const readHeld = (dir: string) => readDir<HeldRecord>(dir);
/** The hand-read records (data/essay-prompts/confirmed/), by unit id; a file named for another college throws. */
export const readConfirmedRecords = (dir: string) => readDir<ConfirmedRecord>(dir);

export function readEssayRecord(dir: string, unitId: string): EssayRecord | null {
  const f = join(dir, `${unitId}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as EssayRecord) : null;
}

export function writeEssayRecord(dir: string, r: EssayRecord): void {
  write(join(dir, `${r.unit_id}.json`), serializeRecord(r));
}

export function writeHeld(dir: string, h: HeldRecord): void {
  write(join(dir, `${h.unit_id}.json`), serializeHeld(h));
}

/** A college that now passes leaves the held folder. */
export function clearHeld(dir: string, unitId: string): void {
  rmSync(join(dir, `${unitId}.json`), { force: true });
}

export function readPages(file: string): PagesFile {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PagesFile) : { updated: null, pages: {} };
}

/** One college per line, by unit id. */
export function writePages(file: string, f: PagesFile): void {
  const ids = Object.keys(f.pages).sort();
  const body = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(f.pages[id])}`).join(",\n");
  write(file, `{\n  "updated": ${JSON.stringify(f.updated)},\n  "pages": {${ids.length ? `\n${body}\n  ` : ""}}\n}\n`);
}

export function readPlatformPrompts(file: string): PlatformPromptsFile | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PlatformPromptsFile) : null;
}

/* ------------------------------------------------------------------ */
/* The data store (specs/data-platform/pipelines.md)                   */
/* ------------------------------------------------------------------ */

/**
 * The reader's state as layers: `essays.records` and `essays.held` by unit id (each document the file's parsed text,
 * so its key order is the file's, as scripts/import-data-from-git.mts imports it), `essays.pages` by unit id (a
 * `PageRecipe`), `essays.runs` by the run stamp (the `RunSummary`). The files above stay for the merge CLI and the
 * import; a run reads and writes only these.
 */
export const ESSAY_COLLECTIONS = { records: "essays.records", held: "essays.held", pages: "essays.pages", runs: "essays.runs" } as const;

/** A record as its document: `serializeRecord`'s key order. */
export const recordDocument = (r: EssayRecord): EssayRecord => JSON.parse(serializeRecord(r)) as EssayRecord;
export const heldDocument = (h: HeldRecord): HeldRecord => JSON.parse(serializeHeld(h)) as HeldRecord;

export interface EssayState {
  records: Map<string, EssayRecord>;
  held: Map<string, HeldRecord>;
  pages: Map<string, PageRecipe>;
}

/** The reader's prior state from the store. */
export async function loadEssayState(store: Pick<DataStore, "read">): Promise<EssayState> {
  return {
    records: await store.read<EssayRecord>(ESSAY_COLLECTIONS.records),
    held: await store.read<HeldRecord>(ESSAY_COLLECTIONS.held),
    pages: await store.read<PageRecipe>(ESSAY_COLLECTIONS.pages),
  };
}

/** What one run changes: passing records, held reads, colleges that left the held list, page recipes seen, the summary. */
export interface EssayRunWrites {
  records: EssayRecord[];
  held: HeldRecord[];
  cleared: string[];
  pages: ReadonlyMap<string, PageRecipe>;
  summary: { run: string };
}

/** Writes a run's documents into its change set (unchanged ones write nothing). */
export async function writeEssayRun(handle: ChangeSetHandle, before: EssayState, w: EssayRunWrites): Promise<void> {
  if (w.records.length) await handle.write(ESSAY_COLLECTIONS.records, w.records.map((r) => ({ key: r.unit_id, body: recordDocument(r) })));
  if (w.held.length) await handle.write(ESSAY_COLLECTIONS.held, w.held.map((h) => ({ key: h.unit_id, body: heldDocument(h) })));
  const cleared = w.cleared.filter((id) => before.held.has(id));
  if (cleared.length) await handle.remove(ESSAY_COLLECTIONS.held, cleared);
  const pages = [...w.pages].filter(([id, p]) => JSON.stringify(before.pages.get(id)) !== JSON.stringify(p));
  if (pages.length) await handle.write(ESSAY_COLLECTIONS.pages, pages.map(([key, body]) => ({ key, body })));
  await handle.write(ESSAY_COLLECTIONS.runs, [{ key: w.summary.run, body: w.summary }]);
}

/**
 * The run's own breaker (pipelines.md "essay-prompts"): the change set closes `held` when more than half of the
 * colleges read this run were held. "Read" means a read reached the checks (passed or held); unchanged pages, misses
 * and failures don't count. Null when the run is fine.
 */
export function essaysBreaker(counts: { passed: number; held: number }): string | null {
  const read = counts.passed + counts.held;
  if (!read || counts.held * 2 <= read) return null;
  return `${counts.held} of the ${read} colleges read this run were held (more than half): look at the held records before publishing`;
}
