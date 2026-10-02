/**
 * Publish data/schools.json, data/meta.json, data/release-calendar.json and data/history/ to Supabase.
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
 *   5. History (data/history/, from `npm run sync-history`), if built: the same shard checks as check:lineage, then
 *      stage_history() takes the shards in batches, publish_history_staged() swaps them in with one transaction, and
 *      it's read back and compared too.
 *   5b. Per-college detail files (data/detail/, lib/detail.ts), if built: the same checks as check:lineage up front, then
 *      stage_details() in batches, publish_details_staged() swaps them in with one transaction, and they're read back.
 *   6. If REVALIDATE_URL and REVALIDATE_SECRET are set, ask the site to regenerate its static pages.
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (environment variables win over the env file, which is how the
 * GitHub Action points it at prod). See specs/supabase.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { ReleaseCalendar } from "../lib/releases";
import { validateLineage } from "../lib/lineage.ts";
import { fetchAllSchoolHistories, fetchDatasetFiles, fetchHistoryFiles, supabaseClient } from "../lib/supabase.ts";
import { validateHistoryMeta, validateShard, type SchoolHistory } from "../lib/history.ts";
import { detailFileProblems, detailTablesProblem, publishDetails, readDetails } from "./lib/publish-details.mts";

const ROOT = join(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");
/** History shards per staging call (~1 MB), well under the API's statement timeout. */
const HISTORY_BATCH = 150;

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

// History, when built: checked up front so a bad shard stops the publish before anything is written.
const HISTORY = join(ROOT, "data", "history");
const history = existsSync(join(HISTORY, "meta.json"))
  ? {
      files: Object.fromEntries(["meta", "national", "facts", "cpi"].map((n) => [n, JSON.parse(readFileSync(join(HISTORY, `${n}.json`), "utf8"))])),
      shards: readdirSync(join(HISTORY, "schools"))
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory),
    }
  : null;
if (history) {
  const ids = new Set(schools.map((s) => s.unit_id));
  const hp = [...validateHistoryMeta(history.files.meta, meta), ...history.shards.flatMap((h) => validateShard(h, ids))];
  if (hp.length) {
    for (const p of hp.slice(0, 20)) console.error(`  ${p}`);
    fail(`${hp.length} history problem(s); run npm run check:lineage.`);
  }
}

// Per-college detail files (lib/detail.ts), when built: checked up front too.
const details = readDetails(ROOT);
if (details) {
  const dp = detailFileProblems(details, schools, meta);
  if (dp.length) {
    for (const p of dp.slice(0, 20)) console.error(`  ${p}`);
    fail(`${dp.length} detail-file problem(s); run npm run check:lineage.`);
  }
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

/**
 * Only a missing table (Postgres 42P01, or PostgREST's PGRST205) means a migration isn't applied. Anything else (an empty
 * error from a dropped connection, or another publish running at the same moment) is reported as it is.
 */
function tableCheck(error: { message?: string; code?: string; details?: string } | null, migration: string) {
  if (!error) return;
  const what = [error.message, error.code, error.details].filter(Boolean).join(" · ") || "no error message (a dropped connection, or another publish running?)";
  if (error.code === "42P01" || error.code === "PGRST205") fail(`${what}. Apply ${migration} first.`);
  fail(`checking the database failed: ${what}. Retry; if it keeps failing, check the project.`);
}

if (history) {
  const { error: historyError } = await client.from("history_files").select("name", { head: true });
  tableCheck(historyError, "supabase/migrations/20260928120000_history.sql");
  const { error: stagingError } = await client.from("history_staging").select("unit_id", { head: true });
  tableCheck(stagingError, "supabase/migrations/20260928180000_history_staging.sql");
}

if (details) {
  const problem = await detailTablesProblem(client);
  if (problem) fail(problem);
}

if (DRY_RUN) {
  const ready = history ? `${history.shards.length} college histories ready; ` : "";
  console.log(`Checks passed. ${count ?? 0} colleges currently published; ${ready}nothing written.`);
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

// 5. History
if (history) {
  // Stage the shards in batches (one call with all of them exceeds the statement timeout), then swap them in with one
  // short transaction, so readers never see a half-published history.
  for (let i = 0; i < history.shards.length; i += HISTORY_BATCH) {
    const { error } = await client.rpc("stage_history", { p_schools: history.shards.slice(i, i + HISTORY_BATCH), p_reset: i === 0 });
    if (error) fail(`history: staging shards ${i}–${i + HISTORY_BATCH}: ${error.message}. Has supabase/migrations/20260928180000_history_staging.sql been applied?`);
    process.stdout.write(`\r  History: staged ${Math.min(i + HISTORY_BATCH, history.shards.length)}/${history.shards.length}`);
  }
  process.stdout.write("\n");
  const { data: shardCount, error: hError } = await client.rpc("publish_history_staged", { p_files: history.files, p_expected: history.shards.length });
  if (hError) fail(`history: ${hError.message}`);
  const backFiles = await fetchHistoryFiles(client);
  const backShards = await fetchAllSchoolHistories(client);
  const byId = new Map(backShards.map((h) => [h.unit_id, h]));
  const differ = history.shards.filter((h) => !same(h, byId.get(h.unit_id))).map((h) => h.unit_id);
  if (!backFiles || backShards.length !== history.shards.length || differ.length) {
    const eg = differ.length ? `; e.g. ${differ.slice(0, 5).join(", ")}` : "";
    fail(`history differs after reading back (${backShards.length} shards, expected ${history.shards.length}${eg}).`);
  }
  const back = { meta: backFiles.meta, national: backFiles.national, facts: backFiles.facts, cpi: backFiles.cpi };
  const local = { meta: history.files.meta, national: history.files.national, facts: history.files.facts, cpi: history.files.cpi };
  if (!same(back, local)) fail("history files differ after reading back.");
  console.log(`Published ${shardCount} college histories (built ${history.files.meta.built}); read back and verified.`);
} else {
  console.log("No data/history/ (run npm run sync-history); history not published.");
}

// 5b. Detail files (home states; later majors).
if (details) {
  const n = await publishDetails(client, details).catch((err: Error) => fail(err.message));
  console.log(`Published ${n} college detail files; read back and verified.`);
} else {
  console.log("No data/detail/ (run npm run sync-data); detail files not published.");
}

// 6. Revalidate the site's static pages.
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
