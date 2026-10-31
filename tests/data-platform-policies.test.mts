/**
 * The data platform's access rules against real Postgres (PGlite, every migration; specs/data-platform/storage.md
 * "Row-level security" and "Functions"): anyone, signed in or not, selects every data_* table; nobody writes one
 * directly, the service role included; the data_*() functions answer the service role only; every admin_data_*()
 * function refuses a non-admin and an admin at aal1 with "admin only" and logs nothing; admin_log takes the new target
 * kinds; the snapshots bucket and its policies are made where Storage exists and skipped where it doesn't. Guard tests
 * break a rule on purpose. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_ADMIN_MIGRATION,
  DATA_MIGRATION,
  anon,
  bootDataDb,
  close,
  doc,
  errorOf,
  openSet,
  run,
  service,
  user,
  write,
  type Caller,
  type DataWorld,
} from "./helpers/data-platform-db.mts";

const TABLES = ["data_change_sets", "data_snapshots", "data_documents", "data_document_versions", "data_field_edits"];

/** One row in every table, written the way the platform writes them. */
async function seed(w: DataWorld) {
  const set = await openSet(w.db, "sync-data");
  await write(w.db, set, [doc("base.colleges", "100654", { name: "AAMU" }), doc("reported.review_queue", "100654||", { unit_id: "100654" })]);
  await close(w.db, set);
  await run(w.db, user(w.quinn), "select public.admin_data_edit('100654', 'name', '\"AAMU\"', null)");
  await run(w.db, service, "select public.data_begin_snapshot($1, null)", [[set]]);
  return { set };
}

/** Each data_*() function, called with real ids. */
const dataCalls = (set: number): [string, string, unknown[]][] => [
  ["data_open_change_set", "select public.data_open_change_set('pipeline', 'x', null, '{}')", []],
  ["data_write_documents", "select public.data_write_documents($1, '[]')", [set]],
  ["data_change_set_counts", "select public.data_change_set_counts($1)", [set]],
  ["data_close_change_set", "select public.data_close_change_set($1, 'applied')", [set]],
  ["data_read_collection", "select * from public.data_read_collection('base.colleges')", []],
  ["data_begin_snapshot", "select public.data_begin_snapshot('{}', null)", []],
  ["data_finish_snapshot", "select public.data_finish_snapshot(1, 'failed', null, null)", []],
];

/** Each admin_data_*() function, called with real ids so a missing guard would get past the refusal. */
const adminCalls = (set: number): [string, string, unknown[]][] => [
  ["admin_data_edit", "select public.admin_data_edit('100654', 'name', '\"Hacked\"', null)", []],
  ["admin_data_release_edit", "select public.admin_data_release_edit((select max(id) from public.data_field_edits))", []],
  ["admin_data_hold", "select public.admin_data_hold($1, 'hold')", [set]],
  ["admin_data_unhold", "select public.admin_data_unhold($1)", [set]],
  ["admin_data_revert", "select public.admin_data_revert($1, null)", [set]],
  ["admin_data_resolve_review", "select public.admin_data_resolve_review('100654||', 'rejected', null)", []],
  ["admin_data_point_snapshot", "select public.admin_data_point_snapshot((select max(id) from public.data_snapshots))", []],
  ["admin_data_set_reference", "select public.admin_data_set_reference('calendar', '{}', null)", []],
];

async function refusalProblems(w: DataWorld, set: number): Promise<string[]> {
  const problems: string[] = [];
  const callers: [string, Caller][] = [["a non-admin", user(w.eve)], ["the admin at aal1", user(w.quinn, "aal1")]];
  for (const [name, sql, params] of adminCalls(set)) {
    for (const [label, who] of callers) {
      const message = await errorOf(run(w.db, who, sql, params));
      if (message !== "admin only") problems.push(`${name} for ${label}: ${message}`);
    }
  }
  return problems;
}

test("anyone selects every data_* table; nobody inserts, updates or deletes one directly (the service role neither)", async () => {
  const w = await bootDataDb();
  await seed(w);
  for (const table of TABLES) {
    const total = Number((await w.db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n);
    assert.ok(total > 0, `${table}: seed it`);
    for (const [label, who] of [["anon", anon], ["a signed-in user", user(w.eve)], ["the admin", user(w.quinn)], ["the service role", service]] as const) {
      const n = Number((await run<{ n: number }>(w.db, who, `select count(*)::int as n from public.${table}`))[0].n);
      assert.equal(n, total, `${table} for ${label}`);
    }
    for (const [label, who] of [["anon", anon], ["a signed-in user", user(w.eve)], ["the admin", user(w.quinn)], ["the service role", service]] as const) {
      for (const sql of [`update public.${table} set created_at = now()`, `delete from public.${table}`, `insert into public.${table} default values`]) {
        const statement = table === "data_documents" ? sql.replace("created_at", "updated_at") : sql;
        assert.match(await errorOf(run(w.db, who, statement)), /permission denied/, `${statement} as ${label}`);
      }
    }
  }
});

test("the data_*() functions answer the service role only", async () => {
  const w = await bootDataDb();
  const { set } = await seed(w);
  const open = await openSet(w.db);
  for (const [name, sql, params] of dataCalls(open)) {
    for (const [label, who] of [["anon", anon], ["a signed-in user", user(w.eve)], ["the admin", user(w.quinn)]] as const) {
      assert.match(await errorOf(run(w.db, who, sql, params)), /permission denied for function/, `${name} as ${label}`);
    }
    assert.doesNotMatch(await errorOf(run(w.db, service, sql, params)), /permission denied/, `${name} as the service role`);
  }
  // Every data_* function in the database is in the list.
  const covered = new Set(dataCalls(set).map(([name]) => name));
  const all = (await w.db.query<{ proname: string }>("select distinct proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'data\\_%'")).rows.map((r) => r.proname);
  assert.deepEqual(all.filter((n) => !covered.has(n)).sort(), []);
});

test("every admin_data_*() function refuses a non-admin and an admin at aal1 with 'admin only', and logs nothing", async () => {
  const w = await bootDataDb();
  const { set } = await seed(w);
  const before = Number((await w.db.query<{ n: number }>("select count(*)::int as n from public.admin_log")).rows[0].n);
  assert.deepEqual(await refusalProblems(w, set), []);
  assert.equal(Number((await w.db.query<{ n: number }>("select count(*)::int as n from public.admin_log")).rows[0].n), before);
  for (const [name, sql, params] of adminCalls(set)) {
    assert.match(await errorOf(run(w.db, anon, sql, params)), /permission denied for function/, `${name} as anon`);
  }
  const covered = new Set(adminCalls(set).map(([name]) => name));
  const all = (await w.db.query<{ proname: string }>("select distinct proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\\_data\\_%'")).rows.map((r) => r.proname);
  assert.deepEqual(all.filter((n) => !covered.has(n)), []);
});

test("admin_log takes the data platform's target kinds and still refuses an unknown one", async () => {
  const w = await bootDataDb();
  for (const kind of ["user", "college", "change_set", "snapshot", "document"]) {
    await w.db.query("insert into public.admin_log (action, target_kind) values ('data.edit', $1)", [kind]);
  }
  assert.match(await errorOf(w.db.query("insert into public.admin_log (action, target_kind) values ('data.edit', 'table')")), /admin_log_target_kind_check/);
});

test("the snapshots bucket: public, with read for everyone and writes for the service role; skipped without Storage", async () => {
  const w = await bootDataDb({ storage: true });
  assert.deepEqual((await w.db.query("select id, name, public from storage.buckets")).rows, [{ id: "snapshots", name: "snapshots", public: true }]);
  const policies = (await w.db.query<{ policyname: string; cmd: string; roles: string[] }>("select policyname, cmd, roles::text[] as roles from pg_policies where schemaname = 'storage' order by policyname")).rows;
  assert.deepEqual(policies.map((p) => [p.policyname, p.cmd, [...p.roles].sort()]), [
    ["snapshots_read", "SELECT", ["anon", "authenticated", "service_role"]],
    ["snapshots_write", "ALL", ["service_role"]],
  ]);
  // Applying the bucket block again changes nothing (it is guarded).
  const block = (await import("node:fs")).readFileSync(new URL(`../supabase/migrations/${DATA_MIGRATION}`, import.meta.url), "utf8");
  await w.db.exec(block.slice(block.indexOf("do $$")));
  assert.equal((await w.db.query("select * from storage.buckets")).rows.length, 1);
  // Without the storage schema the migration still applies (bootDataDb() above, in every other test).
  const bare = await bootDataDb();
  assert.equal((await bare.db.query("select 1 from pg_namespace where nspname = 'storage'")).rows.length, 0);
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

test("guard: dropping the is_admin() line from one admin_data function is caught by the refusal check", async () => {
  const guard = "  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;\n";
  const w = await bootDataDb({ transform: { file: DATA_ADMIN_MIGRATION, edit: (sql) => {
    const at = sql.indexOf(guard, sql.indexOf("create function public.admin_data_hold"));
    return sql.slice(0, at) + sql.slice(at + guard.length);
  } } });
  const { set } = await seed(w);
  const problems = await refusalProblems(w, set);
  assert.ok(problems.some((p) => p.startsWith("admin_data_hold for a non-admin")), problems.join("\n"));
});

test("guard: a select policy left off a table is caught by the read check", async () => {
  const w = await bootDataDb({ transform: { file: DATA_MIGRATION, edit: (sql) => sql.replace(/create policy data_field_edits_read[^\n]+\n/, "") } });
  await seed(w);
  const n = Number((await run<{ n: number }>(w.db, anon, "select count(*)::int as n from public.data_field_edits"))[0].n);
  assert.equal(n, 0, "without its policy anon reads nothing, so the main test's count fails");
});

test("guard: a data_*() function granted to authenticated is caught by the privilege check", async () => {
  const w = await bootDataDb({ transform: { file: DATA_MIGRATION, edit: (sql) => sql + "\ngrant execute on function public.data_open_change_set(text, text, text, jsonb) to authenticated;\n" } });
  assert.doesNotMatch(await errorOf(run(w.db, user(w.eve), "select public.data_open_change_set('pipeline', 'x', null, '{}')")), /permission denied/);
});
