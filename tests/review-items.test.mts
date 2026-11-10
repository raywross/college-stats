/**
 * The review queue's read model against real Postgres (PGlite, every migration; supabase/migrations/
 * 20261110120000_admin_speed.sql, specs/data-platform/change-sets.md "The review queue's read model"): writing a
 * `reported.review_queue` document through data_write_documents keeps `review_items` current (insert, a resolution
 * moving the status, a delete), other collections write no row, a document the sync can't read is left out with a
 * warning while the write still commits, the backfill gives the trigger's rows, and the two console functions return
 * the light items (no `extraction`) in key order and the counts with the newest write. The newest-write index exists.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootDataDb, close, doc, migrationSql, openSet, rawDoc, run, service, anon, user, value, type DataWorld } from "./helpers/data-platform-db.mts";

const MIGRATION = "20261110120000_admin_speed.sql";
const Q = "reported.review_queue";

type Row = { key: string; unit_id: string; edition: string | null; code: string | null; sha256: string | null; status: string; checks: string[]; queued: string | null; body: Record<string, unknown>; version: number; updated_at: string };

const rows = async (w: DataWorld) =>
  (await w.db.query<Row>("select key, unit_id, edition, code, sha256, status, checks, queued::text as queued, body, version, updated_at::text as updated_at from public.review_items order by key")).rows;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const item = (unit: string, edition: string, code: string, extra: Record<string, unknown> = {}) => ({
  unit_id: unit,
  name: `College ${unit}`,
  urls: [`https://example.edu/${unit}/cds.pdf`],
  entering_term: "Fall 2025",
  failures: [
    { check: "range", detail: "too big" },
    { check: "sum", detail: "no" },
    { check: "range", detail: "again" },
  ],
  queued: today(),
  run: "run-1",
  code,
  edition,
  sha256: `sha-${unit}`,
  value: 42,
  ...extra,
});

/** Writes documents in one applied change set, collecting the warnings Postgres raised. */
async function writeAll(w: DataWorld, docs: unknown[]): Promise<{ written: number; warnings: string[] }> {
  const set = await openSet(w.db);
  const warnings: string[] = [];
  const written = await w.db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    const r = await tx.query<{ v: number }>("select public.data_write_documents($1, $2) as v", [set, JSON.stringify(docs)], {
      onNotice: (n) => {
        if (n.severity === "WARNING") warnings.push(n.message ?? "");
      },
    });
    return r.rows[0].v;
  });
  await close(w.db, set);
  return { written, warnings };
}

test("the migration: the newest-write index, the table with row-level security, both triggers, the two functions", async () => {
  const w = await bootDataDb();
  const indexes = (await w.db.query<{ indexname: string; indexdef: string }>("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('data_documents', 'review_items')")).rows;
  const byName = new Map(indexes.map((i) => [i.indexname, i.indexdef]));
  assert.match(byName.get("data_documents_collection_updated") ?? "", /\(collection, updated_at DESC\)/);
  for (const name of ["review_items_pkey", "review_items_status_queued", "review_items_unit", "review_items_updated", "review_items_checks"]) assert.ok(byName.has(name), name);
  assert.match(byName.get("review_items_checks") ?? "", /USING gin \(checks\)/);
  const rls = (await w.db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.review_items'::regclass")).rows[0];
  assert.equal(rls.relrowsecurity, true);
  const triggers = (await w.db.query<{ tgname: string }>("select tgname from pg_trigger where tgrelid = 'public.data_documents'::regclass and not tgisinternal order by tgname")).rows.map((r) => r.tgname);
  assert.deepEqual(triggers.filter((t) => t.startsWith("review_items")), ["review_items_sync", "review_items_sync_delete"]);
  // Idempotent: applying the file again changes nothing and doesn't fail.
  await w.db.exec(migrationSql(MIGRATION));
});

test("a queue document written through data_write_documents is a row: key parts, status, distinct checks in order, queued, version", async () => {
  const w = await bootDataDb();
  const { warnings } = await writeAll(w, [doc(Q, "100654|2025-26|C.116", item("100654", "2025-26", "C.116")), doc(Q, "100663||", { unit_id: "100663", name: "UAB", urls: [], entering_term: null, failures: [{ check: "unreachable", detail: "404" }], queued: "not a date", run: "r" })]);
  assert.deepEqual(warnings, []);
  const [a, b] = await rows(w);
  assert.equal(a.key, "100654|2025-26|C.116");
  assert.equal(a.unit_id, "100654");
  assert.equal(a.edition, "2025-26");
  assert.equal(a.code, "C.116");
  assert.equal(a.sha256, "sha-100654");
  assert.equal(a.status, "open");
  assert.deepEqual(a.checks, ["range", "sum"]);
  assert.equal(a.queued, today());
  assert.equal(a.version, 1);
  assert.equal(a.body.value, 42);
  assert.equal(b.key, "100663||");
  assert.equal(b.edition, null);
  assert.equal(b.code, null);
  assert.equal(b.queued, null, "a queued that doesn't parse is null");
  assert.deepEqual(b.checks, ["unreachable"]);
});

test("a resolution moves the status, a delete removes the row, another collection writes none", async () => {
  const w = await bootDataDb();
  const key = "100654|2025-26|H.210";
  await writeAll(w, [doc(Q, key, item("100654", "2025-26", "H.210")), doc("reported.failures", "100654", [{ reason_code: "x" }])]);
  assert.deepEqual((await rows(w)).map((r) => r.key), [key], "only the queue's document is a row");

  await writeAll(w, [doc(Q, key, item("100654", "2025-26", "H.210", { resolved: "rejected", resolved_on: today() }))]);
  let [r] = await rows(w);
  assert.equal(r.status, "rejected");
  assert.equal(r.version, 2);

  // The console's resolution path (admin_data_resolve_review) writes the document; the row follows.
  await writeAll(w, [doc(Q, key, item("100654", "2025-26", "H.210"))]);
  assert.equal((await rows(w))[0].status, "open");
  await run(w.db, user(w.quinn), "select public.admin_data_resolve_review($1, 'accepted', 'ok')", [key]);
  [r] = await rows(w);
  assert.equal(r.status, "accepted");
  assert.equal(r.body.resolved_note, "ok");

  // A status that isn't one of the three reads as open.
  await writeAll(w, [doc(Q, key, item("100654", "2025-26", "H.210", { resolved: "maybe" }))]);
  assert.equal((await rows(w))[0].status, "open");

  await writeAll(w, [doc(Q, key, null)]);
  assert.deepEqual(await rows(w), []);
});

test("a document the sync can't read is left out with a warning, and the document write still commits", async () => {
  const w = await bootDataDb();
  const good = "100654|2025-26|C.116";
  const bad = "100663|2025-26|C.116";
  await writeAll(w, [doc(Q, bad, item("100663", "2025-26", "C.116"))]);
  assert.equal((await rows(w)).length, 1);

  // `failures` a string: data_write_documents accepts the body (an object), the sync can't read it.
  const { written, warnings } = await writeAll(w, [doc(Q, good, item("100654", "2025-26", "C.116")), doc(Q, bad, { ...item("100663", "2025-26", "C.116"), failures: "range" })]);
  assert.equal(written, 2);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /^review_items_sync: .*failures is not an array.*100663\|2025-26\|C\.116/);
  const stored = (await w.db.query<{ key: string; version: number }>("select key, version from public.data_documents where collection = $1 order by key", [Q])).rows;
  assert.deepEqual(stored, [{ key: good, version: 1 }, { key: bad, version: 2 }], "both documents were written");
  assert.deepEqual((await rows(w)).map((r) => r.key), [good], "the unreadable one's old row is gone, the good one is there");

  // An array body (valid for data_write_documents) is left out the same way.
  const r2 = await writeAll(w, [rawDoc(Q, "100706||", "[1,2]")]);
  assert.equal(r2.written, 1);
  assert.equal(r2.warnings.length, 1);
  assert.deepEqual((await rows(w)).map((r) => r.key), [good]);
});

test("the backfill gives the same rows as the trigger", async () => {
  const w = await bootDataDb();
  await writeAll(w, [
    doc(Q, "100654|2025-26|C.116", item("100654", "2025-26", "C.116")),
    doc(Q, "100663||", { unit_id: "100663", name: "UAB", urls: [], entering_term: null, failures: [], queued: daysAgo(30), run: "r", resolved: "accepted" }),
    doc(Q, "100706|2024-25|H.210", item("100706", "2024-25", "H.210", { failures: null })),
  ]);
  const byTrigger = await rows(w);
  assert.equal(byTrigger.length, 3);
  // Empty the table as the owner, then apply the migration again: its backfill rebuilds every row.
  await w.db.exec("delete from public.review_items");
  await w.db.exec(migrationSql(MIGRATION));
  assert.deepEqual(await rows(w), byTrigger);
  // A stray row whose document is gone is removed by the backfill.
  await w.db.exec("insert into public.review_items (key, unit_id, status, body, version, updated_at) values ('999999||', '999999', 'open', '{}', 1, now())");
  await w.db.exec(migrationSql(MIGRATION));
  assert.deepEqual(await rows(w), byTrigger);
});

test("review_items_light: the light fields in key order, no extraction, absent fields stay absent; by status or every status", async () => {
  const w = await bootDataDb();
  const c1 = { unit_id: "100663", name: "UAB", urls: ["https://uab.edu/cds.pdf"], entering_term: "Fall 2025", extraction: { applicants: 100, admitted: 50, enrolled: 20 }, failures: [{ check: "sum", detail: "x" }], queued: today(), run: "r" };
  await writeAll(w, [
    doc(Q, "100706|2025-26|C.901", item("100706", "2025-26", "C.901", { resolved: "rejected", resolved_on: today(), resolved_note: "no" })),
    doc(Q, "100663||", c1),
    doc(Q, "100654|2025-26|C.116", item("100654", "2025-26", "C.116", { extra_field: "not light" })),
  ]);
  const open = await value<Record<string, unknown>[]>(w.db, user(w.eve), "public.review_items_light()");
  assert.deepEqual(open.map((i) => i.key), ["100654|2025-26|C.116", "100663||"]);
  assert.deepEqual(Object.keys(open[0]).sort(), ["code", "edition", "entering_term", "failures", "key", "name", "queued", "run", "sha256", "unit_id", "urls", "value"]);
  assert.deepEqual(open[1], { key: "100663||", ...(({ extraction: _, ...rest }) => rest)(c1) });
  const all = await value<Record<string, unknown>[]>(w.db, anon, "public.review_items_light(null)");
  assert.deepEqual(all.map((i) => i.key), ["100654|2025-26|C.116", "100663||", "100706|2025-26|C.901"]);
  assert.equal(all[2].resolved, "rejected");
  assert.equal(all[2].resolved_note, "no");
  const rejected = await value<unknown[]>(w.db, service, "public.review_items_light('rejected')");
  assert.equal(rejected.length, 1);
  assert.deepEqual(await value<unknown[]>(w.db, service, "public.review_items_light('accepted')"), []);
});

test("review_items_counts: open, accepted, rejected, new this week, and the newest write; zeros and null when empty", async () => {
  const w = await bootDataDb();
  assert.deepEqual(await value(w.db, anon, "public.review_items_counts()"), { open: 0, accepted: 0, rejected: 0, new_week: 0, newest: null });
  await writeAll(w, [
    doc(Q, "1|a|C.1", item("1", "a", "C.1")),
    doc(Q, "2|a|C.1", item("2", "a", "C.1", { queued: daysAgo(30) })),
    doc(Q, "3|a|C.1", item("3", "a", "C.1", { resolved: "accepted" })),
    doc(Q, "4|a|C.1", item("4", "a", "C.1", { resolved: "rejected" })),
    doc(Q, "5|a|C.1", item("5", "a", "C.1", { resolved: "rejected" })),
  ]);
  const counts = await value<Record<string, unknown>>(w.db, user(w.eve), "public.review_items_counts()");
  const newest = (await w.db.query<{ v: string }>("select to_jsonb(max(updated_at)) #>> '{}' as v from public.data_documents where collection = $1", [Q])).rows[0].v;
  assert.deepEqual(counts, { open: 2, accepted: 1, rejected: 2, new_week: 1, newest });
  assert.match(String(counts.newest), /^\d{4}-\d{2}-\d{2}T/);
});

test("nobody writes review_items directly or calls the sync function; anyone reads it", async () => {
  const w = await bootDataDb();
  await writeAll(w, [doc(Q, "1|a|C.1", item("1", "a", "C.1"))]);
  for (const who of [anon, user(w.eve), user(w.quinn), service]) {
    assert.equal((await run<{ n: number }>(w.db, who, "select count(*)::int as n from public.review_items"))[0].n, 1);
    for (const sql of ["delete from public.review_items", "update public.review_items set status = 'rejected'", "insert into public.review_items (key, unit_id, status, body, version, updated_at) values ('x', 'x', 'open', '{}', 1, now())", "select public.review_items_put('1|a|C.1', null, null, null)"]) {
      await assert.rejects(run(w.db, who, sql), /permission denied/, sql);
    }
  }
});

test("guard: a sync that raises instead of warning blocks the document write (the check above notices)", async () => {
  const w = await bootDataDb({ transform: { file: MIGRATION, edit: (sql) => sql.replaceAll("raise warning 'review_items_sync", "raise exception 'review_items_sync") } });
  await assert.rejects(writeAll(w, [doc(Q, "1|a|C.1", { ...item("1", "a", "C.1"), failures: "range" })]), /review_items_sync/);
  assert.equal((await w.db.query("select 1 from public.data_documents where collection = $1", [Q])).rows.length, 0, "the write rolled back");
});
