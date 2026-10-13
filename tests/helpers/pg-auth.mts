/**
 * Row-level security harness for user-data migrations (specs/product/accounts.md): real Postgres (PGlite) with a
 * minimal stub of Supabase's auth schema, so policies can be tested the way PostgREST runs them.
 *
 *   const db = await createAuthDb(["20261005120000_accounts.sql"]);
 *   const alice = await createUser(db, { email: "alice@example.com", birthYear: 2008 });
 *   const rows = await asUser(db, alice, "select * from public.profiles");
 *
 * The stub mirrors what Supabase provides: `auth.users` (id, email, raw_user_meta_data, and the few columns the admin
 * console reads), `auth.mfa_factors`, `auth.sessions`, `auth.uid()` and
 * `auth.jwt()` reading the `request.jwt.claims` setting, and the roles `anon`, `authenticated` (no BYPASSRLS) and
 * `service_role` (BYPASSRLS). PGlite's own session is a superuser, which bypasses RLS: run every assertion about
 * access through `asUser`, and use `db.query` only for setup.
 *
 * Not a test file (no `.test.mts`), so `npm test` doesn't run it on its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

export type AuthDb = PGlite;

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "supabase", "migrations");

/** Supabase's auth schema, reduced to what the policies and triggers touch. */
export const AUTH_STUB_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Read by the admin console's functions (20261012200000_admin.sql); Supabase has these columns.
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  -- Read by the console's sign-in activity (20261013160000_admin_auth_activity.sql).
  confirmation_sent_at timestamptz,
  recovery_sent_at timestamptz,
  email_change_sent_at timestamptz
);

-- Supabase's MFA factors and sessions, reduced to the columns the admin console reads.
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  created_at timestamptz not null default now()
);

create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  aal text,
  updated_at timestamptz,
  refreshed_at timestamp,
  user_agent text,
  ip inet
);

-- Supabase Auth's audit log (written when the project's "audit logs in the database" setting is on).
create table auth.audit_log_entries (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  payload json,
  created_at timestamptz not null default now(),
  ip_address varchar(64) not null default ''
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
`;

/** Boots PGlite, installs the auth stub, and applies the named files from supabase/migrations/ in order. */
export async function createAuthDb(migrations: string[]): Promise<AuthDb> {
  const db = await PGlite.create();
  await db.exec(AUTH_STUB_SQL);
  for (const name of migrations) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
  }
  return db;
}

/**
 * Runs one statement as a signed-in user (`authenticated`, with `sub` = userId in the JWT claims) or, with null, as
 * a signed-out visitor (`anon`), inside a transaction so the role and claims reset afterwards. Errors propagate
 * (and roll the statement back).
 */
export async function asUser<T = Record<string, unknown>>(
  db: AuthDb,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    const role = userId ? "authenticated" : "anon";
    const claims = userId ? { sub: userId, role } : { role };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${role}`);
    const result = await tx.query<T>(sql, params);
    return result.rows;
  });
}

/** Number of rows a statement affected, run as `asUser` would (for update/delete checks). */
export async function affectedAsUser(db: AuthDb, userId: string | null, sql: string, params: unknown[] = []): Promise<number> {
  return db.transaction(async (tx) => {
    const role = userId ? "authenticated" : "anon";
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(userId ? { sub: userId, role } : { role })]);
    await tx.exec(`set local role ${role}`);
    const result = await tx.query(sql, params);
    return result.affectedRows ?? 0;
  });
}

/**
 * Creates an auth user the way Supabase Auth does on sign-up (an insert into auth.users with the sign-up metadata),
 * which fires the migration's profile trigger. Returns the new user's id.
 */
export async function createUser(
  db: AuthDb,
  { email, birthYear, roleHint, displayName, id = randomUUID() }: { email: string; birthYear?: number; roleHint?: string; displayName?: string; id?: string },
): Promise<string> {
  const meta: Record<string, unknown> = {};
  if (birthYear !== undefined) meta.birth_year = String(birthYear);
  if (roleHint !== undefined) meta.role_hint = roleHint;
  if (displayName !== undefined) meta.display_name = displayName;
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, JSON.stringify(meta)]);
  return id;
}
