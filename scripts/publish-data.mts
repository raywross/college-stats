/**
 * Publish data/schools.json, data/meta.json, data/release-calendar.json and data/history/ to Supabase.
 *
 *   npm run publish-data              # the project in .env.local (development)
 *   npm run publish-data:prod         # the project in .env.prod.local
 *   npm run publish-data -- --dry-run # run the checks, write nothing
 *   npm run publish-data -- --allow-shrink
 *   npm run publish-data -- --changes-only               # print what changed since the published dataset; write nothing
 *   npm run publish-data -- --changes-only --prev <dir>  # the same against a local schools.json + meta.json; no network
 *
 * Git stays the reviewed source of truth; Supabase serves what was published from it. Steps:
 *   1. The same lineage check as `npm run check:lineage` (lib/lineage.ts). Nothing invalid is published.
 *   2. Refuse to drop more than 10% of the colleges already published (a broken sync, most likely)
 *      unless --allow-shrink.
 *   2b. What changed (lib/changes.ts; specs/product/follow-colleges.md): the previously published colleges are read back and
 *      diffed against the files. The changes are staged and publish_schools_staged_with_changes() writes them into
 *      dataset_changes in the same transaction as the colleges, so a change record exists only if its data was published.
 *      Without the follows migration on the project, the publish goes ahead without changes (a warning says so).
 *   3. stage_schools() takes the colleges in batches (one call with all of them exceeds the statement timeout), then
 *      publish_schools_staged() swaps them in with meta and the release calendar in one transaction.
 *   4. Read it all back and require an exact match with the local files.
 *   5. History (data/history/, from `npm run sync-history`), if built: the same shard checks as check:lineage, then the
 *      shards are written straight into school_histories in batches (scripts/lib/publish-batches.mts; one swap of all
 *      of them timed out after wave 2), colleges no longer in the data are removed, the shared files are written, and
 *      it's all read back and compared. Not atomic: mid-publish, readers can see a mix of old and new shards.
 *      National trend files (data/history/trends/, `npm run build-trends`) go into the same table as `trends/{name}` rows;
 *      rows for files no longer built are removed, and they're read back too.
 *   5b. Per-college detail files (data/detail/, lib/detail.ts), if built: the same checks as check:lineage up front, then
 *      written into school_details the same way, and read back.
 *   5d. High schools (data/high-schools/, scripts/lib/publish-high-schools.mts), if built: the same checks as
 *      check:lineage up front, then rows (state reports merged in), profile details, meta and medians are written in
 *      batches and read back. Skipped with a message when the high school tables aren't on the project yet.
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
import type { AliasRow } from "../lib/identity-files.ts";
import { validateLineage } from "../lib/lineage.ts";
import { fetchAllSchoolHistories, fetchAllTrendFiles, fetchDatasetFiles, fetchHistoryFiles, supabaseClient, trendRowName } from "../lib/supabase.ts";
import { validateHistoryMeta, validateShard, type SchoolHistory } from "../lib/history.ts";
import { detailFileProblems, detailTablesProblem, publishDetails, readDetails } from "./lib/publish-details.mts";
import { replaceInBatches } from "./lib/publish-batches.mts";
import { aliasesTableProblem, publishAliases } from "./lib/publish-aliases.mts";
import { highSchoolFileProblems, highSchoolTablesProblem, publishHighSchools, readHighSchoolData } from "./lib/publish-high-schools.mts";
import { aliasTableProblems } from "../lib/aliases.ts";
import { FOLLOWS_MIGRATION, changeSummary, changeTablesState, computeChanges, formatChangeList, readSnapshotDir, stageChanges } from "./lib/publish-changes.mts";
import type { DatasetChange } from "../lib/changes.ts";

const ROOT = join(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");
const CHANGES_ONLY = process.argv.includes("--changes-only");
const PREV_DIR = process.argv.includes("--prev") ? (process.argv[process.argv.indexOf("--prev") + 1] ?? "") : null;
/** History shards per staging call (~1 MB), well under the API's statement timeout. */
const HISTORY_BATCH = 150;
/** Colleges per staging call (~0.9 MB at 11 MB for 1,893); one call with all of them timed out on 2026-10-02. */
const SCHOOL_BATCH = 150;
const SCHOOL_STAGING_MIGRATION = "supabase/migrations/20261002140000_school_staging.sql";
const TREND_FILES_MIGRATION = "supabase/migrations/20261004130000_trend_files.sql";

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
      // National trends (specs/national-trends.md), by file name without `.json`.
      trends: existsSync(join(HISTORY, "trends"))
        ? Object.fromEntries(
            readdirSync(join(HISTORY, "trends"))
              .filter((f) => f.endsWith(".json"))
              .sort()
              .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(HISTORY, "trends", f), "utf8")) as unknown])
          )
        : ({} as Record<string, unknown>),
    }
  : null;
if (history) {
  const ids = new Set(schools.map((s) => s.unit_id));
  const hp = [...validateHistoryMeta(history.files.meta, meta), ...history.shards.flatMap((h) => validateShard(h, ids))];
  for (const [name, file] of Object.entries(history.trends)) {
    if (!/^[a-z0-9-]+$/.test(name)) hp.push(`trends/${name}.json: file names are lower-case words and hyphens`);
    const f = file as { name?: string; built?: string };
    if (name !== "index" && f.name !== name) hp.push(`trends/${name}.json: its name field is "${f.name}"`);
    if (f.built !== history.files.meta.built) hp.push(`trends/${name}.json: built from history ${f.built}, not ${history.files.meta.built} (run npm run build-trends)`);
  }
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

// Short names and nicknames (lib/aliases.ts), when built: the same invariant check as npm test.
const ALIASES_PATH = join(ROOT, "data", "aliases.json");
const aliases = existsSync(ALIASES_PATH) ? (JSON.parse(readFileSync(ALIASES_PATH, "utf8")) as AliasRow[]) : null;
if (aliases) {
  const ap = aliasTableProblems(aliases, new Set(schools.map((s) => s.unit_id)));
  if (ap.length) {
    for (const p of ap.slice(0, 20)) console.error(`  ${p}`);
    fail(`${ap.length} alias-table problem(s); run npm test.`);
  }
}

// High schools (specs/product/high-school-data.md), when built: checked up front too.
const highSchools = readHighSchoolData(join(ROOT, "data", "high-schools"));
if (highSchools) {
  const hsp = highSchoolFileProblems(highSchools, { collegeIds: new Set(schools.map((s) => s.unit_id)) });
  if (hsp.length) {
    for (const p of hsp.slice(0, 20)) console.error(`  ${p}`);
    fail(`${hsp.length} high school file problem(s); run npm run check:lineage.`);
  }
}

/** --changes-only: the change list, college by college; nothing is written. */
function printChanges(changes: DatasetChange[], against: string): never {
  console.log(`Changes against ${against}: ${changeSummary(changes)}.`);
  for (const line of formatChangeList(changes, schools)) console.log(line);
  console.log("Nothing written (--changes-only).");
  process.exit(0);
}

if (PREV_DIR !== null) {
  if (!CHANGES_ONLY || !PREV_DIR) fail("--prev <dir> works only with --changes-only.");
  let prev;
  try {
    prev = readSnapshotDir(PREV_DIR);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  printChanges(computeChanges(prev, { schools, meta }, releaseCalendar), PREV_DIR);
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
 * Callers check a table with a one-row select, never `head: true`: PostgREST answers a HEAD request for a missing table
 * with a bare 204, which supabase-js reports as no error (found 2026-10-02), so the check would always pass.
 * Only a missing table (Postgres 42P01, or PostgREST's PGRST205) means a migration isn't applied. Anything else (an empty
 * error from a dropped connection, or another publish running at the same moment) is reported as it is.
 */
function tableCheck(error: { message?: string; code?: string; details?: string } | null, migration: string) {
  if (!error) return;
  const what = [error.message, error.code, error.details].filter(Boolean).join(" · ") || "no error message (a dropped connection, or another publish running?)";
  if (error.code === "42P01" || error.code === "PGRST205") fail(`${what}. Apply ${migration} first.`);
  fail(`checking the database failed: ${what}. Retry; if it keeps failing, check the project.`);
}

{
  const { error: stagingError } = await client.from("school_staging").select("unit_id").limit(1);
  tableCheck(stagingError, SCHOOL_STAGING_MIGRATION);
}

if (history) {
  const { error: historyError } = await client.from("history_files").select("name").limit(1);
  tableCheck(historyError, "supabase/migrations/20260928120000_history.sql");
  const { error: shardsError } = await client.from("school_histories").select("unit_id").limit(1);
  tableCheck(shardsError, "supabase/migrations/20260928120000_history.sql");
}

if (details) {
  const problem = await detailTablesProblem(client);
  if (problem) fail(problem);
}

if (aliases) {
  const problem = await aliasesTableProblem(client);
  if (problem) fail(problem);
}

// High school tables: missing means the migration isn't applied yet; the rest of the publish goes ahead without them.
const highSchoolsProblem = highSchools ? await highSchoolTablesProblem(client) : null;

// 2b. What changed since the published dataset (read-only so far; staged and written with the colleges in step 3).
const changeTables = await changeTablesState(client).catch((err: Error) => fail(err.message));
const previous = count ? await fetchDatasetFiles(client).catch((err: Error) => fail(`reading the published dataset to diff: ${err.message}`)) : null;
const changes = computeChanges(previous, { schools, meta }, releaseCalendar);
if (CHANGES_ONLY) printChanges(changes, `the published dataset on ${host}`);
if (changeTables === "missing") {
  console.warn(`Warning: ${changeSummary(changes)} not recorded: dataset_changes isn't on this project. Apply ${FOLLOWS_MIGRATION} to record them.`);
} else {
  console.log(`What changed: ${changeSummary(changes)}.`);
}

if (DRY_RUN) {
  const ready = history ? `${history.shards.length} college histories ready; ` : "";
  console.log(`Checks passed. ${count ?? 0} colleges currently published; ${ready}nothing written.`);
  process.exit(0);
}

// 3. Publish
const commit = gitCommit();
for (let i = 0; i < schools.length; i += SCHOOL_BATCH) {
  const { error } = await client.rpc("stage_schools", { p_schools: schools.slice(i, i + SCHOOL_BATCH), p_offset: i, p_reset: i === 0 });
  if (error) fail(`staging colleges ${i}–${Math.min(i + SCHOOL_BATCH, schools.length)}: ${error.message}. Has ${SCHOOL_STAGING_MIGRATION} been applied?`);
}
const publishArgs = {
  p_meta: meta,
  p_release_calendar: releaseCalendar,
  p_expected: schools.length,
  p_git_commit: commit,
  p_published_by: process.env.GITHUB_ACTOR ?? userInfo().username,
};
let written: number;
let publishId: number | null = null;
if (changeTables === "ready") {
  await stageChanges(client, changes).catch((err: Error) => fail(err.message));
  const { data, error } = await client.rpc("publish_schools_staged_with_changes", { ...publishArgs, p_expected_changes: changes.length });
  if (error) fail(error.message);
  const result = data as { schools: number; publish_id: number; changes: number };
  written = result.schools;
  publishId = result.publish_id;
} else {
  const { data, error } = await client.rpc("publish_schools_staged", publishArgs);
  if (error) fail(error.message);
  written = data as number;
}

// 4. Round trip: what the app will read must equal the local files exactly.
const back = await fetchDatasetFiles(client);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const mismatched = schools.filter((s, i) => !same(s, back.schools[i])).map((s) => s.unit_id);
if (back.schools.length !== schools.length) fail(`read back ${back.schools.length} colleges, expected ${schools.length}.`);
if (mismatched.length) fail(`${mismatched.length} colleges differ after reading back (e.g. ${mismatched.slice(0, 5).join(", ")}).`);
if (!same(back.meta, meta) || !same(back.releaseCalendar, releaseCalendar)) fail("meta or release calendar differs after reading back.");

console.log(`Published ${written} colleges from ${commit ?? "an unknown commit"}; read back and verified.`);
if (publishId !== null) {
  const { count: changeCount, error: cError } = await client.from("dataset_changes").select("id", { count: "exact" }).eq("publish_id", publishId).limit(1);
  if (cError || changeCount !== changes.length) {
    fail(`dataset_changes for publish ${publishId}: read back ${changeCount ?? "?"} rows, expected ${changes.length}${cError ? ` (${cError.message})` : ""}.`);
  }
  console.log(`Recorded ${changeSummary(changes)} as publish ${publishId}; read back and verified.`);
}

// 5. History
if (history) {
  // Shards in batches straight into the live table (one swap of all of them exceeded the statement timeout), then the
  // shared files, which name the build, last.
  const shardCount = await replaceInBatches(
    client,
    "school_histories",
    history.shards.map((h) => ({ unit_id: h.unit_id, data: h })),
    HISTORY_BATCH,
    "History",
  ).catch((err: Error) => fail(err.message));
  const publishedAt = new Date().toISOString();
  const fileRows = Object.entries(history.files).map(([name, data]) => ({ name, data, published_at: publishedAt }));
  const { error: hError } = await client.from("history_files").upsert(fileRows, { onConflict: "name" });
  if (hError) fail(`history files: ${hError.message}`);
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

  // National trend files: `trends/{name}` rows in the same table, then rows for files no longer built are removed.
  const trendNames = Object.keys(history.trends);
  if (trendNames.length) {
    const rows = trendNames.map((name) => ({ name: trendRowName(name), data: history.trends[name], published_at: publishedAt }));
    const { error: tError } = await client.from("history_files").upsert(rows, { onConflict: "name" });
    // 23514: the name check still allows only the four shared files.
    if (tError) fail(`trend files: ${tError.message}${tError.code === "23514" ? `. Apply ${TREND_FILES_MIGRATION} first.` : ""}`);
  }
  const stale = Object.keys(await fetchAllTrendFiles(client)).filter((name) => !(name in history.trends));
  if (stale.length) {
    const { error: dError } = await client.from("history_files").delete().in("name", stale.map(trendRowName));
    if (dError) fail(`removing old trend files: ${dError.message}`);
  }
  const backTrends = await fetchAllTrendFiles(client);
  if (!same(Object.keys(backTrends).sort(), trendNames) || trendNames.some((n) => !same(backTrends[n], history.trends[n]))) {
    fail("trend files differ after reading back.");
  }
  console.log(`Published ${trendNames.length} trend files${stale.length ? ` (removed ${stale.length} old)` : ""}; read back and verified.`);
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

// 5c. Short names and nicknames (school_aliases; specs/school-identity/aliases.md). One transaction: small enough
// (~400 KB today) that it doesn't need the batching schools and history required.
if (aliases) {
  const n = await publishAliases(client, aliases).catch((err: Error) => fail(err.message));
  console.log(`Published ${n} short names (school_aliases); read back and verified.`);
} else {
  console.log("No data/aliases.json (run npm run sync-data); short names not published.");
}

// 5d. High schools (rows with state reports merged in, profile details, meta, medians).
if (!highSchools) {
  console.log("No data/high-schools/ (run npm run sync-high-schools); high schools not published.");
} else if (highSchoolsProblem) {
  console.warn(`Warning: high schools not published: ${highSchoolsProblem}`);
} else {
  const r = await publishHighSchools(client, highSchools).catch((err: Error) => fail(err.message));
  console.log(`Published ${r.schools} high schools and ${r.details} profile details${r.removed ? ` (removed ${r.removed} old)` : ""}; read back and verified.`);
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
