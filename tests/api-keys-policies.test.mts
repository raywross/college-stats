/**
 * The Data API's keys against real Postgres (PGlite with the auth stub, every migration in order;
 * supabase/migrations/20261020130000_api_keys.sql, specs/product/data-api.md "Keys, usage, and the schema"): a person
 * reads, makes, and revokes only their own keys; nobody reads key_hash; the tier isn't theirs to set; at most five
 * active keys; revoking is the only change and happens once; api_usage is the owner's to read and nobody's to write;
 * api_key_use() (anon) counts a request, refuses revoked keys and paused or deleted owners, flags a key over the day's
 * limit, stamps last_used_at at most once a minute, and keeps 90 days of usage; api_key_info() names the key and the
 * owner's display name, never the email. The limits match lib/api/keys.ts. Guard tests break a rule on purpose (the
 * owner policy, the column grant, the revoke-only trigger, the five-key trigger, the revoked check) and show the checks
 * notice. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, affectedAsUser, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { API_KEY_LIMITS, apiKeyPrefix, generateApiKey, hashApiKey } from "../lib/api/keys.ts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const MIGRATION = "20261020130000_api_keys.sql";
const SQL = readFileSync(join(DIR, MIGRATION), "utf8");

/** Every migration in order; `transform` rewrites this one (guard tests). */
async function boot(transform?: (sql: string) => string): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of ALL) {
    let sql = readFileSync(join(DIR, name), "utf8");
    if (name === MIGRATION && transform) {
      const changed = transform(sql);
      assert.notEqual(changed, sql, "the guard's transform must change the migration");
      sql = changed;
    }
    await db.exec(sql);
  }
  return db;
}

interface World {
  db: AuthDb;
  alice: string;
  bob: string;
}

async function world(transform?: (sql: string) => string): Promise<World> {
  const db = await boot(transform);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2008, displayName: "Alice" });
  const bob = await createUser(db, { email: "bob@example.com", birthYear: 1980, displayName: "Bob" });
  return { db, alice, bob };
}

/** Makes a key for `who` through their own session, as lib/api-keys-store.ts does; returns the key and its id. */
async function makeKey(db: AuthDb, who: string, name = "My notebook"): Promise<{ key: string; id: string }> {
  const key = generateApiKey();
  const id = crypto.randomUUID();
  await asUser(db, who, "insert into public.api_keys (id, user_id, name, key_prefix, key_hash) values ($1, $2, $3, $4, $5)", [id, who, name, apiKeyPrefix(key), hashApiKey(key)]);
  return { key, id };
}

type UseRow = { key_id: string; user_id: string; tier: string; allowed: boolean; used_today: number; limit_per_day: number };
const keyUse = (db: AuthDb, key: string, endpoint = "meta") => asUser<UseRow>(db, null, "select * from public.api_key_use($1, $2)", [hashApiKey(key), endpoint]);
const errorOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "ok";
  } catch (err) {
    return (err as Error).message;
  }
};

/* Rule checks, each returning what breaks the rule (empty = holds), so the guards can run them on a broken migration. */

/** Keys of someone else that `viewer` can read, through the table or the view. */
async function othersKeysVisible(w: World, owner: string, viewer: string): Promise<string[]> {
  const { id } = await makeKey(w.db, owner, "Visible?");
  const viaTable = await asUser<{ id: string }>(w.db, viewer, "select id from public.api_keys where id = $1", [id]);
  const viaView = await asUser<{ id: string }>(w.db, viewer, "select id from public.api_keys_public where id = $1", [id]);
  return [...viaTable, ...viaView].map((r) => r.id);
}

/** What an owner gets back when asking for their own keys' hashes ("refused" when the database refuses). */
async function hashReadable(w: World, who: string): Promise<string> {
  await makeKey(w.db, who, "Hash?");
  return errorOf(asUser(w.db, who, "select key_hash from public.api_keys"));
}

/** The error (or "ok") for an owner renaming their own key: only revoked_at may change. */
async function renameResult(w: World, who: string): Promise<string> {
  const { id } = await makeKey(w.db, who, "Rename me");
  return errorOf(asUser(w.db, who, "update public.api_keys set name = 'Renamed' where id = $1", [id]));
}

/** Active keys after trying to make one more than the limit (the limit holds when this equals the limit). */
async function activeAfterOverfilling(w: World, who: string): Promise<number> {
  for (let i = 0; i <= API_KEY_LIMITS.keysPerUser; i++) await errorOf(makeKey(w.db, who, `Key ${i}`));
  const [{ n }] = (await w.db.query<{ n: number }>("select count(*)::int as n from public.api_keys where user_id = $1 and revoked_at is null", [who])).rows;
  return n;
}

/** Rows api_key_use() returns for a key after it was revoked (the rule: none). */
async function revokedKeyAnswers(w: World, who: string): Promise<number> {
  const { key, id } = await makeKey(w.db, who, "Revoked");
  await asUser(w.db, who, "update public.api_keys set revoked_at = now() where id = $1", [id]);
  return (await keyUse(w.db, key)).length;
}

/** A new signed-up person in the shared world, so each test starts below the five-key limit. */
const person = (db: AuthDb, displayName: string) => createUser(db, { email: `${crypto.randomUUID()}@example.com`, birthYear: 1990, displayName });

let w: World;
test.before(async () => {
  w = await world();
});
test.after(async () => {
  await w?.db.close();
});

test("a person reads only their own keys, through the view, with today's count; anon reads nothing", async () => {
  const { id } = await makeKey(w.db, w.alice, "Alice's notebook");
  const mine = await asUser<{ id: string; name: string; key_prefix: string; tier: string; used_today: number }>(w.db, w.alice, "select * from public.api_keys_public");
  assert.ok(mine.some((r) => r.id === id && r.name === "Alice's notebook" && r.tier === "account" && Number(r.used_today) === 0));
  assert.ok(mine.every((r) => !("key_hash" in r)), "the view has no key_hash column");
  assert.deepEqual(await othersKeysVisible(w, w.alice, w.bob), []);
  assert.match(await errorOf(asUser(w.db, null, "select id from public.api_keys")), /permission denied/);
  assert.match(await errorOf(asUser(w.db, null, "select id from public.api_keys_public")), /permission denied/);
});

test("nobody reads key_hash: not the owner, not with select *", async () => {
  assert.match(await hashReadable(w, w.alice), /permission denied/);
  assert.match(await errorOf(asUser(w.db, w.alice, "select * from public.api_keys")), /permission denied/);
});

test("a person makes keys only for themselves, never with a tier, and only well-formed hashes and prefixes", async () => {
  const key = generateApiKey();
  const insert = (who: string, owner: string, extra = "", vals: unknown[] = []) =>
    errorOf(asUser(w.db, who, `insert into public.api_keys (user_id, name, key_prefix, key_hash${extra}) values ($1, 'x', $2, $3${vals.length ? ", $4" : ""})`, [owner, apiKeyPrefix(key), hashApiKey(key), ...vals]));
  assert.match(await insert(w.bob, w.alice), /row-level security/);
  assert.match(await insert(w.alice, w.alice, ", tier", ["account"]), /permission denied/);
  assert.match(await errorOf(asUser(w.db, w.alice, "insert into public.api_keys (user_id, name, key_prefix, key_hash) values ($1, 'x', 'quad_x', 'abc')", [w.alice])), /check constraint/);
  assert.match(await errorOf(asUser(w.db, w.alice, "insert into public.api_keys (user_id, name, key_prefix, key_hash) values ($1, '  ', $2, $3)", [w.alice, apiKeyPrefix(key), hashApiKey(key)])), /check constraint/);
  assert.match(await errorOf(asUser(w.db, null, "insert into public.api_keys (user_id, name, key_prefix, key_hash) values ($1, 'x', $2, $3)", [w.alice, apiKeyPrefix(key), hashApiKey(key)])), /permission denied/);
});

test("at most five active keys; revoking one makes room", async () => {
  const fresh = await world();
  try {
    assert.equal(await activeAfterOverfilling(fresh, fresh.alice), API_KEY_LIMITS.keysPerUser);
    assert.match(await errorOf(makeKey(fresh.db, fresh.alice, "Sixth")), /api_key_limit/);
    const [{ id }] = await asUser<{ id: string }>(fresh.db, fresh.alice, "select id from public.api_keys_public where revoked_at is null limit 1");
    await asUser(fresh.db, fresh.alice, "update public.api_keys set revoked_at = now() where id = $1", [id]);
    assert.equal((await errorOf(makeKey(fresh.db, fresh.alice, "Sixth, after a revoke"))), "ok");
    // Bob's count is his own.
    assert.equal(await errorOf(makeKey(fresh.db, fresh.bob, "Bob's first")), "ok");
  } finally {
    await fresh.db.close();
  }
});

test("revoking is the only change: once, by the owner; renaming, re-tiering, and un-revoking are refused", async () => {
  const me = await person(w.db, "Alice");
  const { id } = await makeKey(w.db, me, "Revoke me");
  assert.equal(await affectedAsUser(w.db, w.bob, "update public.api_keys set revoked_at = now() where id = $1", [id]), 0, "someone else can't revoke it");
  assert.equal(await affectedAsUser(w.db, me, "update public.api_keys set revoked_at = now() where id = $1", [id]), 1);
  assert.match(await errorOf(asUser(w.db, me, "update public.api_keys set revoked_at = null where id = $1", [id])), /api_key_already_revoked/);
  assert.match(await renameResult(w, me), /permission denied/);
  assert.match(await errorOf(asUser(w.db, me, "update public.api_keys set tier = 'account' where user_id = $1", [me])), /permission denied/);
  assert.match(await errorOf(asUser(w.db, me, "delete from public.api_keys where id = $1", [id])), /permission denied/);
});

test("api_key_use (anon): counts each request, answers the key and owner, and stamps last_used_at", async () => {
  const me = await person(w.db, "Alice");
  const { key, id } = await makeKey(w.db, me, "Counted");
  const [first] = await keyUse(w.db, key, "schools.get");
  assert.deepEqual({ ...first, used_today: Number(first.used_today) }, { key_id: id, user_id: me, tier: "account", allowed: true, used_today: 1, limit_per_day: API_KEY_LIMITS.perDay });
  const [second] = await keyUse(w.db, key, "mcp.get_college");
  assert.equal(second.used_today, 2);
  const [view] = await asUser<{ used_today: number; last_used_at: string | null }>(w.db, me, "select used_today, last_used_at from public.api_keys_public where id = $1", [id]);
  assert.equal(Number(view.used_today), 2);
  assert.ok(view.last_used_at, "last_used_at is set");
  // Bob can't see Alice's usage; anon can't read or write usage at all.
  assert.deepEqual(await asUser(w.db, w.bob, "select * from public.api_usage where key_id = $1", [id]), []);
  assert.equal((await asUser(w.db, me, "select * from public.api_usage where key_id = $1", [id])).length, 1);
  assert.match(await errorOf(asUser(w.db, null, "select * from public.api_usage")), /permission denied/);
  assert.match(await errorOf(asUser(w.db, me, "insert into public.api_usage (key_id, day, requests) values ($1, current_date - 1, 0)", [id])), /permission denied/);
  assert.match(await errorOf(asUser(w.db, me, "update public.api_usage set requests = 0 where key_id = $1", [id])), /permission denied/);
});

test("last_used_at is written at most once a minute", async () => {
  const me = await person(w.db, "Alice");
  const { key, id } = await makeKey(w.db, me, "Stamped");
  await keyUse(w.db, key);
  await w.db.query("update public.api_keys set last_used_at = now() - interval '30 seconds' where id = $1", [id]);
  const before = (await w.db.query<{ t: string }>("select last_used_at::text as t from public.api_keys where id = $1", [id])).rows[0].t;
  await keyUse(w.db, key);
  assert.equal((await w.db.query<{ t: string }>("select last_used_at::text as t from public.api_keys where id = $1", [id])).rows[0].t, before, "not rewritten within the minute");
  await w.db.query("update public.api_keys set last_used_at = now() - interval '2 minutes' where id = $1", [id]);
  await keyUse(w.db, key);
  const after = (await w.db.query<{ fresh: boolean }>("select last_used_at > now() - interval '5 seconds' as fresh from public.api_keys where id = $1", [id])).rows[0];
  assert.ok(after.fresh, "rewritten after a minute");
});

test("api_key_use refuses unknown and revoked keys, paused and deleted owners, and malformed input", async () => {
  const me = await person(w.db, "Alice");
  assert.deepEqual(await keyUse(w.db, generateApiKey()), []);
  assert.equal(await revokedKeyAnswers(w, me), 0);
  assert.deepEqual(await asUser(w.db, null, "select * from public.api_key_use('not-a-hash', 'meta')"), []);
  const { key } = await makeKey(w.db, w.bob, "Bob's");
  assert.deepEqual(await asUser(w.db, null, "select * from public.api_key_use($1, 'Bad Endpoint!')", [hashApiKey(key)]), []);
  assert.equal((await keyUse(w.db, key)).length, 1);
  await w.db.query("update public.profiles set suspended_at = now() where id = $1", [w.bob]);
  assert.deepEqual(await keyUse(w.db, key), [], "paused owner");
  await w.db.query("update public.profiles set suspended_at = null, deleted_at = now() where id = $1", [w.bob]);
  assert.deepEqual(await keyUse(w.db, key), [], "deleted owner");
  await w.db.query("update public.profiles set deleted_at = null where id = $1", [w.bob]);
  assert.equal((await keyUse(w.db, key)).length, 1, "restored");
});

test("over the day's limit: still answered, allowed false, and the count keeps going", async () => {
  const me = await person(w.db, "Alice");
  const { key, id } = await makeKey(w.db, me, "Busy");
  await w.db.query("insert into public.api_usage (key_id, day, requests) values ($1, current_date, $2)", [id, API_KEY_LIMITS.perDay - 1]);
  const [last] = await keyUse(w.db, key);
  assert.equal(last.used_today, API_KEY_LIMITS.perDay);
  assert.equal(last.allowed, true, "the 5,000th request is allowed");
  const [over] = await keyUse(w.db, key);
  assert.equal(over.used_today, API_KEY_LIMITS.perDay + 1);
  assert.equal(over.allowed, false);
});

test("a key's first request of the day deletes its usage older than 90 days, and only its own", async () => {
  const me = await person(w.db, "Alice");
  const { key, id } = await makeKey(w.db, me, "Old");
  const other = await makeKey(w.db, me, "Other");
  await w.db.query(
    "insert into public.api_usage (key_id, day, requests) values ($1, current_date - 91, 5), ($1, current_date - 90, 6), ($1, current_date - 1, 7), ($2, current_date - 120, 8)",
    [id, other.id],
  );
  await keyUse(w.db, key);
  const days = (await w.db.query<{ age: number; key_id: string }>("select (current_date - day)::int as age, key_id from public.api_usage where key_id in ($1, $2) order by key_id, age", [id, other.id])).rows;
  assert.deepEqual(days.filter((d) => d.key_id === id).map((d) => d.age), [0, 1, 90]);
  assert.deepEqual(days.filter((d) => d.key_id === other.id).map((d) => d.age), [120]);
});

test("api_key_info names the key and the owner's display name, never the email, and refuses revoked keys", async () => {
  const me = await person(w.db, "Alice");
  const { key, id } = await makeKey(w.db, me, "Info");
  const [info] = await asUser<Record<string, unknown>>(w.db, null, "select * from public.api_key_info($1)", [hashApiKey(key)]);
  assert.equal(info.key_id, id);
  assert.equal(info.key_name, "Info");
  assert.equal(info.key_prefix, apiKeyPrefix(key));
  assert.equal(info.display_name, "Alice");
  assert.ok(!JSON.stringify(info).includes("@"), "no email");
  await asUser(w.db, me, "update public.api_keys set revoked_at = now() where id = $1", [id]);
  assert.deepEqual(await asUser(w.db, null, "select * from public.api_key_info($1)", [hashApiKey(key)]), []);
});

/** The numbers the migration encodes: the day's limit in api_key_use() and the trigger's key count. */
function migrationLimits(sql: string): { perDay: number; keysPerUser: number } {
  return {
    perDay: Number(/when 'account' then (\d+)/.exec(sql)?.[1]),
    keysPerUser: Number(/revoked_at is null\) >= (\d+)/.exec(sql)?.[1]),
  };
}

test("the migration's limits are lib/api/keys.ts API_KEY_LIMITS", () => {
  assert.deepEqual(migrationLimits(SQL), { perDay: API_KEY_LIMITS.perDay, keysPerUser: API_KEY_LIMITS.keysPerUser });
});

test("guard: a migration that moves a limit no longer matches", () => {
  const moved = SQL.replace("when 'account' then 5000", "when 'account' then 10000").replace(") >= 5 then", ") >= 6 then");
  assert.notDeepEqual(migrationLimits(moved), { perDay: API_KEY_LIMITS.perDay, keysPerUser: API_KEY_LIMITS.keysPerUser });
});

/* ------------------------------------------------------------------ */
/* Guards: break one rule, show its check notices                      */
/* ------------------------------------------------------------------ */

test("guard: an owner policy that lets anyone read shows another person's keys", async () => {
  const broken = await world((sql) => sql.replace(/for select to authenticated\n  using \(user_id = \(select auth\.uid\(\)\)\);/, "for select to authenticated\n  using (true);"));
  try {
    assert.equal((await othersKeysVisible(broken, broken.alice, broken.bob)).length, 2, "visible through the table and the view");
  } finally {
    await broken.db.close();
  }
});

test("guard: granting select on every column makes key_hash readable", async () => {
  const broken = await world((sql) => sql.replace(/grant select \(id, user_id, name, key_prefix, tier, created, last_used_at, revoked_at\) on public\.api_keys/, "grant select on public.api_keys"));
  try {
    assert.equal(await hashReadable(broken, broken.alice), "ok");
  } finally {
    await broken.db.close();
  }
});

test("guard: with the name grantable, the revoke-only trigger still refuses a rename; without it, the rename goes through", async () => {
  const grantName = (sql: string) => sql.replace("grant update (revoked_at) on public.api_keys", "grant update (revoked_at, name) on public.api_keys");
  const triggerOnly = await world(grantName);
  const neither = await world((sql) => grantName(sql).replace(/create trigger api_keys_guard_update\nbefore update on public\.api_keys\nfor each row execute function public\.api_keys_guard_update\(\);/, ""));
  try {
    assert.match(await renameResult(triggerOnly, triggerOnly.alice), /api_key_revoke_only/);
    assert.equal(await renameResult(neither, neither.alice), "ok");
  } finally {
    await triggerOnly.db.close();
    await neither.db.close();
  }
});

test("guard: without the five-key trigger a sixth active key goes in", async () => {
  const broken = await world((sql) => sql.replace(/create trigger api_keys_limit\nbefore insert on public\.api_keys\nfor each row execute function public\.api_keys_limit\(\);/, ""));
  try {
    assert.equal(await activeAfterOverfilling(broken, broken.alice), API_KEY_LIMITS.keysPerUser + 1);
  } finally {
    await broken.db.close();
  }
});

test("guard: an api_key_use() that forgets the revoked check answers a revoked key", async () => {
  const broken = await world((sql) => sql.replace("where k.key_hash = p_hash and k.revoked_at is null and p.deleted_at is null and p.suspended_at is null;\n  if not found", "where k.key_hash = p_hash and p.deleted_at is null and p.suspended_at is null;\n  if not found"));
  try {
    assert.equal(await revokedKeyAnswers(broken, broken.alice), 1);
  } finally {
    await broken.db.close();
  }
});
