/**
 * Checks that every value in data/schools.json can be traced to a source.
 *
 *   npm run check:lineage
 *
 * Same validation the sync runs before writing (lib/lineage.ts): every stored
 * field is registered in lib/fields.ts, every lineage record is complete, every
 * release has a year, and the registry's derivations are sound.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));

const problems = validateLineage(schools, meta);
if (problems.length) {
  console.error(`Lineage check failed: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
  if (problems.length > 50) console.error(`  …and ${problems.length - 50} more`);
  process.exit(1);
}
const overridden = schools.filter((s) => s.lineage && Object.keys(s.lineage).length).length;
console.log(`Lineage OK: ${schools.length} colleges, ${overridden} with values from a non-default source.`);
