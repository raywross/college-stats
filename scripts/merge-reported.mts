/**
 * Merges data/college-reported.json into the committed data/schools.json, so the data PR itself carries the
 * site's figures (Decision 5, specs/college-reported-round-2.md) instead of waiting for someone to run
 * `npm run sync-data` by hand afterwards.
 *
 *   npm run merge-reported            # writes data/schools.json
 *   npm run merge-reported -- --dry-run   # prints what would change, writes nothing
 *
 * For every school, strips any existing `reported` block and every `reported.*` lineage record, then re-applies
 * the current `data/college-reported.json` entries (through `reportedToPatch`, exactly as `scripts/sync-data.mts`
 * does — both call `lib/reported-merge.ts#mergeReported`, so they can't disagree). A college dropped from
 * `college-reported.json` since the last merge loses its block. Refuses to write if the result fails
 * `validateLineage`. No network, no API key.
 *
 * Round 3: each college's CDS record (data/cds-records/) is merged too (lib/reported-merge.ts passes it to each
 * section's module), and the record-built detail tables (`cds_aid`, lib/cds/financial-aid.ts) are written into
 * data/detail/schools/{unit_id}.json, replacing that table only and leaving the sync's tables as they are.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";
import type { ReportedFile } from "../lib/reported.ts";
import { mergeReported } from "../lib/reported-merge.ts";
import { DETAIL_TABLES, formatDetail, type DetailTableKey, type SchoolDetail } from "../lib/detail.ts";
import { financialAidDetails } from "../lib/cds/financial-aid.ts";
import { readRecords } from "./lib/college-reported/records.mts";
import { detailFileProblems, readDetails } from "./lib/publish-details.mts";

// MERGE_REPORTED_ROOT lets tests point this at a scratch directory holding just data/schools.json,
// data/college-reported.json, and data/meta.json, without copying the whole repo.
const ROOT = process.env.MERGE_REPORTED_ROOT ?? join(import.meta.dirname, "..");
const SCHOOLS = join(ROOT, "data", "schools.json");
const REPORTED = join(ROOT, "data", "college-reported.json");
const META = join(ROOT, "data", "meta.json");
const RECORDS = join(ROOT, "data", "cds-records");
const DETAIL_DIR = join(ROOT, "data", "detail", "schools");
/** Detail tables built from CDS records here (the sync builds the rest and keeps these via the same builders). */
const RECORD_TABLES: readonly DetailTableKey[] = ["cds_aid"];

/** Every detail file with the record-built tables replaced by `built` (files that end up empty are dropped). */
function withRecordTables(existing: readonly SchoolDetail[], built: readonly SchoolDetail[]): { details: SchoolDetail[]; changed: Set<string> } {
  const byId = new Map(existing.map((d) => [d.unit_id, d]));
  const builtById = new Map(built.map((d) => [d.unit_id, d]));
  const order = Object.keys(DETAIL_TABLES) as DetailTableKey[];
  const changed = new Set<string>();
  const out: SchoolDetail[] = [];
  for (const id of [...new Set([...byId.keys(), ...builtById.keys()])].sort()) {
    const tables: Record<string, unknown> = { ...(byId.get(id)?.tables ?? {}) };
    for (const k of RECORD_TABLES) delete tables[k];
    Object.assign(tables, builtById.get(id)?.tables ?? {});
    const d = { unit_id: id, tables: Object.fromEntries(order.filter((k) => tables[k]).map((k) => [k, tables[k]])) } as SchoolDetail;
    const before = byId.get(id);
    if (!before || formatDetail(before) !== formatDetail(d)) changed.add(id);
    if (Object.keys(d.tables).length) out.push(d);
  }
  return { details: out, changed };
}

const dryRun = process.argv.includes("--dry-run");

function main() {
  const schools: School[] = JSON.parse(readFileSync(SCHOOLS, "utf8"));
  const reported: ReportedFile = JSON.parse(readFileSync(REPORTED, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(META, "utf8"));

  const records = readRecords(RECORDS);
  const { schools: merged, merged: mergedCount, removed } = mergeReported(schools, reported, records);
  const { details, changed } = withRecordTables(readDetails(ROOT) ?? [], financialAidDetails(schools, records));

  const problems = [...validateLineage(merged, meta), ...detailFileProblems(details.filter((d) => changed.has(d.unit_id)), merged, meta)];
  if (problems.length) {
    console.error(`merge-reported: lineage check failed (${problems.length}); nothing written:`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    if (problems.length > 30) console.error(`  …and ${problems.length - 30} more`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`college-reported: ${mergedCount} colleges merged, ${removed} removed; ${records.length} CDS records, ${changed.size} detail files changed (--dry-run, nothing written)`);
    return;
  }

  // One school per line, same format as scripts/sync-data.mts, so a run's diff stays readable and the two
  // outputs are byte-identical when they agree.
  writeFileSync(SCHOOLS, `[\n${merged.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  const kept = new Set(details.map((d) => d.unit_id));
  for (const id of changed) {
    const file = join(DETAIL_DIR, `${id}.json`);
    if (kept.has(id)) writeFileSync(file, formatDetail(details.find((d) => d.unit_id === id)!));
    else if (existsSync(file)) rmSync(file);
  }
  console.log(`college-reported: ${mergedCount} colleges merged, ${removed} removed; ${records.length} CDS records, ${changed.size} detail files changed`);
}

main();
