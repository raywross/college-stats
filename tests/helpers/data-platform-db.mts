/**
 * The data platform's test database (supabase/migrations/20261031120000_data_platform.sql and
 * 20261031130000_data_platform_admin.sql): PGlite with the auth stub and every migration in order, an admin (Quinn,
 * signed in at aal2 in the tests) and a non-admin (Eve), and the callers the store is used by: the service role (the
 * secret key), an admin, a signed-in user, a signed-out visitor. Shared by tests/data-platform-policies.test.mts and
 * tests/data-platform-functions.test.mts. Not a test file.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, createUser, type AuthDb } from "./pg-auth.mts";

const DIR = join(import.meta.dirname, "..", "..", "supabase", "migrations");
export const ALL_MIGRATIONS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
export const DATA_MIGRATION = "20261031120000_data_platform.sql";
export const DATA_ADMIN_MIGRATION = "20261031130000_data_platform_admin.sql";
export const migrationSql = (name: string) => readFileSync(join(DIR, name), "utf8");

/** Supabase Storage, reduced to what the bucket statements touch. */
export const STORAGE_STUB_SQL = `
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
alter table storage.objects enable row level security;
`;

export interface BootOptions {
  /** Rewrites one migration before it is applied (guard tests); must change it. */
  transform?: { file: string; edit: (sql: string) => string };
  /** Installs the storage stub first. */
  storage?: boolean;
}

export async function bootDataDb({ transform, storage = false }: BootOptions = {}) {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  if (storage) await db.exec(STORAGE_STUB_SQL);
  for (const name of ALL_MIGRATIONS) {
    let sql = migrationSql(name);
    if (transform && transform.file === name) {
      const changed = transform.edit(sql);
      assert.notEqual(changed, sql, "the guard's transform must change the migration");
      sql = changed;
    }
    await db.exec(sql);
  }
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  const quinn = await createUser(db, { email: "quinn@quad.test", birthYear: 1985, roleHint: "guardian", displayName: "Quinn Admin" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve Evans" });
  await db.query("insert into public.admins (user_id, note) values ($1, 'owner')", [quinn]);
  return { db, quinn, eve };
}

export type DataWorld = Awaited<ReturnType<typeof bootDataDb>>;

export type Caller =
  | { kind: "service" }
  | { kind: "anon" }
  | { kind: "user"; id: string; aal?: "aal1" | "aal2"; console?: boolean };

/** One statement as a caller, in a transaction so the role and claims reset afterwards. */
export async function run<T = Record<string, unknown>>(db: AuthDb, who: Caller, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    if (who.kind === "service") {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
      await tx.exec("set local role service_role");
    } else if (who.kind === "anon") {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await tx.exec("set local role anon");
    } else {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.id, role: "authenticated", aal: who.aal ?? "aal2" })]);
      await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify(who.console === false ? {} : { "x-quad-console": "1" })]);
      await tx.exec("set local role authenticated");
    }
    return (await tx.query<T>(sql, params)).rows;
  });
}

export const service: Caller = { kind: "service" };
export const anon: Caller = { kind: "anon" };
export const user = (id: string, aal: "aal1" | "aal2" = "aal2"): Caller => ({ kind: "user", id, aal });

export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return (err as Error).message;
  }
}

/** The SQLSTATE of a refused call ("ok" when it succeeded). */
export async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return String((err as { code?: string }).code ?? "none");
  }
}

/** A single value from a `select <expr> as v` as a caller. */
export async function value<T>(db: AuthDb, who: Caller, expr: string, params: unknown[] = []): Promise<T> {
  const rows = await run<{ v: T }>(db, who, `select ${expr} as v`, params);
  assert.equal(rows.length, 1);
  return rows[0].v;
}

/** A document entry for data_write_documents: the body as its JSON text (null deletes), as the store sends it. */
export const doc = (collection: string, key: string, body: unknown, expectVersion?: number) => {
  const text = body === null ? null : JSON.stringify(body);
  return expectVersion === undefined ? { collection, key, body: text } : { collection, key, body: text, expect_version: expectVersion };
};

/** A document entry with its body text exactly as given. */
export const rawDoc = (collection: string, key: string, body: string | null) => ({ collection, key, body });

/** Opens a pipeline change set as the service role; returns its id. */
export const openSet = (db: AuthDb, source = "test", kind = "pipeline") =>
  value<string>(db, service, "public.data_open_change_set($1, $2, 'run-1', '{}')", [kind, source]).then(Number);

export const write = (db: AuthDb, set: number, docs: unknown[]) =>
  value<number>(db, service, "public.data_write_documents($1, $2)", [set, JSON.stringify(docs)]);

export const close = (db: AuthDb, set: number, status = "applied", reason: string | null = null, summary: unknown = null) =>
  run(db, service, "select public.data_close_change_set($1, $2, $3, $4)", [set, status, reason, summary === null ? null : JSON.stringify(summary)]);
