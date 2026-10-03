/**
 * Prints the current state of the college-reported data: one line per published college (name, term, source kind,
 * which values are present, URL, run), totals by term and by source kind, and how many colleges in
 * data/schools.json currently carry a `reported` block — so a person (or `npm run merge-reported`'s caller) can
 * see at a glance whether the merge has happened. Read-only: no network, no writes. See specs/college-reported-setup.md.
 *
 *   npm run report-college-reported
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { collegeRows, mergedCount, totals } from "../lib/reported-report.ts";
import { dataPaths, readReported } from "./lib/college-reported/files.mts";

const ROOT = join(import.meta.dirname, "..");
const paths = dataPaths(ROOT);

function main() {
  const reported = readReported(paths.reported);
  const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
  const names = new Map(schools.map((s) => [s.unit_id, s.name]));
  const rows = collegeRows(reported, names);

  console.log(`College-reported data: updated ${reported.updated ?? "never"}, ${rows.length} college${rows.length === 1 ? "" : "s"} published.\n`);

  if (rows.length) {
    console.log("College                                  Term        Kind           Values                        Run              URL");
    console.log("-".repeat(130));
    for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = row.name.length > 40 ? `${row.name.slice(0, 39)}…` : row.name.padEnd(40);
      const term = row.term.padEnd(11);
      const kind = row.kind.padEnd(14);
      const present = (row.present.join(", ") || "(none)").padEnd(29);
      const run = row.run.padEnd(16);
      console.log(`${name} ${term} ${kind} ${present} ${run} ${row.url}`);
    }
    console.log("");
  }

  const { byTerm, byKind } = totals(rows);
  console.log("By entering term:");
  for (const [term, n] of Object.entries(byTerm).sort()) console.log(`  ${term}: ${n}`);
  console.log("\nBy source kind:");
  for (const [kind, n] of Object.entries(byKind).sort()) console.log(`  ${kind}: ${n}`);

  const merged = mergedCount(schools);
  console.log(`\ndata/schools.json: ${merged} of ${schools.length} colleges currently carry a "reported" block.`);
  if (merged !== rows.length) {
    console.log(`  (${rows.length} are published in data/college-reported.json — run "npm run merge-reported" to bring schools.json in sync.)`);
  }
}

main();
