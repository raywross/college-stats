/**
 * Drops a CDS document a college shouldn't keep: a duplicate, a worse read of an edition already on file, or a file
 * that isn't the college's CDS at all. Refiling moves a document to another edition; dropping removes it.
 *
 *   npm run drop-document -- --store supabase --unit 110714 --sha f38e8289ef --why "a Drive copy of the 2024-25 CDS already on file" --dry-run
 *
 * One change set (kind pipeline, source drop-document) writes:
 * - `reported.cds_records`: the document out of the college's record. Refused when it is the record's only document
 *   (the record would go; `--force` removes the record) or when the record has no such document.
 * - `reported.docs`: the manifest entry removed, not marked. The pipeline reads every manifest entry as a document to
 *   read (scripts/lib/college-reported/phases.mts `pendingDocs` queues the model's calls for an entry with no record,
 *   and `readKnown` re-reads one by its URL), and the records gate only checks that each record's document is in the
 *   manifest, so a marked entry would be read again, and nothing reads manifest history. The bytes stay in the archive.
 * - `reported.review_queue`: every item of the college whose `sha256` is the document's, removed.
 * - `reported.sources`: the recipe's sources read from the document (its URL, final URL, or sha256) removed and listed
 *   in `Recipe.dropped` with the date and why, so discovery and index re-scans never add the URL back
 *   (lib/reported.ts `withoutDropped`). When no source lists it, the manifest URL is still listed as dropped.
 * Then run `npm run check-cds-records -- --store …` and publish.
 *
 * `dropDocument` is the library form: with `handle` the writes go into the caller's change set (left open for it), as
 * refile-document's do for the Steward's apply job.
 */
import { parseArgs } from "node:util";
import type { CollegeRecord, ManifestEntry } from "../lib/cds-sections.ts";
import type { Recipe, RecipeDrop, ReviewItem } from "../lib/reported.ts";
import { recordBody } from "./lib/college-reported/records.mts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { storeFromFlag, type ChangeSetHandle, type DataStore } from "./lib/data-platform/store.mts";

const SOURCE = "drop-document";

export interface Drop {
  unit: string;
  /** The document's sha256, or a prefix of it. */
  sha: string;
  why: string;
}

export interface DropResult {
  unit: string;
  sha256: string;
  edition: string;
  queueRemoved: number;
  recipeSourceDropped: boolean;
  manifestRemoved: boolean;
}

export interface DropOptions {
  handle?: ChangeSetHandle;
  dry?: boolean;
  /** Drop the record's only document (the record is removed). */
  force?: boolean;
  log?: (line: string) => void;
  /** ISO date for `Recipe.dropped[].on` (default today). */
  today?: string;
}

/**
 * Drops one document on the store. With `handle` the writes go into that change set (left open for its owner);
 * without one the function opens and closes its own (source drop-document). `dry` writes nothing.
 */
export async function dropDocument(store: DataStore, d: Drop, opts: DropOptions = {}): Promise<DropResult> {
  const log = opts.log ?? (() => {});
  if (!d.unit || !d.sha || !d.why?.trim()) throw new Error("a drop needs unit, sha (a prefix is enough) and why");
  const record = await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, d.unit);
  const matches = record?.documents.filter((doc) => doc.sha256.startsWith(d.sha)) ?? [];
  if (!record || !matches.length) throw new Error(`${d.unit}: no document ${d.sha}`);
  if (matches.length > 1) throw new Error(`${d.unit}: ${d.sha} names ${matches.length} documents; give more of the sha256`);
  const doc = matches[0];
  const rest = record.documents.filter((x) => x !== doc);
  if (!rest.length && !opts.force) throw new Error(`${d.unit}: ${doc.sha256.slice(0, 10)} is the record's only document; --force drops it and the record`);

  const entry = await store.readOne<ManifestEntry>(COLLECTIONS.reported.docs, doc.sha256);
  const queue = await store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue, `${d.unit}|`);
  const queueKeys = [...queue].filter(([, q]) => q.sha256 === doc.sha256).map(([k]) => k);

  const recipe = await store.readOne<Recipe>(COLLECTIONS.reported.sources, d.unit);
  const urls = new Set([entry?.url, entry?.final_url].filter((u): u is string => !!u));
  const fromDoc = (s: { url: string; sha256?: string }) => urls.has(s.url) || s.sha256 === doc.sha256;
  const removedSources = recipe?.sources.filter(fromDoc) ?? [];
  const on = opts.today ?? new Date().toISOString().slice(0, 10);
  const why = d.why.trim();
  const dropUrls = removedSources.length ? removedSources.map((s) => s.url) : [...urls];
  const drops: RecipeDrop[] = dropUrls.filter((u) => !recipe?.dropped?.some((x) => x.url === u)).map((url) => ({ url, sha256: doc.sha256, on, why }));
  const nextRecipe: Recipe | null = recipe && (removedSources.length || drops.length) ? { ...recipe, sources: recipe.sources.filter((s) => !fromDoc(s)), dropped: [...(recipe.dropped ?? []), ...drops] } : null;

  const result: DropResult = { unit: d.unit, sha256: doc.sha256, edition: doc.edition, queueRemoved: queueKeys.length, recipeSourceDropped: removedSources.length > 0, manifestRemoved: !!entry };
  log(
    `${d.unit} ${doc.sha256.slice(0, 10)} (${doc.edition}): dropped (${why}); ${rest.length ? `${rest.length} document(s) left` : "the record removed"}, ` +
      `${queueKeys.length} queue item(s) removed, manifest entry ${entry ? "removed" : "not found"}, ` +
      `recipe ${removedSources.length ? `source${removedSources.length > 1 ? "s" : ""} ${removedSources.map((s) => s.url).join(", ")} dropped` : drops.length && nextRecipe ? "lists the URL as dropped" : "unchanged"}`,
  );
  if (opts.dry) return result;

  const handle = opts.handle ?? (await store.open("pipeline", SOURCE, `${SOURCE}-${new Date().toISOString()}`, { note: `${d.unit} ${doc.sha256.slice(0, 10)}: ${why}` }));
  if (rest.length) await handle.write(COLLECTIONS.reported.cdsRecords, [{ key: d.unit, body: recordBody({ ...record, documents: rest }) }]);
  else await handle.remove(COLLECTIONS.reported.cdsRecords, [d.unit]);
  if (entry) await handle.remove(COLLECTIONS.reported.docs, [doc.sha256]);
  if (queueKeys.length) await handle.remove(COLLECTIONS.reported.reviewQueue, queueKeys);
  if (nextRecipe) await handle.write(COLLECTIONS.reported.sources, [{ key: d.unit, body: nextRecipe }]);
  if (!opts.handle) {
    await handle.close("applied");
    log(`Change set ${handle.id}: applied`);
  }
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { store: { type: "string" }, unit: { type: "string" }, sha: { type: "string" }, why: { type: "string" }, "dry-run": { type: "boolean", default: false }, force: { type: "boolean", default: false } } });
  if (!values.unit || !values.sha || !values.why) throw new Error("--unit, --sha (a prefix is enough) and --why are required");
  const store = storeFromFlag(values.store);
  await dropDocument(store, { unit: values.unit, sha: values.sha, why: values.why }, { dry: values["dry-run"], force: values.force, log: console.log });
  if (values["dry-run"]) console.log("Dry run; nothing written.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
