/**
 * Publish data/schools.json, data/meta.json and data/release-calendar.json to Supabase.
 *
 *   npm run publish-data              # the project in .env.local (development)
 *   npm run publish-data:prod         # the project in .env.prod.local
 *   npm run publish-data -- --dry-run # run the checks, write nothing
 *   npm run publish-data -- --allow-shrink
 *
 * Git stays the reviewed source of truth; Supabase serves what was published from it. Steps:
 *   1. The same lineage check as `npm run check:lineage` (lib/lineage.ts). Nothing invalid is published.
 *   2. Refuse to drop more than 10% of the colleges already published (a broken sync, most likely)
 *      unless --allow-shrink.
 *   3. publish_dataset() replaces everything in one transaction (supabase/migrations/).
 *   4. Read it all back and require an exact match with the local files.
 *   5. If REVALIDATE_URL and REVALIDATE_SECRET are set, ask the site to regenerate its static pages.
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (environment variables win over the env file, which is how the
 * GitHub Action points it at prod). See specs/supabase.md.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { ReleaseCalendar } from "../lib/releases";
import { validateLineage } from "../lib/lineage.ts";
import { fetchDatasetFiles, supabaseClient } from "../lib/supabase.ts";

const ROOT = join(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");

const read = <T,>(name: string): T => JSON.parse(readFileSync(join(ROOT, "data", name), "utf8"));
const schools = read<School[]>("schools.json");
const meta = read<DatasetMeta>("meta.json");
const releaseCalendar = read<ReleaseCalendar>("release-calendar.json");

function fail(message: string): never {
  console.error(`Publish failed: ${message}`);
  process.exit(1);
}

function gitCommit(): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "data"], { cwd: ROOT, encoding: "utf8" }).trim();
    return dirty ? `${sha}+uncommitted` : sha;
  } catch {
    return null;
  }
}

// 1. Lineage
const problems = validateLineage(schools, meta);
if (problems.length) {
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  fail(`${problems.length} lineage problem(s); run npm run check:lineage.`);
}

const client = supabaseClient("publish");
const host = new URL(process.env.SUPABASE_URL!).host;
console.log(`Publishing ${schools.length} colleges (retrieved ${meta.retrieved}) to ${host}${DRY_RUN ? " [dry run]" : ""}`);

// 2. Shrink guard
const { count, error: countError } = await client.from("schools").select("unit_id", { count: "exact", head: true });
if (countError) fail(`${countError.message}. Has the migration in supabase/migrations/ been applied?`);
if (count && schools.length < count * 0.9 && !ALLOW_SHRINK) {
  fail(`would drop from ${count} to ${schools.length} colleges. Check the sync, or pass --allow-shrink.`);
}

if (DRY_RUN) {
  console.log(`Checks passed. ${count ?? 0} colleges currently published; nothing written.`);
  process.exit(0);
}

// 3. Publish
const commit = gitCommit();
const { data: written, error } = await client.rpc("publish_dataset", {
  p_schools: schools,
  p_meta: meta,
  p_release_calendar: releaseCalendar,
  p_git_commit: commit,
  p_published_by: process.env.GITHUB_ACTOR ?? userInfo().username,
});
if (error) fail(error.message);

// 4. Round trip: what the app will read must equal the local files exactly.
const back = await fetchDatasetFiles(client);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const mismatched = schools.filter((s, i) => !same(s, back.schools[i])).map((s) => s.unit_id);
if (back.schools.length !== schools.length) fail(`read back ${back.schools.length} colleges, expected ${schools.length}.`);
if (mismatched.length) fail(`${mismatched.length} colleges differ after reading back (e.g. ${mismatched.slice(0, 5).join(", ")}).`);
if (!same(back.meta, meta) || !same(back.releaseCalendar, releaseCalendar)) fail("meta or release calendar differs after reading back.");

console.log(`Published ${written} colleges from ${commit ?? "an unknown commit"}; read back and verified.`);

// 5. Revalidate the site's static pages.
const { REVALIDATE_URL, REVALIDATE_SECRET } = process.env;
if (!REVALIDATE_URL || !REVALIDATE_SECRET) {
  console.log("REVALIDATE_URL/REVALIDATE_SECRET not set: static pages update on their next rebuild or daily regeneration.");
  process.exit(0);
}
const res = await fetch(REVALIDATE_URL, { method: "POST", headers: { Authorization: `Bearer ${REVALIDATE_SECRET}` } })
  .catch((err: Error) => ({ ok: false, status: err.message }) as const);
if (!res.ok) {
  fail(`the data is published, but revalidating ${REVALIDATE_URL} failed (${res.status}). ` +
    "Retry with curl (specs/supabase.md#revalidation).");
}
console.log(`Revalidated ${new URL(REVALIDATE_URL).host}: static pages regenerate on their next visit.`);
