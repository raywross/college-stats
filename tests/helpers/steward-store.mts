/**
 * A file store seeded for the Data Steward's tests (tests/steward-run.test.mts): the three fixture files of
 * tests/fixtures/steward/ (review queue, failures, docs manifest) and the mini fixture's CDS records, in one import
 * change set; and a local archive holding the authored line text of one fixture document (the University of Alabama's
 * 2025-26 CDS, `uaSha()`), whose lines 97–99 are the ones the queue's details quote. No network, no database.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore, type DataStore } from "../../scripts/lib/data-platform/store.mts";
import { COLLECTIONS } from "../../scripts/lib/data-platform/layers.mts";
import { LocalArchive } from "../../scripts/lib/college-reported/archive.mts";

const ROOT = join(import.meta.dirname, "..", "..");
export const STEWARD_FIXTURES = join(ROOT, "tests", "fixtures", "steward");
export const ANSWERS = join(STEWARD_FIXTURES, "answers");
const MINI_RECORDS = join(ROOT, "tests", "fixtures", "snapshot-mini", "layers", "reported.cds_records");

const readJson = <T,>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;

/** The University of Alabama's 2025-26 CDS in the docs sample. */
export const UA_UNIT = "100751";
export function uaSha(): string {
  const docs = readJson<Record<string, { unit_id: string; edition: string }>>(join(STEWARD_FIXTURES, "docs-sample.json"));
  const sha = Object.entries(docs).find(([, d]) => d.unit_id === UA_UNIT && d.edition === "2025-26")?.[0];
  if (!sha) throw new Error("the docs sample has no 100751 2025-26 document");
  return sha;
}

/** Authored lines for the UA document: filler, with lines 97–99 as the queue's details quote them (B1 totals). */
export function uaLines(): { lines: string[]; pages: number[] } {
  const lines: string[] = [];
  const pages: number[] = [];
  for (let id = 1; id <= 120; id++) {
    let text = `@94 B1 line ${id}`;
    if (id === 96) text = "@94 B1 Institutional enrollment: men and women | @221 Full-time men | @267 Full-time women | @512 Total";
    if (id === 97) text = "@94 Total graduate | @221 1,699 | @267 2,381 | @327 0 | @370 802 | @414 1,856 | @478 0 | @512 6,738";
    if (id === 98) text = "@94 Total all students | @217 15,518 | @263 20,278 | @327 0 | @364 2,376 | @414 4,187 | @478 0 | @508 42,359";
    if (id === 99) text = "@94 Total all undergraduates | @261 35,621";
    lines.push(text);
    pages.push(id <= 60 ? 3 : 4);
  }
  return { lines, pages };
}

export interface SeededStore {
  dir: string;
  store: DataStore;
  archive: LocalArchive;
}

/** A fresh file store and archive in a temporary folder. */
export async function seededStore(opts: { withLines?: boolean } = {}): Promise<SeededStore> {
  const dir = mkdtempSync(join(tmpdir(), "steward-"));
  const store = fileStore(join(dir, "layers"));
  const set = await store.open("import", "test-seed", "seed");
  const queue = readJson<Record<string, unknown>>(join(STEWARD_FIXTURES, "review-queue-sample.json"));
  await set.write(COLLECTIONS.reported.reviewQueue, Object.entries(queue).map(([key, body]) => ({ key, body })));
  const failures = readJson<Record<string, unknown>>(join(STEWARD_FIXTURES, "failures-sample.json"));
  await set.write(COLLECTIONS.reported.failures, Object.entries(failures).map(([key, body]) => ({ key, body })));
  const docs = readJson<Record<string, unknown>>(join(STEWARD_FIXTURES, "docs-sample.json"));
  await set.write(COLLECTIONS.reported.docs, Object.entries(docs).map(([key, body]) => ({ key, body })));
  const records = readdirSync(MINI_RECORDS).filter((f) => f.endsWith(".json"));
  await set.write(COLLECTIONS.reported.cdsRecords, records.map((f) => ({ key: f.slice(0, -5), body: readJson<{ body: unknown }>(join(MINI_RECORDS, f)).body })));
  await set.close("applied");
  const archive = new LocalArchive(join(dir, "archive"));
  if (opts.withLines !== false) await archive.putLines(uaSha(), { ...uaLines(), split: null, edition: null });
  return { dir, store, archive };
}

/** A fetch for documents that must never be called (the archive has every document a test reads). */
export const noFetch = async (url: string): Promise<{ error: string }> => ({ error: `no network in tests (${url})` });

/** The clock every dry run uses (a Sunday). */
export const NOW = () => new Date("2026-11-01T12:00:00Z");
