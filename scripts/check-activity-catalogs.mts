/**
 * Checks data/reference/sports.json, data/reference/clubs.json, and data/reference/activity-roles.json, the
 * activity catalogs the ActivitiesForm picker reads (specs/chances/inputs-beyond-academics.md, depth.md "What the
 * student enters"): unique keys, a known kind and family, an org/source_url pair that's either both set (https) or
 * both null, and every activity kind covered by a title mapping. Exits 1 with one line per problem.
 *
 *   npm run check:activity-catalogs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateActivityCatalogs } from "../lib/chances/activity-catalog.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (name: string) => JSON.parse(readFileSync(join(ROOT, "data", "reference", name), "utf8"));

const sports = read("sports.json");
const clubs = read("clubs.json");
const roles = read("activity-roles.json");

const problems = validateActivityCatalogs(sports, clubs, roles);
if (problems.length > 0) {
  console.error(`activity catalogs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`activity catalogs: ok (${sports.sports.length} sports, ${clubs.clubs.length} clubs, ${roles.roles.length} role titles)`);
