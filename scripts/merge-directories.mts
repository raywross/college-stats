/**
 * Merges data/directories/<org>.json into the committed dataset (specs/campus-directories.md#merge), the same way
 * `npm run sync-data` does (scripts/lib/directories/merge.mts), so a directory data PR carries the site's listings
 * without a full sync.
 *
 *   npm run merge-directories              # writes data/schools.json, data/meta.json, changed detail files
 *   npm run merge-directories -- --dry-run # prints what would change, writes nothing
 *
 * Replaces each college's `directories` detail table and `school.directories` summary (with its lineage record), and
 * the directory source kinds in meta.json; nothing else. Running it twice changes nothing the second time. Refuses to
 * write if the result fails the lineage and detail checks. No network.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";
import { formatDetail } from "../lib/detail.ts";
import { detailFileProblems, readDetails } from "./lib/publish-details.mts";
import { readDirectoryFiles } from "./lib/directories/files.mts";
import { addDirectoryMeta, applyDirectories, directoryDetails, orphanSummaries, withDirectoryTables } from "./lib/directories/merge.mts";
import { readPagesFile } from "./lib/campus-pilot/files.mts";
import { campusPagesDetails, pilotDirectoryFiles, withTable } from "./lib/campus-pilot/merge.mts";

// MERGE_DIRECTORIES_ROOT lets tests point this at a scratch copy holding data/schools.json, meta.json, detail/, directories/.
const ROOT = process.env.MERGE_DIRECTORIES_ROOT ?? join(import.meta.dirname, "..");
const SCHOOLS = join(ROOT, "data", "schools.json");
const META = join(ROOT, "data", "meta.json");
const DETAIL_DIR = join(ROOT, "data", "detail", "schools");
const dryRun = process.argv.includes("--dry-run");

function main() {
  const schools: School[] = JSON.parse(readFileSync(SCHOOLS, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(META, "utf8"));
  const files = readDirectoryFiles(ROOT);
  // The campus-life pilot's facts (data/campus-pages.json): groups named on a college's own pages join the listings;
  // tier A facts get their own detail table (scripts/lib/campus-pilot/merge.mts).
  const pages = readPagesFile(join(ROOT, "data", "campus-pages.json"));
  const ids = new Set(schools.map((s) => s.unit_id));
  const built = directoryDetails([...files, ...pilotDirectoryFiles(pages)], ids);
  const merged = applyDirectories(schools, built);
  addDirectoryMeta(meta, files);
  const step1 = withDirectoryTables(readDetails(ROOT) ?? [], built);
  const step2 = withTable(step1.details, campusPagesDetails(pages, ids), "campus_pages");
  const details = step2.details;
  const changed = new Set([...step1.changed, ...step2.changed]);

  const problems = [
    ...validateLineage(merged, meta),
    ...detailFileProblems(details.filter((d) => changed.has(d.unit_id)), merged, meta),
    ...orphanSummaries(merged, details),
  ];
  if (problems.length) {
    console.error(`merge-directories: lineage check failed (${problems.length}); nothing written:`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    if (problems.length > 30) console.error(`  …and ${problems.length - 30} more`);
    process.exit(1);
  }
  const listed = merged.filter((s) => s.directories).length;
  const listings = built.reduce((n, d) => n + (d.tables.directories?.rows.listings.length ?? 0), 0);
  const pilot = details.filter((d) => d.tables.campus_pages).length;
  const summary = `directories: ${files.length} list${files.length === 1 ? "" : "s"}, ${listings} listings at ${listed} colleges; campus pages at ${pilot} colleges; ${changed.size} detail files changed`;
  if (dryRun) {
    console.log(`${summary} (--dry-run, nothing written)`);
    return;
  }
  writeFileSync(SCHOOLS, `[\n${merged.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
  const kept = new Map(details.map((d) => [d.unit_id, d]));
  for (const id of changed) {
    const file = join(DETAIL_DIR, `${id}.json`);
    const d = kept.get(id);
    if (d) writeFileSync(file, formatDetail(d));
    else if (existsSync(file)) rmSync(file);
  }
  console.log(summary);
}

main();
