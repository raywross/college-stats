/**
 * Re-judges the committed CDS records with every round-3 check (lib/cds-checks.ts; specs/college-reported-round-3.md
 * Decision 9), with no fetch and no model call: the checks read only the records, the template, and each college's
 * federal baseline (`restoreFederal`, so a college is never compared with its own CDS value).
 *
 *   npm run check-cds-records [-- --unit <unit_id>] [--dry-run]
 *
 * Writes each changed record back (same key order as the readers write) and prints, per college, the items whose
 * status changed and why. Re-running is a no-op: `applyChecks` is idempotent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { School } from "../lib/types";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { applyChecks } from "../lib/cds-checks.ts";
import { restoreFederal } from "../lib/newest.ts";
import { readRecords, serializeRecord, writeRecord } from "./lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const RECORDS = join(ROOT, "data", "cds-records");

const { values } = parseArgs({ options: { unit: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
const schools = new Map((JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[]).map((s) => [s.unit_id, s]));

for (const record of readRecords(RECORDS)) {
  if (values.unit && record.unit_id !== values.unit) continue;
  const school = schools.get(record.unit_id);
  const federal = school ? restoreFederal(school) : null;
  const before = serializeRecord(record);
  const documents = record.documents.map((doc) => applyChecks(doc, { table: CDS_TEMPLATE, school: federal, others: record.documents }));
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
  }
  if (!values["dry-run"] && serializeRecord(next) !== before) writeRecord(RECORDS, next);
}
