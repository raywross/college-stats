/**
 * Files a CDS document under the edition a person found it to be, or confirms the edition it's filed under, when the
 * pipeline couldn't tell (a cover with no year, a cover whose year doesn't extract) or guessed wrong.
 *
 *   npm run refile-document -- --store supabase --unit 145646 --sha 1d92a85b --edition 2020-21 --why "cover and C1 say 2020-21"
 *   npm run refile-document -- --store supabase --unit 110662 --sha b7137295 --why "G0 asks for 2026-2027 costs: the 2025-26 form"
 *
 * Without --edition the filed edition is confirmed. Either way: the record's edition and year labels (the aid year
 * still from H.101), the docs manifest's edition with `edition_from: "manual"`, the assumed-edition and cover holds
 * dropped, and the queue's entries moved to the edition, written through the data store in one change set (kind
 * pipeline, source refile-document): `reported.cds_records`, `reported.docs`, `reported.review_queue`. Then run
 * `npm run check-cds-records -- --store …` and publish.
 *
 * `refileDocument` is the library form: the Data Steward's apply job (scripts/lib/steward/apply.mts) passes its own
 * change set as `handle`, so a proposal's refiles land in one set with source `steward-apply`.
 */
import { parseArgs } from "node:util";
import { parseEdition, yearsForEdition, type CollegeRecord, type ManifestEntry } from "../lib/cds-sections.ts";
import { reviewKey, type ReviewItem } from "../lib/reported.ts";
import { recordBody } from "./lib/college-reported/state.mts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { storeFromFlag, type ChangeSetHandle, type DataStore } from "./lib/data-platform/store.mts";

const SOURCE = "refile-document";

export interface Refile {
  unit: string;
  /** The document's sha256, or a prefix of it. */
  sha: string;
  /** The edition to file it under; absent confirms the filed one. */
  edition?: string | null;
  why: string;
}

export interface RefileResult {
  unit: string;
  sha256: string;
  from: string;
  to: string;
  moved: number;
}

/**
 * Refiles one document on the store. With `handle` the writes go into that change set (left open for its owner);
 * without one the function opens and closes its own (source refile-document). `dry` writes nothing.
 */
export async function refileDocument(store: DataStore, r: Refile, opts: { handle?: ChangeSetHandle; dry?: boolean; log?: (line: string) => void } = {}): Promise<RefileResult> {
  const log = opts.log ?? (() => {});
  if (!r.unit || !r.sha || !r.why) throw new Error("a refile needs unit, sha (a prefix is enough) and why");
  const record = await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, r.unit);
  const doc = record?.documents.find((d) => d.sha256.startsWith(r.sha));
  if (!record || !doc) throw new Error(`${r.unit}: no document ${r.sha}`);
  const from = doc.edition;
  const to = r.edition ? parseEdition(r.edition)?.key : from;
  if (!to) throw new Error(`not an edition: ${r.edition}`);
  if (to !== from && record.documents.some((d) => d !== doc && d.edition === to)) throw new Error(`${r.unit} already has a ${to} document`);

  const h101 = doc.items["H.101"]?.v;
  doc.edition = to;
  doc.years = yearsForEdition(to, { aidYear: typeof h101 === "string" ? h101 : null });
  const settled = (detail: string) => detail.startsWith("the document states no edition") || detail.startsWith("the cover says");
  for (const [code, it] of Object.entries(doc.items)) {
    if (!it.failures?.some((f) => f.check === "edition-mismatch" && settled(f.detail))) continue;
    const failures = it.failures.filter((f) => !(f.check === "edition-mismatch" && settled(f.detail)));
    doc.items[code] = { ...it, ...(failures.length ? { failures } : { failures: undefined }) };
    if (!failures.length) delete doc.items[code].failures;
  }

  const entry = await store.readOne<ManifestEntry>(COLLECTIONS.reported.docs, doc.sha256);
  if (entry) {
    entry.edition = to;
    entry.edition_from = "manual";
  }

  // The college's queue items (keyed `<unit>|…`): an item moved to the edition gets the key reviewKey gives it now.
  const queue = await store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue, `${r.unit}|`);
  const moves: { from: string; item: ReviewItem }[] = [];
  for (const [key, q] of queue) if (q.sha256 === doc.sha256 && q.edition !== to) moves.push({ from: key, item: { ...q, edition: to } });

  log(`${r.unit} ${doc.sha256.slice(0, 10)}: ${from === to ? `confirmed as ${to}` : `${from} → ${to}`} (${r.why}); ${moves.length} queue entries moved`);
  const result: RefileResult = { unit: r.unit, sha256: doc.sha256, from, to, moved: moves.length };
  if (opts.dry) return result;
  const handle = opts.handle ?? (await store.open("pipeline", SOURCE, `${SOURCE}-${new Date().toISOString()}`, { note: `${r.unit} ${doc.sha256.slice(0, 10)}: ${r.why}` }));
  await handle.write(COLLECTIONS.reported.cdsRecords, [{ key: r.unit, body: recordBody(record) }]);
  if (entry) await handle.write(COLLECTIONS.reported.docs, [{ key: entry.sha256, body: entry }]);
  const stale = moves.map((m) => m.from).filter((k) => !moves.some((m) => reviewKey(m.item) === k));
  if (stale.length) await handle.remove(COLLECTIONS.reported.reviewQueue, stale);
  if (moves.length) await handle.write(COLLECTIONS.reported.reviewQueue, moves.map((m) => ({ key: reviewKey(m.item), body: m.item })));
  if (!opts.handle) {
    await handle.close("applied");
    log(`Change set ${handle.id}: applied`);
  }
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { store: { type: "string" }, unit: { type: "string" }, sha: { type: "string" }, edition: { type: "string" }, why: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  if (!values.unit || !values.sha || !values.why) throw new Error("--unit, --sha (a prefix is enough) and --why are required");
  const store = storeFromFlag(values.store);
  await refileDocument(store, { unit: values.unit, sha: values.sha, edition: values.edition ?? null, why: values.why }, { dry: values["dry-run"], log: console.log });
  if (values["dry-run"]) console.log("Dry run; nothing written.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
