/**
 * Prints the current state of the college-reported data: one line per published college (name, term, source kind,
 * which values are present, URL, run), totals by term and by source kind, and how many colleges of the bundled copy
 * carry a `reported` block, so a person can see at a glance whether the last publish carried the store's entries.
 * Read-only: no network beyond the store, no writes. See specs/college-reported-setup.md.
 *
 *   npm run report-college-reported -- --store supabase      # the data project's reported.entries
 *   npm run report-college-reported -- --store file:<dir>
 *
 * The entries are `reported.entries` (with `import.headers` "college-reported.json" for the `updated` date); the
 * colleges are the bundled copy's (`.data/snapshot/colleges.json`, after `npm run fetch-snapshot`).
 */
import type { ReportedEntry, ReportedFile } from "../lib/reported.ts";
import { collegeRows, mergedCount, totals } from "../lib/reported-report.ts";
import { COLLECTIONS, readLayer } from "./lib/data-platform/layers.mts";
import { storeFromArgv } from "./lib/data-platform/producer.mts";
import { readBundledColleges } from "./lib/data-platform/bundled.mts";

async function main() {
  const store = storeFromArgv(process.argv.slice(2));
  const header = (await store.readOne<{ updated?: string | null }>(COLLECTIONS.import.headers, "college-reported.json")) ?? {};
  const reported: ReportedFile = { updated: header.updated ?? null, entries: [...(await readLayer<ReportedEntry>(store, COLLECTIONS.reported.entries)).values()] };
  const schools = readBundledColleges();
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
  console.log(`\nThe bundled copy: ${merged} of ${schools.length} colleges carry a "reported" block.`);
  if (merged !== rows.length) console.log(`  (${rows.length} are in reported.entries: the next publish brings the snapshot in line.)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
