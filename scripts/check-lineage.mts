/**
 * Checks that every value in data/schools.json and data/history/ can be traced to a source.
 *
 *   npm run check:lineage
 *
 * Same validation the syncs run before writing: every stored field is registered in lib/fields.ts, every lineage
 * record is complete, every release has a year, and the registry's derivations are sound (lib/lineage.ts). For
 * history (lib/history.ts): every series is registered in SERIES, every shard belongs to a college in the dataset,
 * values are possible, and every file family cites a known source. For CDS records (data/cds-records/, lib/cds-records.ts):
 * every passed value is located and quoted and every document is in data/college-docs.json.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";
import { validateHistoryMeta, validateShard, type HistoryMeta, type SchoolHistory } from "../lib/history.ts";
import { detailFileProblems, readDetails } from "./lib/publish-details.mts";
import { validateCdsRecords } from "../lib/cds-records.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { readManifest, readRecords } from "./lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));

const problems = validateLineage(schools, meta);

const HISTORY = join(ROOT, "data", "history");
let shards = 0;
if (existsSync(join(HISTORY, "meta.json"))) {
  const hmeta: HistoryMeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8"));
  problems.push(...validateHistoryMeta(hmeta, meta));
  const ids = new Set(schools.map((s) => s.unit_id));
  for (const f of readdirSync(join(HISTORY, "schools")).filter((f) => f.endsWith(".json"))) {
    const h: SchoolHistory = JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8"));
    if (`${h.unit_id}.json` !== f) problems.push(`history ${f}: file name doesn't match unit_id ${h.unit_id}`);
    problems.push(...validateShard(h, ids));
    shards++;
  }
  if (shards !== hmeta.schools) problems.push(`history meta says ${hmeta.schools} shards; the folder has ${shards}`);
}

// Per-college detail files (lib/detail.ts): valid tables, cited like the registry says, consistent with the snapshot.
const details = readDetails(ROOT);
if (details) problems.push(...detailFileProblems(details, schools, meta));

// CDS records (specs/college-reported-round-3.md, Decision 2): every passed value located and quoted, every document
// in the manifest, a year for every item group, a known schema or reader version.
const records = readRecords(join(ROOT, "data", "cds-records"));
problems.push(...validateCdsRecords(records, readManifest(join(ROOT, "data", "college-docs.json")), CDS_TEMPLATE));

if (problems.length) {
  console.error(`Lineage check failed: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
  if (problems.length > 50) console.error(`  …and ${problems.length - 50} more`);
  process.exit(1);
}
const overridden = schools.filter((s) => s.lineage && Object.keys(s.lineage).length).length;
console.log(
  `Lineage OK: ${schools.length} colleges, ${overridden} with values from a non-default source` +
    (shards ? `; ${shards} college histories` : "") +
    (details ? `; ${details.length} detail files` : "") +
    `; ${records.length} CDS records.`
);
