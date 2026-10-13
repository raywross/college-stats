/**
 * Holds items a person compared with the document and found misread: each gets a `misread` failure saying what the
 * document shows, and joins the review queue. A re-judge (`npm run check-cds-records`) keeps the failure; a new read
 * of the item replaces it.
 *
 *   npm run hold-misread -- --unit 211291 --edition 2025-26 --codes C.802,C.803,C.804 --detail "…what the PDF shows…"
 *   npm run hold-misread -- --file holds.json     # [{ unit, edition, codes: [...], detail }, …]
 *
 * Only items with a value are held. Prints each item held.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { School } from "../lib/types";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { reviewItemsFor } from "../lib/cds-checks.ts";
import { enqueueItems } from "../lib/reported.ts";
import { readRecords, writeRecord } from "./lib/college-reported/records.mts";
import { readQueue, writeQueue } from "./lib/college-reported/files.mts";

interface Hold {
  unit: string;
  edition: string;
  codes: string[];
  detail: string;
}

const ROOT = join(import.meta.dirname, "..");
const RECORDS = join(ROOT, "data", "cds-records");
const QUEUE = join(ROOT, "data", "review-queue.json");
const today = new Date().toISOString().slice(0, 10);

const { values } = parseArgs({
  options: { unit: { type: "string" }, edition: { type: "string" }, codes: { type: "string" }, detail: { type: "string" }, file: { type: "string" } },
});
const holds: Hold[] = values.file
  ? (JSON.parse(readFileSync(values.file, "utf8")) as Hold[])
  : [{ unit: values.unit!, edition: values.edition!, codes: (values.codes ?? "").split(",").filter(Boolean), detail: values.detail! }];
for (const h of holds) if (!h.unit || !h.edition || !h.codes.length || !h.detail) throw new Error(`a hold needs unit, edition, codes, and detail: ${JSON.stringify(h)}`);

const names = new Map((JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[]).map((s) => [s.unit_id, s.name]));
const records = new Map(readRecords(RECORDS).map((r) => [r.unit_id, r]));
let queue = readQueue(QUEUE).items;

for (const h of holds) {
  const record = records.get(h.unit);
  const doc = record?.documents.find((d) => d.edition === h.edition);
  if (!record || !doc) throw new Error(`${h.unit}: no ${h.edition} document`);
  const held: string[] = [];
  for (const code of h.codes) {
    const it = doc.items[code];
    if (!it || it.v === undefined) continue;
    const failures = [...(it.failures ?? []).filter((f) => f.check !== "misread"), { check: "misread", detail: h.detail }];
    doc.items[code] = { ...it, status: "failed", failures };
    held.push(code);
  }
  writeRecord(RECORDS, record);
  const name = names.get(h.unit) ?? h.unit;
  const items = reviewItemsFor(doc, CDS_TEMPLATE, { unit_id: h.unit, name, run: "hold-misread", queued: today }).filter((i) => held.includes(i.code!));
  queue = enqueueItems(queue, items);
  console.log(`${name} (${h.unit}) ${h.edition}: held ${held.join(", ") || "nothing (no values)"}`);
}
writeQueue(QUEUE, { updated: today, items: queue });
