/**
 * Holds items a person compared with the document and found misread: each gets a `misread` failure saying what the
 * document shows, and joins the review queue. A re-judge (`npm run check-cds-records`) keeps the failure; a new read
 * of the item replaces it.
 *
 *   npm run hold-misread -- --store supabase --unit 211291 --edition 2025-26 --codes C.802,C.803,C.804 --detail "…what the PDF shows…"
 *   npm run hold-misread -- --store supabase --file holds.json     # [{ unit, edition, codes: [...], detail }, …]
 *   npm run hold-misread -- --store file:/tmp/layers --file holds.json --dry-run
 *
 * Writes the CDS records (`reported.cds_records`) and the review items (`reported.review_queue`, keyed by
 * `reviewKey`) through the data store in one change set (kind pipeline, source hold-misread). Only items with a value
 * are held. Prints each item held.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { CollegeRecord } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { reviewItemsFor } from "../lib/cds-checks.ts";
import { enqueueItems, reviewKey, type ReviewItem } from "../lib/reported.ts";
import { readColleges, recordBody } from "./lib/college-reported/state.mts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { storeFromFlag, type ChangeSetHandle, type DataStore } from "./lib/data-platform/store.mts";

export interface Hold {
  unit: string;
  edition: string;
  codes: string[];
  detail: string;
}

/** The change set's `source`. */
export const HOLD_SOURCE = "hold-misread";

/**
 * Applies the holds on the store: per college, the record with the held items failed `misread` and the queue items
 * for that college (read by key prefix `<unit>|`) with the new ones enqueued; returns what was held per college. With
 * `handle` the writes go into that change set and it is left open for its owner (the Data Steward's apply job, source
 * `steward-apply`); without one the function opens and closes its own.
 */
export async function holdMisread(store: DataStore, holds: readonly Hold[], opts: { today: string; names: ReadonlyMap<string, string>; dry?: boolean; log?: (line: string) => void; handle?: ChangeSetHandle }): Promise<{ unit: string; held: string[] }[]> {
  const log = opts.log ?? (() => {});
  for (const h of holds) if (!h.unit || !h.edition || !h.codes.length || !h.detail) throw new Error(`a hold needs unit, edition, codes, and detail: ${JSON.stringify(h)}`);
  const records = new Map<string, CollegeRecord>();
  const queues = new Map<string, Map<string, ReviewItem>>();
  const out: { unit: string; held: string[] }[] = [];
  for (const h of holds) {
    const record = records.get(h.unit) ?? (await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, h.unit));
    const doc = record?.documents.find((d) => d.edition === h.edition);
    if (!record || !doc) throw new Error(`${h.unit}: no ${h.edition} document`);
    records.set(h.unit, record);
    const held: string[] = [];
    for (const code of h.codes) {
      const it = doc.items[code];
      if (!it || it.v === undefined) continue;
      const failures = [...(it.failures ?? []).filter((f) => f.check !== "misread"), { check: "misread", detail: h.detail }];
      doc.items[code] = { ...it, status: "failed", failures } as typeof it;
      held.push(code);
    }
    const name = opts.names.get(h.unit) ?? h.unit;
    const items = reviewItemsFor(doc, CDS_TEMPLATE, { unit_id: h.unit, name, run: HOLD_SOURCE, queued: opts.today }).filter((i) => held.includes(i.code!));
    const queue = queues.get(h.unit) ?? (await store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue, `${h.unit}|`));
    queues.set(h.unit, new Map(enqueueItems([...queue.values()], items).map((i) => [reviewKey(i), i])));
    out.push({ unit: h.unit, held });
    log(`${name} (${h.unit}) ${h.edition}: held ${held.join(", ") || "nothing (no values)"}`);
  }
  if (opts.dry) return out;
  const handle = opts.handle ?? (await store.open("pipeline", HOLD_SOURCE, `hold-misread-${new Date().toISOString()}`));
  await handle.write(COLLECTIONS.reported.cdsRecords, [...records].map(([key, rec]) => ({ key, body: recordBody(rec) })));
  // Unchanged items write nothing (the store compares bodies); an item enqueueItems replaced keeps its key.
  await handle.write(COLLECTIONS.reported.reviewQueue, [...queues.values()].flatMap((q) => [...q].map(([key, body]) => ({ key, body }))));
  if (opts.handle) return out;
  await handle.close("applied", undefined, { note: `held ${out.reduce((n, o) => n + o.held.length, 0)} misread item(s)`, colleges: out.map((o) => o.unit) });
  log(`Wrote change set ${handle.id}.`);
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      unit: { type: "string" },
      edition: { type: "string" },
      codes: { type: "string" },
      detail: { type: "string" },
      file: { type: "string" },
      store: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const holds: Hold[] = values.file
    ? (JSON.parse(readFileSync(values.file, "utf8")) as Hold[])
    : [{ unit: values.unit!, edition: values.edition!, codes: (values.codes ?? "").split(",").filter(Boolean), detail: values.detail! }];
  const store = storeFromFlag(values.store);
  const names = new Map(readColleges(join(import.meta.dirname, "..")).map((s) => [s.unit_id, s.name]));
  await holdMisread(store, holds, { today: new Date().toISOString().slice(0, 10), names, dry: values["dry-run"], log: console.log });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
