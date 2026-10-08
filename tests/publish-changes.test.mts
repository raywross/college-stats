/**
 * The change-log publish (scripts/publish-changes.mts, scripts/lib/publish-changes.mts; specs/serving-architecture.md
 * section 2): both datasets read from git blobs (a stubbed `git show`), the diff, the first publish, the dry run, the
 * default base, and a re-run that is reused. The SQL side (publish_changes, the retire migration) is checked against
 * PGlite in tests/follows-policies.test.mts. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { ReleaseCalendar } from "../lib/releases";
import {
  DATASET_PATHS,
  computeChanges,
  gitAccess,
  newestPublishedCommit,
  publishChanges,
  readDatasetAt,
  type GitAccess,
  type PublishResult,
} from "../scripts/lib/publish-changes.mts";

const ROOT = join(import.meta.dirname, "..");
const SCHOOLS = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const META = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8")) as DatasetMeta;
const CALENDAR = JSON.parse(readFileSync(join(ROOT, "data", "release-calendar.json"), "utf8")) as ReleaseCalendar;

const BASE = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const HEAD = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

/** Two real colleges; at HEAD the first one's admissions figures are revised and the second one is renamed. */
function fixtureSchools(revised: boolean): School[] {
  const [a, b] = structuredClone(SCHOOLS.slice(0, 2));
  a.admissions.applicants = 1000;
  a.admissions.admitted = revised ? 96 : 98;
  a.admissions.acceptance_rate = revised ? 0.096 : 0.098;
  if (revised) b.name = `${b.name} (renamed)`;
  return [a, b];
}

/** A repository in memory: sha → path → file text; refs resolve to shas. Records every read. */
function fakeGit(commits: Record<string, { schools: School[]; meta: DatasetMeta; calendar: ReleaseCalendar }>, refs: Record<string, string> = {}) {
  const reads: string[] = [];
  const git: GitAccess = {
    readAt(sha, path) {
      reads.push(`${sha.slice(0, 4)}:${path}`);
      const c = commits[sha];
      if (!c) throw new Error(`fatal: invalid object name '${sha}'`);
      const byPath: Record<string, unknown> = { [DATASET_PATHS.schools]: c.schools, [DATASET_PATHS.meta]: c.meta, [DATASET_PATHS.calendar]: c.calendar };
      if (!(path in byPath)) throw new Error(`fatal: path '${path}' does not exist in '${sha}'`);
      return JSON.stringify(byPath[path]);
    },
    exists: (sha) => sha in commits,
    resolve(ref) {
      const sha = refs[ref] ?? (ref in commits ? ref : null);
      if (!sha) throw new Error(`${ref} is not a commit in this repository`);
      return sha;
    },
  };
  return { git, reads };
}

const TWO_COMMITS = {
  [BASE]: { schools: fixtureSchools(false), meta: META, calendar: CALENDAR },
  [HEAD]: { schools: fixtureSchools(true), meta: META, calendar: CALENDAR },
};

/**
 * A Supabase client in memory with the calls publish-changes makes: dataset_publishes (newest first, paged), the
 * change-table check, the two RPCs, and the read-back count. Records every call.
 */
function fakeClient({ publishes = [] as { id: number; git_commit: string | null }[], result = null as PublishResult | null, readBack = null as number | null } = {}) {
  const calls: string[] = [];
  const staged: unknown[][] = [];
  const client = {
    from(table: string) {
      if (table === "dataset_publishes") {
        const q = {
          select: () => q,
          not: () => q,
          order: () => q,
          range: async (from: number, to: number) => {
            calls.push(`read dataset_publishes ${from}-${to}`);
            const rows = [...publishes].filter((p) => p.git_commit !== null).sort((x, y) => y.id - x.id);
            return { data: rows.slice(from, to + 1), error: null };
          },
        };
        return q;
      }
      if (table === "dataset_change_staging") {
        return { select: () => ({ limit: async () => (calls.push("check dataset_change_staging"), { error: null }) }) };
      }
      if (table === "dataset_changes") {
        return {
          select: () => ({
            eq: (_col: string, id: number) => ({ limit: async () => (calls.push(`count dataset_changes ${id}`), { count: readBack, error: null }) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push(`rpc ${fn}`);
      if (fn === "stage_dataset_changes") {
        staged.push(args.p_changes as unknown[]);
        return { data: (args.p_changes as unknown[]).length, error: null };
      }
      if (fn === "publish_changes") {
        calls.push(`  ${JSON.stringify(args)}`);
        return { data: result, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { client: client as never, calls, staged };
}

const quiet = () => {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
};

test("the diff comes from the two commits' data files, read from git", async () => {
  const { git, reads } = fakeGit(TWO_COMMITS);
  const out = quiet();
  const r = await publishChanges({ git, head: HEAD, base: BASE, dryRun: true, client: null, publishedBy: "test", log: out.log });
  const expected = computeChanges(
    { schools: TWO_COMMITS[BASE].schools, meta: META },
    { schools: TWO_COMMITS[HEAD].schools, meta: META },
    CALENDAR,
  );
  assert.ok(expected.length >= 2, "fixture: a revised figure and a new name");
  assert.deepEqual(r.changes, expected);
  assert.equal(r.changes.find((c) => c.field === "admissions.acceptance_rate")?.kind, "revised");
  assert.ok(r.changes.some((c) => c.field === "name" && c.unit_id === TWO_COMMITS[HEAD].schools[1].unit_id), "the rename is a change");
  assert.deepEqual({ head: r.head, base: r.base }, { head: HEAD, base: BASE });
  assert.deepEqual(reads.sort(), [`aaaa:${DATASET_PATHS.calendar}`, `aaaa:${DATASET_PATHS.meta}`, `aaaa:${DATASET_PATHS.schools}`, `bbbb:${DATASET_PATHS.calendar}`, `bbbb:${DATASET_PATHS.meta}`, `bbbb:${DATASET_PATHS.schools}`].sort());
  assert.ok(out.lines.some((l) => l.startsWith(`Changes since ${BASE.slice(0, 12)}: ${expected.length} changes (`)), out.lines.join("\n"));
});

test("a missing data file at a commit names the file and the commit", () => {
  const { git } = fakeGit(TWO_COMMITS);
  const noMeta = (sha: string, path: string) => {
    if (path === DATASET_PATHS.meta) throw new Error("fatal: path does not exist\nmore");
    return git.readAt(sha, path);
  };
  assert.throws(() => readDatasetAt(noMeta, BASE), /reading data\/meta\.json at aaaa1111aaaa: fatal: path does not exist$/);
});

test("the first publish: no earlier commit recorded, so no changes, but the publish is still recorded", async () => {
  const { git } = fakeGit({ [HEAD]: TWO_COMMITS[HEAD] }, { HEAD });
  const { client, calls, staged } = fakeClient({ publishes: [], result: { publish_id: 1, changes: 0, reused: false }, readBack: 0 });
  const out = quiet();
  const r = await publishChanges({ git, head: "HEAD", dryRun: false, client, publishedBy: "octocat", log: out.log });
  assert.equal(r.base, null);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(staged, [[]], "staging is still reset once");
  const publishCall = calls[calls.indexOf("rpc publish_changes") + 1];
  assert.deepEqual(JSON.parse(publishCall), {
    p_school_count: 2,
    p_retrieved: META.retrieved,
    p_git_commit: HEAD,
    p_published_by: "octocat",
    p_expected_changes: 0,
  });
  assert.ok(calls.includes("count dataset_changes 1"), "the count is read back");
  assert.ok(out.lines.some((l) => l.startsWith("First publish")), out.lines.join("\n"));
});

test("a publish stages the changes, records them, and reads the count back; a wrong count fails", async () => {
  const { git } = fakeGit(TWO_COMMITS);
  const expected = computeChanges({ schools: TWO_COMMITS[BASE].schools, meta: META }, { schools: TWO_COMMITS[HEAD].schools, meta: META }, CALENDAR);
  const ok = fakeClient({ publishes: [{ id: 7, git_commit: BASE }], result: { publish_id: 8, changes: expected.length, reused: false }, readBack: expected.length });
  const out = quiet();
  const r = await publishChanges({ git, head: HEAD, dryRun: false, client: ok.client, publishedBy: "t", log: out.log });
  assert.equal(r.base, BASE, "the base defaults to the last recorded commit");
  assert.deepEqual(ok.staged, [expected]);
  assert.deepEqual(r.result, { publish_id: 8, changes: expected.length, reused: false });
  assert.ok(out.lines.some((l) => l.startsWith(`Recorded ${expected.length} changes`)), out.lines.join("\n"));

  const short = fakeClient({ publishes: [{ id: 7, git_commit: BASE }], result: { publish_id: 8, changes: expected.length, reused: false }, readBack: 0 });
  await assert.rejects(publishChanges({ git, head: HEAD, dryRun: false, client: short.client, publishedBy: "t", log: quiet().log }), /read back 0 rows, expected/);
});

test("a re-run for a commit already recorded prints reused and checks nothing more", async () => {
  const { git } = fakeGit(TWO_COMMITS);
  const { client, calls } = fakeClient({ publishes: [{ id: 8, git_commit: HEAD }, { id: 7, git_commit: BASE }], result: { publish_id: 8, changes: 3, reused: true } });
  const out = quiet();
  const r = await publishChanges({ git, head: HEAD, dryRun: false, client, publishedBy: "t", log: out.log });
  assert.equal(r.base, HEAD, "the newest recorded commit is the head itself");
  assert.deepEqual(r.changes, []);
  assert.equal(r.result?.reused, true);
  assert.ok(out.lines.some((l) => l.startsWith("reused:")), out.lines.join("\n"));
  assert.ok(!calls.some((c) => c.startsWith("count dataset_changes")));
});

test("a dry run prints the summary and the change list and writes nothing", async () => {
  const { git } = fakeGit(TWO_COMMITS);
  // The client would accept a publish, so only the dry run itself keeps it from writing.
  const { client, calls } = fakeClient({ publishes: [{ id: 7, git_commit: BASE }], result: { publish_id: 8, changes: 0, reused: true } });
  const out = quiet();
  const r = await publishChanges({ git, head: HEAD, dryRun: true, client, publishedBy: "t", log: out.log });
  assert.deepEqual(calls, ["read dataset_publishes 0-99"], "only the base is read; nothing staged or published");
  assert.equal(r.result, null);
  assert.ok(r.changes.length > 0);
  assert.ok(out.lines.includes(`${TWO_COMMITS[HEAD].schools[0].name} (${TWO_COMMITS[HEAD].schools[0].unit_id})`), "the list, college by college");
  assert.equal(out.lines.at(-1), "Nothing written (--dry-run).");

  // Without Supabase and without --base, a dry run diffs as a first publish.
  const none = quiet();
  const first = await publishChanges({ git, head: HEAD, dryRun: true, client: null, publishedBy: "t", log: none.log });
  assert.equal(first.base, null);
  assert.deepEqual(first.changes, []);
  // A real publish needs the client.
  await assert.rejects(publishChanges({ git, head: HEAD, dryRun: false, client: null, publishedBy: "t", log: quiet().log }), /needs SUPABASE_URL/);
});

test("the default base is the newest recorded commit that exists in the repository", async () => {
  const exists = (sha: string) => sha === BASE || sha === "cccc3333";
  const rows = [
    { id: 9, git_commit: "dddd4444" }, // a branch never merged here
    { id: 8, git_commit: `${BASE}+uncommitted` }, // a local publish of uncommitted data
    { id: 7, git_commit: null },
    { id: 6, git_commit: BASE },
    { id: 5, git_commit: "cccc3333" },
  ];
  assert.equal(await newestPublishedCommit(fakeClient({ publishes: rows }).client, exists), BASE);
  assert.equal(await newestPublishedCommit(fakeClient({ publishes: [] }).client, exists), null);
  assert.equal(await newestPublishedCommit(fakeClient({ publishes: [{ id: 1, git_commit: "dddd4444" }] }).client, exists), null);
  // Paged: the only one that exists is on the third page.
  const many = Array.from({ length: 250 }, (_, i) => ({ id: 1000 - i, git_commit: `eeee${String(i).padStart(4, "0")}` }));
  many.push({ id: 1, git_commit: "cccc3333" });
  const paged = fakeClient({ publishes: many });
  assert.equal(await newestPublishedCommit(paged.client, exists), "cccc3333");
  assert.deepEqual(paged.calls, ["read dataset_publishes 0-99", "read dataset_publishes 100-199", "read dataset_publishes 200-299"]);
});

test("the real git access reads this repository's files at HEAD", () => {
  const git = gitAccess(ROOT);
  const head = git.resolve("HEAD");
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(git.exists(head), true);
  assert.equal(git.exists("0".repeat(40)), false);
  assert.throws(() => git.resolve("no-such-ref-here"), /not a commit in this repository/);
  const meta = JSON.parse(git.readAt(head, DATASET_PATHS.meta)) as DatasetMeta;
  assert.equal(typeof meta.retrieved, "string");
});

test("without SUPABASE_URL/SUPABASE_SECRET_KEY the script says so and exits 0", () => {
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SECRET_KEY;
  const out = execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "publish-changes.mts")], { cwd: ROOT, env, encoding: "utf8" });
  assert.match(out, /SUPABASE_URL or SUPABASE_SECRET_KEY is not set; no changes recorded/);
});

/* ------------------------------------------------------------------ */
/* Guard: nothing still writes or reads a retired table                */
/* ------------------------------------------------------------------ */

/** Tables and functions dropped by supabase/migrations/20261007130000_retire_dataset_tables.sql. */
const RETIRED = [
  "schools", "dataset_files", "school_staging", "school_histories", "history_files", "history_staging", "school_details", "detail_staging", "school_aliases",
  "publish_dataset", "stage_schools", "publish_schools_staged", "publish_schools_staged_with_changes", "stage_history", "publish_history",
  "publish_history_staged", "stage_details", "publish_details_staged", "publish_aliases",
];

/** `.from("<retired table>")` or `.rpc("<retired function>")` in a file's source. */
function retiredUses(source: string): string[] {
  return [...source.matchAll(new RegExp(`\\.(?:from|rpc)\\(\\s*["'\`](${RETIRED.join("|")})["'\`]`, "g"))].map((m) => m[0]);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.m?tsx?$/.test(name) ? [path] : [];
  });
}

/** Lines that make a HEAD request (`head: true`), outside comments. */
const headRequests = (source: string) => source.split("\n").filter((line) => line.includes("head: true") && !/^\s*(\*|\/\/)/.test(line));

test("guard: the publish scripts check tables with a one-row select, never head: true (a missing table looks fine to HEAD)", () => {
  for (const file of ["scripts/publish-changes.mts", "scripts/lib/publish-changes.mts", "scripts/publish-high-schools.mts", "scripts/lib/publish-high-schools.mts"]) {
    assert.deepEqual(headRequests(readFileSync(join(ROOT, file), "utf8")), [], `${file}: table checks must not use head: true`);
  }
  assert.deepEqual(headRequests(`  const { error } = await client.from("dataset_change_staging").select("unit_id", { head: true });`).length, 1, "the check itself");
});

test("guard: no script and not the digest job touches a retired dataset table or function", () => {
  const files = [...walk(join(ROOT, "scripts")), join(ROOT, "app", "api", "cron", "digests", "route.ts")];
  const found = files.flatMap((f) => retiredUses(readFileSync(f, "utf8")).map((u) => `${f.slice(ROOT.length + 1)}: ${u}`));
  assert.deepEqual(found, []);
  // The check itself: a lookup in the schools table, as the digest job did, is caught.
  assert.deepEqual(retiredUses(`client.from("schools").select("unit_id, name")`), [`.from("schools"`]);
  assert.deepEqual(retiredUses(`client.rpc('publish_schools_staged_with_changes', {})`), [`.rpc('publish_schools_staged_with_changes'`]);
  assert.deepEqual(retiredUses(`client.from("high_schools")`), []);
});
