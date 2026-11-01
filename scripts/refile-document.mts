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
 */
import { parseArgs } from "node:util";
import { parseEdition, yearsForEdition, type CollegeRecord, type ManifestEntry } from "../lib/cds-sections.ts";
import { reviewKey, type ReviewItem } from "../lib/reported.ts";
import { recordBody } from "./lib/college-reported/state.mts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { storeFromFlag } from "./lib/data-platform/store.mts";

const SOURCE = "refile-document";
const { values } = parseArgs({ options: { store: { type: "string" }, unit: { type: "string" }, sha: { type: "string" }, edition: { type: "string" }, why: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
if (!values.unit || !values.sha || !values.why) throw new Error("--unit, --sha (a prefix is enough) and --why are required");

const store = storeFromFlag(values.store);
const record = await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, values.unit);
const doc = record?.documents.find((d) => d.sha256.startsWith(values.sha!));
if (!record || !doc) throw new Error(`${values.unit}: no document ${values.sha}`);
const from = doc.edition;
const to = values.edition ? parseEdition(values.edition)?.key : from;
if (!to) throw new Error(`not an edition: ${values.edition}`);
if (to !== from && record.documents.some((d) => d !== doc && d.edition === to)) throw new Error(`${values.unit} already has a ${to} document`);

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
const queue = await store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue, `${values.unit}|`);
const moves: { from: string; item: ReviewItem }[] = [];
for (const [key, q] of queue) if (q.sha256 === doc.sha256 && q.edition !== to) moves.push({ from: key, item: { ...q, edition: to } });

console.log(`${values.unit} ${doc.sha256.slice(0, 10)}: ${from === to ? `confirmed as ${to}` : `${from} → ${to}`} (${values.why}); ${moves.length} queue entries moved`);
if (values["dry-run"]) {
  console.log("Dry run; nothing written.");
} else {
  const handle = await store.open("pipeline", SOURCE, `${SOURCE}-${new Date().toISOString()}`, { note: `${values.unit} ${doc.sha256.slice(0, 10)}: ${values.why}` });
  await handle.write(COLLECTIONS.reported.cdsRecords, [{ key: values.unit, body: recordBody(record) }]);
  if (entry) await handle.write(COLLECTIONS.reported.docs, [{ key: entry.sha256, body: entry }]);
  const stale = moves.map((m) => m.from).filter((k) => !moves.some((m) => reviewKey(m.item) === k));
  if (stale.length) await handle.remove(COLLECTIONS.reported.reviewQueue, stale);
  if (moves.length) await handle.write(COLLECTIONS.reported.reviewQueue, moves.map((m) => ({ key: reviewKey(m.item), body: m.item })));
  await handle.close("applied");
  console.log(`Change set ${handle.id}: applied`);
}
