/**
 * Applies data/state-laws.json to the committed dataset (specs/lgbtq-life.md#phase-2-as-built-state-laws), the same way
 * `npm run sync-data` does (scripts/lib/lgbtq-sync.mts), so a state-law review doesn't need a full sync.
 *
 *   npm run merge-state-laws              # writes data/schools.json and data/meta.json
 *   npm run merge-state-laws -- --dry-run # prints what would change, writes nothing
 *
 * Replaces each college's `lgbtq.state_law` (and its lineage record) and the "state-law" source in meta.json; nothing
 * else. Running it twice changes nothing the second time. Refuses to write if the table or the lineage check fails.
 * No network.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";
import { effectiveLabel, stateLawFor, validateStateLaws, type StateLawTable } from "../lib/lgbtq.ts";
import { addStateLawMeta } from "./lib/lgbtq-sync.mts";

const ROOT = join(import.meta.dirname, "..");
const SCHOOLS = join(ROOT, "data", "schools.json");
const META = join(ROOT, "data", "meta.json");
const LAWS = join(ROOT, "data", "state-laws.json");
const dryRun = process.argv.includes("--dry-run");

/** One college with the table applied: `lgbtq.state_law` set or cleared, its lineage record kept in step. */
function withStateLaw(school: School, laws: StateLawTable): School {
  const law = stateLawFor(school, laws);
  const s: School = { ...school };
  let lineage = { ...(s.lineage ?? {}) };
  if (!law) delete lineage["lgbtq.state_law"];
  if (law) {
    s.lgbtq = { gender: null, admissions: null, ...(s.lgbtq ?? {}), state_law: law };
    const record = { source: "state-law", year: effectiveLabel(law.effective), url: law.url, retrieved: law.checked } as const;
    if ("lgbtq.state_law" in lineage) lineage["lgbtq.state_law"] = record;
    else {
      // A new record goes where sync-data + merge-reported put it: before the college-reported records, which
      // merge-reported appends last (its idempotence test compares the file byte for byte).
      const entries = Object.entries(lineage);
      const at = entries.findIndex(([k]) => k.startsWith("reported."));
      entries.splice(at < 0 ? entries.length : at, 0, ["lgbtq.state_law", record]);
      lineage = Object.fromEntries(entries) as typeof lineage;
    }
  } else if (s.lgbtq) {
    const rest = { ...s.lgbtq, state_law: null };
    const empty = !rest.gender && !rest.admissions && !(rest.policies?.length);
    if (empty) delete s.lgbtq;
    else s.lgbtq = rest;
  }
  if (Object.keys(lineage).length) s.lineage = lineage;
  else delete s.lineage;
  return s;
}

function main() {
  const laws: StateLawTable = JSON.parse(readFileSync(LAWS, "utf8"));
  const tableProblems = validateStateLaws(laws);
  if (tableProblems.length) {
    console.error(`merge-state-laws: data/state-laws.json failed its checks; nothing written:\n  ${tableProblems.join("\n  ")}`);
    process.exit(1);
  }
  const schools: School[] = JSON.parse(readFileSync(SCHOOLS, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(META, "utf8"));
  const merged = schools.map((s) => withStateLaw(s, laws));
  addStateLawMeta(meta, laws);
  const problems = validateLineage(merged, meta);
  if (problems.length) {
    console.error(`merge-state-laws: lineage check failed (${problems.length}); nothing written:`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    process.exit(1);
  }
  const byState = new Map<string, number>();
  for (const s of merged) if (s.lgbtq?.state_law) byState.set(s.lgbtq.state_law.state, (byState.get(s.lgbtq.state_law.state) ?? 0) + 1);
  const changed = merged.filter((s, i) => JSON.stringify(s) !== JSON.stringify(schools[i])).length;
  const summary = `state laws: ${[...byState].map(([k, n]) => `${k} ${n}`).join(", ")}; ${[...byState.values()].reduce((a, b) => a + b, 0)} public colleges; ${changed} colleges changed`;
  if (dryRun) {
    console.log(`${summary} (--dry-run, nothing written)`);
    return;
  }
  writeFileSync(SCHOOLS, `[\n${merged.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(summary);
}

main();
