/**
 * Files a CDS document under the edition a person found it to be, or confirms the edition it's filed under, when the
 * pipeline couldn't tell (a cover with no year, a cover whose year doesn't extract) or guessed wrong.
 *
 *   npm run refile-document -- --unit 145646 --sha 1d92a85b --edition 2020-21 --why "cover and C1 say 2020-21"
 *   npm run refile-document -- --unit 110662 --sha b7137295 --why "G0 asks for 2026-2027 costs: the 2025-26 form"
 *
 * Without --edition the filed edition is confirmed. Either way: the record's edition and year labels (the aid year
 * still from H.101), the manifest's edition with `edition_from: "manual"`, the assumed-edition and cover holds dropped,
 * and the queue's entries moved to the edition. Then run `npm run check-cds-records` and the rebuilds.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseEdition, yearsForEdition } from "../lib/cds-sections.ts";
import { readManifest, readRecords, writeManifest, writeRecord } from "./lib/college-reported/records.mts";
import { readQueue, writeQueue } from "./lib/college-reported/files.mts";

const ROOT = join(import.meta.dirname, "..");
const RECORDS = join(ROOT, "data", "cds-records");
const today = new Date().toISOString().slice(0, 10);
const { values } = parseArgs({ options: { unit: { type: "string" }, sha: { type: "string" }, edition: { type: "string" }, why: { type: "string" } } });
if (!values.unit || !values.sha || !values.why) throw new Error("--unit, --sha (a prefix is enough) and --why are required");

const record = readRecords(RECORDS).find((r) => r.unit_id === values.unit);
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
writeRecord(RECORDS, record);

const manifestFile = join(ROOT, "data", "college-docs.json");
const manifest = readManifest(manifestFile);
const entry = manifest.documents.find((d) => d.sha256 === doc.sha256);
if (entry) {
  entry.edition = to;
  entry.edition_from = "manual";
  writeManifest(manifestFile, { ...manifest, updated: today });
}

const queueFile = join(ROOT, "data", "review-queue.json");
const queue = readQueue(queueFile);
let moved = 0;
for (const q of queue.items) if (q.unit_id === values.unit && q.sha256 === doc.sha256 && q.edition !== to) (q.edition = to), moved++;
if (moved) writeQueue(queueFile, { updated: today, items: queue.items });

console.log(`${values.unit} ${doc.sha256.slice(0, 10)}: ${from === to ? `confirmed as ${to}` : `${from} → ${to}`} (${values.why}); ${moved} queue entries moved`);
