/**
 * Row-level security for the visit-events migration (specs/product/visit-events.md, "Model"): signed-in people read only
 * upcoming, live, non-staff events; anonymous visitors read nothing but may ask for a college's count; prefs, mutes, and
 * sent alerts are own-row; a first follow creates the prefs row; the token functions flip only their one switch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATIONS = [
  "20260928000000_dataset.sql",
  "20261002140000_school_staging.sql",
  "20261005120000_accounts.sql",
  "20261005140000_follows.sql",
  "20261005145000_change_old_source.sql",
  "20261013180000_visit_events.sql",
  "20261014100000_visit_events_shown_kinds.sql",
];

let db: AuthDb;
let alice: string;
let bob: string;

test.before(async () => {
  db = await createAuthDb(MIGRATIONS);
  alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student" });
  bob = await createUser(db, { email: "bob@example.com", birthYear: 1978, roleHint: "guardian" });
  await db.exec(`
    insert into public.slate_hosts (unit_id, host) values ('134130', 'undergrad.admissions.ufl.edu');
    insert into public.visit_events (id, unit_id, host, slate_id, title, kind, starts_at, book_url, source_url) values
      ('h:1', '134130', 'h', '11111111-1111-1111-1111-111111111111', 'Campus Tour', 'tour', now() + interval '3 days', 'https://h/register/?id=1', 'https://h/register/?cmd=search'),
      ('h:2', '134130', 'h', '22222222-2222-2222-2222-222222222222', 'Hotel Shipping', 'staff', now() + interval '3 days', 'https://h/register/?id=2', 'https://h/register/?cmd=search'),
      ('h:3', '134130', 'h', '33333333-3333-3333-3333-333333333333', 'Old Tour', 'tour', now() - interval '3 days', 'https://h/register/?id=3', 'https://h/register/?cmd=search'),
      ('h:4', '134130', 'h', '44444444-4444-4444-4444-444444444444', 'Gone Tour', 'tour', now() + interval '3 days', 'https://h/register/?id=4', 'https://h/register/?cmd=search'),
      ('h:5', '134130', 'h', '55555555-5555-5555-5555-555555555555', 'Admissions Drop-In', 'other', now() + interval '3 days', 'https://h/register/?id=5', 'https://h/register/?cmd=search');
    update public.visit_events set removed_at = now() where id = 'h:4';
  `);
});

test.after(async () => {
  await db?.close();
});

test("signed-in people read upcoming live events of the five shown kinds (never other or staff); anon reads none but gets the count", async () => {
  const mine = await asUser<{ id: string }>(db, alice, "select id from public.visit_events order by id");
  assert.deepEqual(
    mine.map((r) => r.id),
    ["h:1"],
  );
  await assert.rejects(asUser(db, null, "select id from public.visit_events"), /permission denied/);
  const [count] = await asUser<{ n: number }>(db, null, "select public.visit_event_count('134130') as n");
  assert.equal(count.n, 1);
  const hosts = await asUser<{ host: string }>(db, alice, "select host from public.slate_hosts");
  assert.equal(hosts.length, 1);
});

test("a first follow creates visit_alert_prefs with the defaults; prefs and mutes are own-row", async () => {
  await asUser(db, alice, "insert into public.follows (unit_id) values ('134130')");
  const prefs = await asUser(db, alice, "select radius_miles, measure_from, include_online, email_visit_alerts from public.visit_alert_prefs");
  assert.deepEqual(prefs, [{ radius_miles: 30, measure_from: "auto", include_online: false, email_visit_alerts: true }]);
  await assert.rejects(asUser(db, alice, "update public.visit_alert_prefs set radius_miles = 31"), /check constraint/);
  await asUser(db, alice, "update public.visit_alert_prefs set radius_miles = 50");
  assert.deepEqual(await asUser(db, bob, "select user_id from public.visit_alert_prefs"), []);
  await asUser(db, alice, "insert into public.visit_alert_mutes (unit_id) values ('134130')");
  // The mute switch inserts with ON CONFLICT DO NOTHING (lib/visit-events/store.ts): a second tap must not need the
  // update privilege the grant withholds (QA 2026-10-13 found the upsert's DO UPDATE refused).
  await asUser(db, alice, "insert into public.visit_alert_mutes (unit_id) values ('134130') on conflict (user_id, unit_id) do nothing");
  await assert.rejects(
    asUser(db, alice, "insert into public.visit_alert_mutes (unit_id) values ('134130') on conflict (user_id, unit_id) do update set created = now()"),
    /permission denied/,
  );
  assert.deepEqual(await asUser(db, bob, "select unit_id from public.visit_alert_mutes"), []);
  await assert.rejects(asUser(db, bob, "insert into public.visit_alert_mutes (user_id, unit_id) values ($1, '134130')", [alice]), /row-level security/);
});

test("the token functions turn alerts off or mute one college, and refuse unknown tokens", async () => {
  const tok = await db.query<{ unsubscribe_token: string }>("select unsubscribe_token from public.notification_prefs where user_id = $1", [alice]);
  const token = tok.rows[0].unsubscribe_token;
  const [bad] = await asUser<{ ok: boolean }>(db, null, "select public.visit_alerts_unsubscribe_by_token('nope') as ok");
  assert.equal(bad.ok, false);
  const [ok] = await asUser<{ ok: boolean }>(db, null, "select public.visit_alerts_unsubscribe_by_token($1) as ok", [token]);
  assert.equal(ok.ok, true);
  const [after] = await asUser<{ email_visit_alerts: boolean }>(db, alice, "select email_visit_alerts from public.visit_alert_prefs");
  assert.equal(after.email_visit_alerts, false);
  const [muted] = await asUser<{ ok: boolean }>(db, null, "select public.visit_alerts_mute_by_token($1, '198419') as ok", [token]);
  assert.equal(muted.ok, true);
  const mutes = await asUser<{ unit_id: string }>(db, alice, "select unit_id from public.visit_alert_mutes order by unit_id");
  assert.deepEqual(
    mutes.map((r) => r.unit_id),
    ["134130", "198419"],
  );
  const [badUnit] = await asUser<{ ok: boolean }>(db, null, "select public.visit_alerts_mute_by_token($1, 'x') as ok", [token]);
  assert.equal(badUnit.ok, false);
});

test("sent alerts are readable by their owner only and written by the service role only", async () => {
  await db.query("insert into public.visit_alerts (user_id, event_ids, college_count) values ($1, '{h:1}', 1)", [alice]);
  assert.equal((await asUser(db, alice, "select college_count from public.visit_alerts")).length, 1);
  assert.deepEqual(await asUser(db, bob, "select college_count from public.visit_alerts"), []);
  await assert.rejects(asUser(db, alice, "insert into public.visit_alerts (user_id) values ($1)", [alice]), /row-level security|permission denied/);
});
