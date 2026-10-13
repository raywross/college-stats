import "server-only";
/**
 * Who is signed in, and what they can see (specs/product/accounts.md). Every read goes through the signed-in user's
 * own Supabase session, so row-level security decides; this module only shapes the results. Server only.
 *
 * Calling any of these reads cookies and makes the page dynamic, so only account pages, Server Actions, and route
 * handlers may use them. Public pages stay static and learn the header's state from /api/me in the browser.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase, supabaseAuthEnv } from "@/lib/supabase-server";
import { PAUSED_LOGIN_PATH } from "@/lib/admin/constants";
import { viewerBundle } from "@/lib/bundles";
import { requestMemo } from "@/lib/request-memo";
import {
  loginHref,
  resolveStudentAccess,
  wantsOwnStudent,
  type Account,
  type HouseholdMember,
  type Profile,
  type StudentAccess,
  type StudentRecord,
} from "@/lib/accounts";

/** Whether sign-in can work here: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set. CI builds have neither. */
export function authConfigured(): boolean {
  return supabaseAuthEnv() !== null;
}

/** Thrown when Supabase answers but the accounts tables aren't there (the migration isn't applied yet). */
export class AccountsSetupError extends Error {
  constructor(detail: string) {
    super(`The accounts tables aren't set up on this Supabase project yet (apply supabase/migrations/20261005120000_accounts.sql): ${detail}`);
    this.name = "AccountsSetupError";
  }
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** Who is signed in: the verified token's subject and email. Every caller reads only these two fields. */
export type SessionUser = { id: string; email: string | null };

/**
 * The signed-in user, verified (getClaims(), never getSession()). Null when signed out or unconfigured.
 *
 * getSession() only reads the cookie, which the browser can forge. getClaims() verifies the access token before
 * trusting it (@supabase/auth-js GoTrueClient.getClaims): it refreshes a token within 90 seconds of expiry, rejects
 * an expired one, and checks the signature against the project's published signing keys (JWKS, fetched from
 * /auth/v1/.well-known/jwks.json and cached in memory for 10 minutes). With an asymmetric key (RS256/ES256) that check
 * is local, so there's no round trip to Supabase Auth on most requests; with a symmetric secret (HS256), or without
 * WebCrypto, it asks the Auth server exactly as auth.getUser() did. Postgres row-level security checks the same
 * signature, so a token this accepts is one every query would accept too. The claims are read once per request
 * (sessionClaims) and shared by getUser() and sessionAal().
 */
const sessionClaims = cache(async (): Promise<{ sub: string; email: string | null; aal: string | null } | null> => {
  if (!authConfigured()) return null;
  const supabase = await createServerSupabase();
  // A malformed token (an unknown alg, a key that won't import) can throw instead of returning an error: signed out.
  const { data, error } = await supabase.auth.getClaims().catch(() => ({ data: null, error: true }));
  if (error || !data) return null;
  const { sub, email, aal } = data.claims;
  if (typeof sub !== "string" || sub === "") return null;
  return { sub, email: typeof email === "string" && email !== "" ? email : null, aal: typeof aal === "string" ? aal : null };
});

/** The signed-in user (sub and email of the verified token above). */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const claims = await sessionClaims();
  return claims ? { id: claims.sub, email: claims.email } : null;
});

/**
 * The verified session's authenticator assurance level ("aal1", or "aal2" after a second factor), from the same
 * getClaims() call as getUser(). Null when signed out. The admin console's MFA step reads it (lib/admin/auth.ts).
 */
export async function sessionAal(): Promise<string | null> {
  return (await sessionClaims())?.aal ?? null;
}

/**
 * The signed-in user, or a redirect to /login?next=… (the path to come back to). A paused account (profiles.
 * suspended_at, set by the admin console) goes to /login?paused=1 instead, which says so.
 */
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(loginHref(next));
  if (await accountPaused()) redirect(PAUSED_LOGIN_PATH);
  return user;
}

const PROFILE_COLUMNS = "id, display_name, birth_year, role_hint, created, updated, deleted_at";
const STUDENT_COLUMNS = "id, user_id, display_name, grad_year, managed_by, created, deleted_at";

function isMissingSuspension(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || /suspended_at/.test(error.message ?? "");
}

/**
 * The profile row as read, with the pause (null when the admin migration isn't applied: nobody can be paused). From
 * the viewer bundle when it's installed (lib/bundles.ts; 20261013100000_viewer_bundle_pause.sql adds `suspended_at`
 * to its profile), else from the table.
 */
const readAccount = cache(
  async (): Promise<{ account: Account; pausedAt: string | null } | null> =>
    requestMemo("account", async () => {
      const user = await getUser();
      if (!user) return null;
      const bundled = ((await viewerBundle())?.profile ?? null) as (Profile & { suspended_at?: string | null }) | null;
      if (bundled) {
        const { suspended_at: pausedAt = null, ...profile } = bundled;
        return { account: { user: { id: user.id, email: user.email }, profile }, pausedAt };
      }
      const supabase = await createServerSupabase();
      const byId = (columns: string) => supabase.from("profiles").select(columns).eq("id", user.id).maybeSingle();
      let { data, error } = await byId(`${PROFILE_COLUMNS}, suspended_at`);
      // Before 20261012200000_admin.sql is applied the column doesn't exist; read without it.
      if (error && isMissingSuspension(error)) ({ data, error } = await byId(PROFILE_COLUMNS));
      if (error) {
        if (isMissingTable(error)) throw new AccountsSetupError(error.message);
        throw new Error(`Reading your profile failed: ${error.message}`);
      }
      let row = data as (Profile & { suspended_at?: string | null }) | null;
      if (!row) {
        const inserted = await supabase.from("profiles").insert({ id: user.id }).select(PROFILE_COLUMNS).single();
        if (inserted.error) throw new Error(`Creating your profile failed: ${inserted.error.message}`);
        row = inserted.data as Profile;
      }
      const { suspended_at: pausedAt = null, ...profile } = row;
      return { account: { user: { id: user.id, email: user.email }, profile }, pausedAt };
    }),
);

/**
 * The signed-in user and their profile row. A user created before the migration (or whose sign-up trigger didn't
 * run) gets an empty profile on first read. Null when signed out, and when the account is paused (profiles.
 * suspended_at, set by the admin console: specs/product/admin.md "What deactivate means"), so every page and query
 * that starts here (requireUser callers, currentStudent, studentsICanSee) treats a paused person as signed out even
 * while their last access token lives. Throws AccountsSetupError without the tables.
 */
export const getAccount = cache(async (): Promise<Account | null> => {
  const read = await readAccount();
  return read && read.pausedAt === null ? read.account : null;
});

/** Whether the signed-in account is paused. False when signed out, and when the profile can't be read (the caller's own read reports that). */
export const accountPaused = cache(async (): Promise<boolean> => {
  try {
    return ((await readAccount())?.pausedAt ?? null) !== null;
  } catch {
    return false;
  }
});

/**
 * The signed-in user's own student record. Created on first use for a user whose role hint is "student" (or unset:
 * most people signing up are students); null for guardians and counselors, and when signed out. The record comes
 * from the viewer bundle when it's installed; otherwise it's read in parallel with the account (U20 "real speed":
 * one round trip instead of two in a row). The role hint is needed only when there is no record yet.
 */
export const currentStudent = cache(
  async (): Promise<StudentRecord | null> =>
    requestMemo("current_student", async () => {
      const user = await getUser();
      if (!user) return null;
      const supabase = await createServerSupabase();
      const bundle = await viewerBundle();
      const [account, own] = await Promise.all([
        getAccount(),
        bundle
          ? Promise.resolve({ data: bundle.students.find((s) => s.user_id === user.id && !s.deleted_at) ?? null, error: null })
          : supabase.from("students").select(STUDENT_COLUMNS).eq("user_id", user.id).is("deleted_at", null).maybeSingle(),
      ]);
      if (!account) return null;
      const { data, error } = own;
      if (error) throw new Error(`Reading your student record failed: ${error.message}`);
      if (data) return data as StudentRecord;
      if (!wantsOwnStudent(account.profile.role_hint)) return null;
      const created = await supabase
        .from("students")
        .insert({ user_id: account.user.id, display_name: account.profile.display_name })
        .select(STUDENT_COLUMNS)
        .single();
      if (created.error) {
        // Two requests racing to create it: the unique user_id lost one insert; read the winner.
        const again = await supabase.from("students").select(STUDENT_COLUMNS).eq("user_id", account.user.id).maybeSingle();
        if (again.data) return again.data as StudentRecord;
        throw new Error(`Creating your student record failed: ${created.error.message}`);
      }
      return created.data as StudentRecord;
    }),
);

const MEMBER_COLUMNS = "id, household_id, user_id, student_id, role, status, invited_email, can_edit, created, accepted_at";

/**
 * Every student the signed-in user can see: their own first, then those they reach as a guardian. From the viewer
 * bundle when it's installed (one round trip for everything); otherwise the account, the user's own record (created
 * on first use), and the two reads run together (one round trip instead of three in a row). An own record this very
 * request created isn't in either read yet, so it's added.
 */
export const studentsICanSee = cache(
  async (): Promise<StudentAccess[]> =>
    requestMemo("students_i_can_see", async () => {
      const user = await getUser();
      if (!user) return [];
      const bundle = await viewerBundle();
      const supabase = await createServerSupabase();
      const [account, own, students, members] = await Promise.all([
        getAccount(),
        currentStudent(),
        bundle ? Promise.resolve({ data: bundle.students, error: null }) : supabase.from("students").select(STUDENT_COLUMNS).is("deleted_at", null),
        bundle ? Promise.resolve({ data: bundle.members, error: null }) : supabase.from("household_members").select(MEMBER_COLUMNS),
      ]);
      if (!account) return [];
      if (students.error) throw new Error(`Reading students failed: ${students.error.message}`);
      if (members.error) throw new Error(`Reading households failed: ${members.error.message}`);
      const rows = students.data as StudentRecord[];
      const all = own && !rows.some((s) => s.id === own.id) ? [...rows, own] : rows;
      return resolveStudentAccess(account.user.id, all, members.data as HouseholdMember[]);
    }),
);
