/**
 * The timeline unit's schema (supabase/migrations/20261008131000_planner_timeline.sql) against real Postgres (PGlite,
 * every migration in order): one text a day per person is a unique index; the person and their household read when
 * texts went, an outsider doesn't, nobody but the server writes them; the Your week switch is the owner's; the
 * one-click unsubscribe works by token without a session. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

async function boot(): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

async function first<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1);
  return r[0];
}

async function world() {
  const db = await boot();
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve" });
  const household = (await first(asUser<{ v: string }>(db, mom, "select public.create_household('The Smiths', 'guardian') as v"))).v;
  const inv = (await first(asUser<{ v: { token: string } }>(db, mom, "select public.create_invitation($1, $2, 'student', null, false, null, null, null) as v", [household, "alice@example.com"]))).v;
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.token]);
  const student = (await first(asUser<{ id: string }>(db, alice, "select id from public.students where user_id = $1", [alice]))).id;
  const consent = (await first(asUser<{ id: string }>(db, mom, "insert into public.sms_consents (student_id, phone) values ($1, '+16155550100') returning id", [student]))).id;
  return { db, mom, alice, eve, student, consent };
}

test("texts sent: one a day per person (a unique index), read by the household, written only by the server", async () => {
  const { db, mom, alice, eve, consent } = await world();
  await db.query("insert into public.sms_sends (consent_id, kind, sent_on) values ($1, 'confirm', '2026-10-11')", [consent]);
  await assert.rejects(db.query("insert into public.sms_sends (consent_id, kind, sent_on) values ($1, 'week', '2026-10-11')", [consent]), /duplicate key|unique/);
  await db.query("insert into public.sms_sends (consent_id, kind, sent_on) values ($1, 'week', '2026-10-12')", [consent]);
  for (const who of [alice, mom]) assert.equal((await asUser(db, who, "select id from public.sms_sends")).length, 2);
  assert.deepEqual(await asUser(db, eve, "select id from public.sms_sends"), []);
  await assert.rejects(asUser(db, mom, "insert into public.sms_sends (consent_id, kind, sent_on) values ($1, 'week', '2026-10-13')", [consent]), /permission denied/);
  await assert.rejects(asUser(db, alice, "delete from public.sms_sends"), /permission denied/);
});

test("the Your week switch is the owner's; the one-click unsubscribe works by token without a session", async () => {
  const { db, alice, eve } = await world();
  await asUser(db, alice, "insert into public.notification_prefs (user_id) values ($1) on conflict do nothing", [alice]);
  assert.equal(await affectedAsUser(db, alice, "update public.notification_prefs set your_week = true where user_id = $1", [alice]), 1);
  assert.equal(await affectedAsUser(db, eve, "update public.notification_prefs set your_week = false where user_id = $1", [alice]), 0);
  const token = (await first(db.query<{ unsubscribe_token: string }>("select unsubscribe_token from public.notification_prefs where user_id = $1", [alice]).then((r) => r.rows))).unsubscribe_token;
  assert.equal((await first(asUser<{ v: boolean }>(db, null, "select public.unsubscribe_your_week_by_token($1) as v", [token]))).v, true);
  assert.equal((await first(asUser<{ v: boolean }>(db, null, "select public.unsubscribe_your_week_by_token($1) as v", ["x".repeat(40)]))).v, false);
  const after = (await first(db.query<{ your_week: boolean; email_updates: boolean }>("select your_week, email_updates from public.notification_prefs where user_id = $1", [alice]).then((r) => r.rows)));
  assert.equal(after.your_week, false);
  assert.equal(after.email_updates, true, "the update emails stay on");
});
