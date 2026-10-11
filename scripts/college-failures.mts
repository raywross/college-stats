/**
 * Writes data/college-failures.json: the colleges where the college-reported pipeline failed, one row per college and
 * reason code, for research (specs/college-data-failures.md). Derived only from the pipeline's committed state; no
 * network, no API key.
 *
 *   npm run college-failures              # writes data/college-failures.json
 *   npm run college-failures -- --dry-run # prints the counts, writes nothing
 *   npm run college-failures -- --date 2026-10-10   # the generation date (default: newest `updated` of the inputs)
 *
 * Reads data/college-sources.json, data/review-queue.json, data/college-docs.json, data/cds-records/,
 * data/reference/blocked-hosts.json, data/schools.json, and the previous data/college-failures.json (first_seen is
 * kept for a college and reason listed before). The data workflow runs it after merge-reported in both jobs, and
 * `npm run publish-college-failures` loads the file into Supabase after a production deploy.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { School } from "../lib/types";
import type { ReviewQueueFile, SourcesFile } from "../lib/reported.ts";
import { buildFailuresFile, formatFailuresFile, type BlockedHost, type CollegeInfo, type FailuresFile, type ManifestDoc } from "./lib/college-failures.mts";

const ROOT = process.env.COLLEGE_FAILURES_ROOT ?? join(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const OUT = join(DATA, "college-failures.json");

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, date: { type: "string" } } });

const readJson = <T,>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

const sources = readJson<SourcesFile>(join(DATA, "college-sources.json"), { updated: "", recipes: [] });
const queue = readJson<ReviewQueueFile>(join(DATA, "review-queue.json"), { updated: "", items: [] });
const docs = readJson<{ updated?: string; documents: ManifestDoc[] }>(join(DATA, "college-docs.json"), { documents: [] });
const blocked = readJson<{ hosts: BlockedHost[] }>(join(DATA, "reference", "blocked-hosts.json"), { hosts: [] });
const schools = readJson<School[]>(join(DATA, "schools.json"), []);
const previous = readJson<FailuresFile | null>(OUT, null);

const readShas = new Set<string>();
const recordsDir = join(DATA, "cds-records");
if (existsSync(recordsDir)) {
  for (const f of readdirSync(recordsDir).filter((f) => f.endsWith(".json"))) {
    const rec = JSON.parse(readFileSync(join(recordsDir, f), "utf8")) as { documents?: { sha256: string; reads?: Record<string, unknown> }[] };
    for (const d of rec.documents ?? []) if (Object.keys(d.reads ?? {}).length) readShas.add(d.sha256);
  }
}

const colleges = new Map<string, CollegeInfo>(
  schools.map((s) => {
    const adm = s.admissions as (School["admissions"] & { federal?: { year?: number } }) | undefined;
    return [s.unit_id, { name: s.name, published: Boolean(s.reported), federal_year: adm?.federal?.year ?? adm?.year ?? null }];
  }),
);

const newestInput = [sources.updated, queue.updated, docs.updated ?? ""].reduce((a, b) => (b > a ? b : a), "");
const date = values.date ?? (newestInput || new Date().toISOString().slice(0, 10));
const file = buildFailuresFile({ recipes: sources.recipes, queue: queue.items, docs: docs.documents, readShas, blockedHosts: blocked.hosts, colleges }, previous, date);

const colleges_listed = new Set(file.rows.map((r) => r.unit_id)).size;
console.log(`${file.rows.length} failure rows for ${colleges_listed} colleges (as of ${file.generated}):`);
for (const [code, n] of Object.entries(file.counts)) console.log(`  ${code.padEnd(26)} ${n}`);
if (values["dry-run"]) {
  console.log("Dry run; nothing written.");
} else {
  writeFileSync(OUT, formatFailuresFile(file));
  console.log(`Wrote ${OUT.slice(ROOT.length + 1)}.`);
}
