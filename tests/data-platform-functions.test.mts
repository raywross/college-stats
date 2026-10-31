/**
 * The data platform's functions against real Postgres (PGlite, every migration; specs/data-platform/storage.md
 * "Functions", change-sets.md "Revert" and "Admin edits"): a change set opens, writes versioned documents (idempotent
 * on an equal body, optimistic on expect_version, deletes keep a deleted version), closes with its summary filled, and
 * then refuses writes; snapshots begin and finish; the console's admin_data_*() functions edit, release, hold, unhold,
 * revert (refusing when a later set touched a document), resolve a review item, point back at a snapshot and replace a
 * reference document, each logging one admin_log row with before and after. Guard tests break a rule on purpose.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_ADMIN_MIGRATION,
  DATA_MIGRATION,
  bootDataDb,
  close,
  codeOf,
  doc,
  errorOf,
  openSet,
  run,
  service,
  user,
  value,
  write,
  type DataWorld,
} from "./helpers/data-platform-db.mts";

type Current = { collection: string; key: string; version: number; body: unknown; change_set_id: string };
type Version = { collection: string; key: string; version: number; body: unknown; deleted: boolean; change_set_id: string };

const current = async (w: DataWorld, collection = "base.colleges") =>
  (await w.db.query<Current>("select collection, key, version, body, change_set_id from public.data_documents where collection = $1 order by key", [collection])).rows;
const versions = async (w: DataWorld, key?: string) =>
  (await w.db.query<Version>(
    "select collection, key, version, body, deleted, change_set_id from public.data_document_versions where $1::text is null or key = $1 order by key, version",
    [key ?? null],
  )).rows;
const setRow = async (w: DataWorld, id: number) =>
  (await w.db.query<{ status: string; summary: Record<string, unknown>; closed_at: Date | null; held_reason: string | null; reverted_by: string | null; snapshot_id: string | null; kind: string; source: string; created_by: string | null }>(
    "select * from public.data_change_sets where id = $1",
    [id],
  )).rows[0];
type Log = { action: string; target_kind: string; target_id: string; admin_id: string; details: Record<string, unknown> };
const logs = async (w: DataWorld) => (await w.db.query<Log>("select action, target_kind, target_id, admin_id, details from public.admin_log order by id")).rows;
const admin = (w: DataWorld) => user(w.quinn);

const THREE = [doc("base.colleges", "100654", { name: "Alabama A&M" }), doc("base.colleges", "100663", { name: "UAB" }), doc("base.colleges", "100706", { name: "UAH" })];

/** Three colleges written by one applied pipeline set. */
async function seeded() {
  const w = await bootDataDb();
  const first = await openSet(w.db, "sync-data");
  assert.equal(await write(w.db, first, THREE), 3);
  await close(w.db, first);
  return { w, first };
}

test("a change set: open, write three documents at version 1, equal bodies write nothing, a change is version 2", async () => {
  const w = await bootDataDb();
  const set = await openSet(w.db, "sync-data");
  const opened = await setRow(w, set);
  assert.deepEqual([opened.status, opened.kind, opened.source, opened.created_by, opened.closed_at], ["open", "pipeline", "sync-data", null, null]);

  assert.equal(await write(w.db, set, THREE), 3);
  assert.deepEqual((await current(w)).map((d) => [d.key, d.version]), [["100654", 1], ["100663", 1], ["100706", 1]]);
  assert.equal((await versions(w)).length, 3);

  // The same bodies again (key order inside the object doesn't matter to jsonb equality): nothing written.
  assert.equal(await write(w.db, set, [doc("base.colleges", "100654", { name: "Alabama A&M" }), ...THREE.slice(1)]), 0);
  assert.equal((await versions(w)).length, 3);

  assert.equal(await write(w.db, set, [doc("base.colleges", "100663", { name: "UAB", city: "Birmingham" })]), 1);
  const uab = (await current(w)).find((d) => d.key === "100663")!;
  assert.deepEqual([uab.version, uab.body], [2, { name: "UAB", city: "Birmingham" }]);
  assert.deepEqual((await versions(w, "100663")).map((v) => [v.version, v.deleted]), [[1, false], [2, false]]);
});

test("expect_version: a mismatch is a conflict (40001) and nothing in the call is written; 0 means 'no document yet'", async () => {
  const { w } = await seeded();
  const set = await openSet(w.db);
  const call = write(w.db, set, [doc("base.colleges", "100706", { name: "first" }), doc("base.colleges", "100654", { name: "x" }, 7)]);
  assert.equal(await codeOf(call), "40001");
  assert.match(await errorOf(write(w.db, set, [doc("base.colleges", "100654", { name: "x" }, 7)])), /^version conflict$/);
  assert.equal((await current(w)).find((d) => d.key === "100706")!.version, 1, "the call rolled back whole");
  assert.equal(await codeOf(write(w.db, set, [doc("base.colleges", "999999", { name: "new" }, 1)])), "40001");
  assert.equal(await write(w.db, set, [doc("base.colleges", "999999", { name: "new" }, 0)]), 1);
  assert.equal(await write(w.db, set, [doc("base.colleges", "100654", { name: "x" }, 1)]), 1);
});

test("delete: the current row goes, a deleted version stays; writing it again continues the numbering", async () => {
  const { w } = await seeded();
  const set = await openSet(w.db);
  assert.equal(await write(w.db, set, [doc("base.colleges", "100706", null)]), 1);
  assert.deepEqual((await current(w)).map((d) => d.key), ["100654", "100663"]);
  assert.deepEqual((await versions(w, "100706")).map((v) => [v.version, v.deleted, v.body]), [[1, false, { name: "UAH" }], [2, true, null]]);
  // Deleting what isn't there writes nothing.
  assert.equal(await write(w.db, set, [doc("base.colleges", "100706", null), doc("base.colleges", "424242", null)]), 0);
  assert.equal(await write(w.db, set, [doc("base.colleges", "100706", { name: "UAH again" })]), 1);
  assert.equal((await current(w)).find((d) => d.key === "100706")!.version, 3);
});

test("close fills the summary from the versions, keeps the caller's keys, and a closed set refuses writes", async () => {
  const { w, first } = await seeded();
  const s1 = await setRow(w, first);
  assert.equal(s1.status, "applied");
  assert.ok(s1.closed_at);
  assert.deepEqual(s1.summary, { documents: 3, added: 3, changed: 0, removed: 0, collections: ["base.colleges"] });

  const set = await openSet(w.db, "college-reported");
  await write(w.db, set, [
    doc("base.colleges", "100654", { name: "AAMU" }),
    doc("base.colleges", "100706", null),
    doc("reported.entries", "100654", { fall: 1 }),
    doc("reported.entries", "temp", { x: 1 }),
  ]);
  await write(w.db, set, [doc("reported.entries", "temp", null)]);
  await close(w.db, set, "held", "The breaker tripped: 40% of colleges failed.", { cost_usd: 1.25, documents: 99 });
  const s2 = await setRow(w, set);
  assert.equal(s2.status, "held");
  assert.equal(s2.held_reason, "The breaker tripped: 40% of colleges failed.");
  assert.deepEqual(s2.summary, { documents: 99, added: 1, changed: 1, removed: 1, collections: ["base.colleges", "reported.entries"], cost_usd: 1.25 });

  for (const id of [first, set]) {
    assert.match(await errorOf(write(w.db, id, [doc("base.colleges", "1", { a: 1 })])), /^change set is not open$/);
    assert.equal(await codeOf(write(w.db, id, [doc("base.colleges", "1", { a: 1 })])), "P0001");
    assert.match(await errorOf(close(w.db, id)), /change set is not open/);
  }
  assert.match(await errorOf(write(w.db, 424242, [])), /change set is not open/);
  const other = await openSet(w.db);
  assert.match(await errorOf(close(w.db, other, "reverted")), /invalid_status/);
  assert.match(await errorOf(close(w.db, other, "held", "  ")), /held_reason_required/);
  assert.match(await errorOf(write(w.db, other, [{ collection: "Bad Name", key: "1", body: {} }])), /invalid_document/);
  assert.match(await errorOf(write(w.db, other, [{ collection: "base.colleges", key: "1" }])), /invalid_document/);
  assert.match(await errorOf(write(w.db, other, [doc("base.colleges", "x".repeat(201), {})])), /invalid_document/);
});

test("data_read_collection: a collection's current documents in key order, optionally by key prefix", async () => {
  const { w } = await seeded();
  const set = await openSet(w.db);
  await write(w.db, set, [doc("high_schools.shards", "TN", { n: 1 }), doc("high_schools.shards", "TX", { n: 2 }), doc("high_schools.shards", "AL", { n: 3 })]);
  const keys = async (prefix: string | null) =>
    (await run<{ key: string }>(w.db, service, "select key from public.data_read_collection('high_schools.shards', $1)", [prefix])).map((r) => r.key);
  assert.deepEqual(await keys(null), ["AL", "TN", "TX"]);
  assert.deepEqual(await keys("T"), ["TN", "TX"]);
  assert.deepEqual(await keys("%"), [], "the prefix is literal, not a pattern");
});

test("snapshots: begin is 'building'; finish publishes (pointer_at set, carried sets marked once) or fails; only once", async () => {
  const { w, first } = await seeded();
  const snap = Number(await value(w.db, service, "public.data_begin_snapshot($1, null)", [[first]]));
  const row = async (id: number) => (await w.db.query<{ status: string; pointer_at: Date | null; manifest: unknown; notes: string | null }>("select * from public.data_snapshots where id = $1", [id])).rows[0];
  assert.equal((await row(snap)).status, "building");
  await run(w.db, service, "select public.data_finish_snapshot($1, 'published', $2, 'first')", [snap, JSON.stringify({ colleges: 3 })]);
  const done = await row(snap);
  assert.deepEqual([done.status, done.manifest, done.notes], ["published", { colleges: 3 }, "first"]);
  assert.ok(done.pointer_at);
  assert.equal(Number((await setRow(w, first)).snapshot_id), snap);
  assert.match(await errorOf(run(w.db, service, "select public.data_finish_snapshot($1, 'failed', null, null)", [snap])), /snapshot is not building/);

  const second = Number(await value(w.db, service, "public.data_begin_snapshot($1, $2)", [[first], snap]));
  await run(w.db, service, "select public.data_finish_snapshot($1, 'published', null, null)", [second]);
  assert.equal(Number((await setRow(w, first)).snapshot_id), snap, "the first snapshot that carried it");
  const failed = Number(await value(w.db, service, "public.data_begin_snapshot('{}', $1)", [second]));
  await run(w.db, service, "select public.data_finish_snapshot($1, 'failed', null, 'lineage')", [failed]);
  assert.deepEqual([(await row(failed)).status, (await row(failed)).pointer_at], ["failed", null]);
  assert.match(await errorOf(run(w.db, service, "select public.data_finish_snapshot($1, 'withdrawn', null, null)", [failed])), /invalid_status/);
});

test("admin_data_revert restores version 1 (and deletes what the set created), marks the set reverted, logs it; a later set blocks it", async () => {
  const { w } = await seeded();
  const change = await openSet(w.db, "college-reported");
  await write(w.db, change, [doc("base.colleges", "100654", { name: "changed" }), doc("base.colleges", "100706", null), doc("base.colleges", "200000", { name: "created" })]);
  await close(w.db, change);

  const later = await openSet(w.db, "identity");
  await write(w.db, later, [doc("base.colleges", "100654", { name: "later" })]);
  await close(w.db, later);

  const refused = await errorOf(run(w.db, admin(w), "select public.admin_data_revert($1, null)", [change]));
  assert.match(refused, /^later change set touched base\.colleges\/100654 \(change set \d+\)$/);
  assert.equal((await setRow(w, change)).status, "applied");
  assert.deepEqual(await logs(w), [], "a refused revert logs nothing");

  // Newest first: revert the later one, then the original.
  const r1 = Number(await value(w.db, admin(w), "public.admin_data_revert($1, 'undo identity')", [later]));
  assert.equal((await current(w)).find((d) => d.key === "100654")!.version, 4);
  const r2 = Number(await value(w.db, admin(w), "public.admin_data_revert($1, 'bad run')", [change]));
  const now = await current(w);
  assert.deepEqual(now.map((d) => [d.key, d.body]), [["100654", { name: "Alabama A&M" }], ["100663", { name: "UAB" }], ["100706", { name: "UAH" }]]);
  assert.deepEqual((await versions(w, "200000")).map((v) => v.deleted), [false, true]);

  const original = await setRow(w, change);
  assert.deepEqual([original.status, Number(original.reverted_by)], ["reverted", r2]);
  const revert = await setRow(w, r2);
  assert.deepEqual([revert.kind, revert.source, revert.status, revert.created_by], ["revert", "console", "applied", w.quinn]);
  assert.deepEqual(revert.summary, { reverts: change, note: "bad run", documents: 3, added: 1, changed: 1, removed: 1, collections: ["base.colleges"], released: [] });

  const log = (await logs(w)).filter((l) => l.action === "data.revert");
  assert.equal(log.length, 2);
  assert.deepEqual([log[1].target_kind, log[1].target_id, log[1].admin_id], ["change_set", String(change), w.quinn]);
  assert.deepEqual(log[1].details.before, { status: "applied" });
  assert.deepEqual(log[1].details.after, { status: "reverted", reverted_by: r2 });
  assert.equal(log[0].details.revert, r1);

  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_revert($1, null)", [change])), /change_set_not_revertible/);
  const open = await openSet(w.db);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_revert($1, null)", [open])), /change_set_not_revertible/);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_revert(424242, null)")), /change_set_not_found/);
});

test("admin_data_edit and admin_data_release_edit: an edit set each, the live edit is the newest, release clears the path; logged with before and after", async () => {
  const w = await bootDataDb();
  const e1 = Number(await value(w.db, admin(w), "public.admin_data_edit('100654', 'admissions.sat_math_25_75', $1, ' per the registrar ')", [JSON.stringify([520, 610])]));
  const e2 = Number(await value(w.db, admin(w), "public.admin_data_edit('100654', 'admissions.sat_math_25_75', $1, null)", [JSON.stringify([530, 620])]));
  const edits = (await w.db.query<{ id: string; value: unknown; note: string | null; created_by: string; change_set_id: string; released_at: Date | null }>("select * from public.data_field_edits order by id")).rows;
  assert.deepEqual(edits.map((e) => [Number(e.id), e.value, e.note, e.created_by]), [[e1, [520, 610], "per the registrar", w.quinn], [e2, [530, 620], null, w.quinn]]);
  const set = await setRow(w, Number(edits[0].change_set_id));
  assert.deepEqual([set.kind, set.source, set.status, set.created_by], ["edit", "console", "applied", w.quinn]);
  assert.notEqual(edits[0].change_set_id, edits[1].change_set_id, "one change set per call");

  let log = await logs(w);
  assert.deepEqual(log.map((l) => [l.action, l.target_kind, l.target_id]), [["data.edit", "college", "100654"], ["data.edit", "college", "100654"]]);
  assert.deepEqual([log[0].details.before, log[0].details.after], [null, { edit: e1, value: [520, 610] }]);
  assert.deepEqual([log[1].details.before, log[1].details.after], [{ edit: e1, value: [520, 610] }, { edit: e2, value: [530, 620] }]);
  assert.equal(log[1].details.path, "admissions.sat_math_25_75");

  // A null value clears; JSON null and SQL null are the same.
  const e3 = Number(await value(w.db, admin(w), "public.admin_data_edit('100654', 'name', 'null', null)"));
  assert.equal((await w.db.query("select value from public.data_field_edits where id = $1 and value is null", [e3])).rows.length, 1);

  await run(w.db, admin(w), "select public.admin_data_release_edit($1)", [e1]);
  const live = (await w.db.query<{ id: string }>("select id from public.data_field_edits where released_at is null order by id")).rows.map((r) => Number(r.id));
  assert.deepEqual(live, [e3], "release clears every edit for the path, the other path's stays");
  log = await logs(w);
  const release = log.at(-1)!;
  assert.deepEqual([release.action, release.target_kind, release.target_id], ["data.release", "college", "100654"]);
  assert.deepEqual([release.details.before, release.details.after, release.details.released], [{ edit: e2, value: [530, 620] }, null, [e1, e2]]);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_release_edit($1)", [e2])), /edit_released/);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_release_edit(424242)")), /edit_not_found/);

  // Reverting an edit's change set releases it.
  const e4 = Number(await value(w.db, admin(w), "public.admin_data_edit('100663', 'name', '\"UAB\"', null)"));
  const s4 = (await w.db.query<{ change_set_id: string }>("select change_set_id from public.data_field_edits where id = $1", [e4])).rows[0].change_set_id;
  await run(w.db, admin(w), "select public.admin_data_revert($1, null)", [s4]);
  assert.ok((await w.db.query<{ released_at: Date | null }>("select released_at from public.data_field_edits where id = $1", [e4])).rows[0].released_at);

  for (const [unit, path] of [["10065a", "name"], ["100654", "Name"], ["100654", "admissions..rate"], ["100654", "1st"], ["100654", "a-b"]]) {
    assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_edit($1, $2, '1', null)", [unit, path])), /invalid_unit|invalid_path/, `${unit} ${path}`);
  }
});

test("admin_data_hold and admin_data_unhold: applied ↔ held with the reason, logged with before and after", async () => {
  const { w, first } = await seeded();
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_hold($1, '  ')", [first])), /reason_required/);
  await run(w.db, admin(w), "select public.admin_data_hold($1, 'UAB looks wrong')", [first]);
  assert.deepEqual([(await setRow(w, first)).status, (await setRow(w, first)).held_reason], ["held", "UAB looks wrong"]);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_hold($1, 'again')", [first])), /change_set_not_applied/);
  await run(w.db, admin(w), "select public.admin_data_unhold($1)", [first]);
  assert.deepEqual([(await setRow(w, first)).status, (await setRow(w, first)).held_reason], ["applied", null]);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_unhold($1)", [first])), /change_set_not_held/);

  const log = await logs(w);
  assert.deepEqual(log.map((l) => [l.action, l.target_kind, l.target_id]), [["data.hold", "change_set", String(first)], ["data.unhold", "change_set", String(first)]]);
  assert.deepEqual(log[0].details, { before: { status: "applied", held_reason: null }, after: { status: "held", held_reason: "UAB looks wrong" } });
  assert.deepEqual(log[1].details, { before: { status: "held", held_reason: "UAB looks wrong" }, after: { status: "applied", held_reason: null } });

  // A set a snapshot carried can't be held; an open one neither.
  const snap = Number(await value(w.db, service, "public.data_begin_snapshot($1, null)", [[first]]));
  await run(w.db, service, "select public.data_finish_snapshot($1, 'published', null, null)", [snap]);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_hold($1, 'late')", [first])), /change_set_published/);
  const open = await openSet(w.db);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_hold($1, 'x')", [open])), /change_set_not_applied/);
});

test("admin_data_resolve_review: the item's document gains its resolution as a new version; logged", async () => {
  const w = await bootDataDb();
  const key = "100654|2025-26|C.101";
  const set = await openSet(w.db, "college-reported");
  await write(w.db, set, [doc("reported.review_queue", key, { unit_id: "100654", code: "C.101", value: 12, failures: [] })]);
  await close(w.db, set);
  await run(w.db, admin(w), "select public.admin_data_resolve_review($1, 'rejected', 'The checks were right')", [key]);
  const item = (await current(w, "reported.review_queue"))[0];
  assert.equal(item.version, 2);
  const body = item.body as Record<string, unknown>;
  assert.equal(body.resolved, "rejected");
  assert.match(String(body.resolved_on), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.resolved_note, "The checks were right");
  assert.equal(body.value, 12);
  const log = (await logs(w)).at(-1)!;
  assert.deepEqual([log.action, log.target_kind, log.target_id], ["data.review", "document", key]);
  assert.deepEqual(log.details.before, { resolved: null, resolved_on: null });
  assert.deepEqual(log.details.after, { resolved: "rejected", resolved_on: body.resolved_on });
  assert.equal((await setRow(w, Number(item.change_set_id))).kind, "edit");

  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_resolve_review($1, 'maybe', null)", [key])), /invalid_resolution/);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_resolve_review('nope', 'accepted', null)")), /review_item_not_found/);
});

test("admin_data_point_snapshot: a published snapshot becomes current again (pointer_at); logged from → to", async () => {
  const { w, first } = await seeded();
  const publish = async (prev: number | null) => {
    const id = Number(await value(w.db, service, "public.data_begin_snapshot($1, $2)", [[first], prev]));
    await run(w.db, service, "select public.data_finish_snapshot($1, 'published', null, null)", [id]);
    return id;
  };
  const a = await publish(null);
  const b = await publish(a);
  const failed = Number(await value(w.db, service, "public.data_begin_snapshot('{}', $1)", [b]));
  await run(w.db, admin(w), "select public.admin_data_point_snapshot($1)", [a]);
  const latest = (await w.db.query<{ id: string }>("select id from public.data_snapshots where pointer_at is not null order by pointer_at desc, id desc limit 1")).rows[0];
  assert.equal(Number(latest.id), a);
  const log = (await logs(w)).at(-1)!;
  assert.deepEqual([log.action, log.target_kind, log.target_id, log.details], ["data.point", "snapshot", String(a), { before: { snapshot: b }, after: { snapshot: a } }]);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_point_snapshot($1)", [failed])), /snapshot_not_published/);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_point_snapshot(424242)")), /snapshot_not_found/);
});

test("admin_data_set_reference: replaces an existing reference document whole as a new version; logged with the versions", async () => {
  const w = await bootDataDb();
  const set = await openSet(w.db, "import", "import");
  await write(w.db, set, [doc("reference.state_laws", "state-laws", { TX: 1 }), doc("base.release_calendar", "calendar", { ipeds: "x" }), doc("base.colleges", "state-laws", { not: "reference" })]);
  await close(w.db, set);
  const id = Number(await value(w.db, admin(w), "public.admin_data_set_reference('state-laws', $1, 'TX top 6%')", [JSON.stringify({ TX: 2 })]));
  const laws = (await current(w, "reference.state_laws"))[0];
  assert.deepEqual([laws.version, laws.body, Number(laws.change_set_id)], [2, { TX: 2 }, id]);
  const log = (await logs(w)).at(-1)!;
  assert.deepEqual([log.action, log.target_kind, log.target_id], ["data.reference", "document", "state-laws"]);
  assert.deepEqual([log.details.collection, log.details.before, log.details.after], ["reference.state_laws", { version: 1 }, { version: 2 }]);
  await run(w.db, admin(w), "select public.admin_data_set_reference('calendar', $1, null)", [JSON.stringify({ ipeds: "y" })]);
  assert.equal((await current(w, "base.release_calendar"))[0].version, 2);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_set_reference('nope', '{}', null)")), /reference_not_found/);
  assert.match(await errorOf(run(w.db, admin(w), "select public.admin_data_set_reference('calendar', '\"text\"', null)")), /invalid_body/);
});

/* ------------------------------------------------------------------ */
/* Guards: break a rule on purpose and show the checks catch it        */
/* ------------------------------------------------------------------ */

test("guard: without the equal-body skip, writing the same bodies again makes new versions (the idempotence check catches it)", async () => {
  const w = await bootDataDb({ transform: { file: DATA_MIGRATION, edit: (sql) => sql.replace("    if v_body is not null and v_current.body = v_body then continue; end if;\n", "") } });
  const set = await openSet(w.db);
  await write(w.db, set, THREE);
  assert.notEqual(await write(w.db, set, THREE), 0);
});

test("guard: without the open check, a closed set takes writes (the refusal check catches it)", async () => {
  const w = await bootDataDb({ transform: { file: DATA_MIGRATION, edit: (sql) => sql.replace("  if v_status is distinct from 'open' then\n    raise exception 'change set is not open' using errcode = 'P0001';\n  end if;\n  if jsonb_typeof(p_documents)", "  if jsonb_typeof(p_documents)") } });
  const set = await openSet(w.db);
  await close(w.db, set);
  assert.equal(await errorOf(write(w.db, set, THREE)), "ok");
});

test("guard: a revert without the later-set check overwrites a later run's value (the straight-line check catches it)", async () => {
  const w = await bootDataDb({ transform: { file: DATA_ADMIN_MIGRATION, edit: (sql) => sql.replace("  if v_later.change_set_id is not null then", "  if false then") } });
  const first = await openSet(w.db);
  await write(w.db, first, THREE);
  await close(w.db, first);
  const later = await openSet(w.db);
  await write(w.db, later, [doc("base.colleges", "100654", { name: "later" })]);
  await close(w.db, later);
  assert.equal(await errorOf(run(w.db, admin(w), "select public.admin_data_revert($1, null)", [first])), "ok");
});
