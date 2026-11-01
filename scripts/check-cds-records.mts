/**
 * Re-judges the stored CDS records (`reported.cds_records`) with every round-3 check (lib/cds-checks.ts;
 * specs/college-reported-round-3.md Decision 9), with no fetch and no model call: the checks read only the records,
 * the template, and each college's federal baseline (`restoreFederal` over the bundled copy's colleges, so a college
 * is never compared with its own CDS value).
 *
 *   npm run check-cds-records -- --store supabase [--unit <unit_id>] [--dry-run]
 *
 * Writes each changed record back (same key order as the readers write) through the data store in one change set
 * (kind pipeline, source check-cds-records) and prints, per college, the items whose status changed and why. The
 * review queue (`reported.review_queue`) follows the new verdicts: an item that now passes leaves it, one still
 * failing gets its current failures (keeping when and by which run it was first queued), and one that newly fails
 * joins it. Re-running is a no-op: `applyChecks` is idempotent.
 */
import { parseArgs } from "node:util";
import type { CollegeRecord } from "../lib/cds-sections.ts";
import { reviewKey, type ReviewItem } from "../lib/reported.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { applyChecks, queueAfterRejudge } from "../lib/cds-checks.ts";
import { restoreFederal } from "../lib/newest.ts";
import { serializeRecord } from "./lib/college-reported/records.mts";
import { federalGradYear } from "./lib/college-reported/files.mts";
import { readMeta, recordBody } from "./lib/college-reported/state.mts";
import { COLLECTIONS, readLayer } from "./lib/data-platform/layers.mts";
import { storeFromFlag } from "./lib/data-platform/store.mts";
import { writeChanged } from "./lib/data-platform/producer.mts";
import { readBundledColleges } from "./lib/data-platform/bundled.mts";

const SOURCE = "check-cds-records";
const today = new Date().toISOString().slice(0, 10);
const { values } = parseArgs({ options: { store: { type: "string" }, unit: { type: "string" }, "dry-run": { type: "boolean", default: false } } });

const store = storeFromFlag(values.store);
const queueBefore = await readLayer<ReviewItem>(store, COLLECTIONS.reported.reviewQueue);
let queue = [...queueBefore.values()];
const schools = new Map(readBundledColleges().map((s) => [s.unit_id, s]));
const gradYear = federalGradYear(await readMeta(store));
const records = values.unit ? new Map([[values.unit, await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, values.unit)]]) : await readLayer<CollegeRecord>(store, COLLECTIONS.reported.cdsRecords);

const changedRecords: CollegeRecord[] = [];
for (const record of records.values()) {
  if (!record) continue;
  const school = schools.get(record.unit_id);
  const federal = school ? restoreFederal(school) : null;
  const before = serializeRecord(record);
  const documents = record.documents.map((doc) => applyChecks(doc, { table: CDS_TEMPLATE, school: federal, gradYear, others: record.documents }));
  const next = { ...record, documents };
  const name = school?.name ?? record.unit_id;
  for (let i = 0; i < documents.length; i++) {
    const was = record.documents[i].items;
    const now = documents[i].items;
    const counts: Record<string, number> = {};
    for (const it of Object.values(now)) counts[it.status] = (counts[it.status] ?? 0) + 1;
    console.log(`${name} (${record.unit_id}) ${documents[i].edition}: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`);
    for (const [code, it] of Object.entries(now)) {
      const old = was[code];
      const changed = old?.status !== it.status || old?.v !== it.v || JSON.stringify(old?.failures ?? []) !== JSON.stringify(it.failures ?? []);
      if (!changed) continue;
      const why = it.failures?.map((f) => `${f.check}: ${f.detail}`).join("; ") ?? (it.method === "derived" ? "summed from its parts" : it.code_table ? `visible form ${String(it.v)} published (code table said ${String(it.code_table.v)})` : "");
      console.log(`  ${code} ${old?.status ?? "missing"} → ${it.status}${why ? `: ${why}` : ""}`);
    }
    queue = queueAfterRejudge(queue, record.documents[i], documents[i], CDS_TEMPLATE, { unit_id: record.unit_id, name, run: SOURCE, queued: today });
  }
  if (serializeRecord(next) !== before) changedRecords.push(next);
}

if (values["dry-run"]) {
  console.log(`Dry run: ${changedRecords.length} record(s) would change; nothing written.`);
} else {
  const handle = await store.open("pipeline", SOURCE, `${SOURCE}-${new Date().toISOString()}`);
  if (changedRecords.length) await handle.write(COLLECTIONS.reported.cdsRecords, changedRecords.map((r) => ({ key: r.unit_id, body: recordBody(r) })));
  const q = await writeChanged(handle, COLLECTIONS.reported.reviewQueue, queueBefore, new Map(queue.map((i) => [reviewKey(i), i as unknown])), { mirror: true });
  await handle.close("applied");
  console.log(`Change set ${handle.id}: ${changedRecords.length} record(s), ${q.sent} queue item(s) written, ${q.removed} removed`);
}
