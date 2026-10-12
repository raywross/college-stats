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
 * signature, so a token this accepts is one every query would accept too.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  if (!authConfigured()) return null;
  const supabase = await createServerSupabase();
  // A malformed token (an unknown alg, a key that won't import) can throw instead of returning an error: signed out.
  const { data, error } = await supabase.auth.getClaims().catch(() => ({ data: null, error: true }));
  if (error || !data) return null;
  const { sub, email } = data.claims;
  if (typeof sub !== "string" || sub === "") return null;
  return { id: sub, email: typeof email === "string" && email !== "" ? email : null };
});

/** The signed-in user, or a redirect to /login?next=… (the path to come back to). */
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(loginHref(next));
  return user;
}

const PROFILE_COLUMNS = "id, display_name, birth_year, role_hint, created, updated, deleted_at";
const STUDENT_COLUMNS = "id, user_id, display_name, grad_year, managed_by, created, deleted_at";


/**
 * The signed-in user and their profile row. A user created before the migration (or whose sign-up trigger didn't
 * run) gets an empty profile on first read. Null when signed out; throws AccountsSetupError without the tables.
 * Read from the viewer bundle when it's installed (lib/bundles.ts), else from the table.
 */
export const getAccount = cache(
  async (): Promise<Account | null> =>
    requestMemo("account", async () => {
      const user = await getUser();
      if (!user) return null;
      const bundled = (await viewerBundle())?.profile ?? null;
      if (bundled) return { user: { id: user.id, email: user.email }, profile: bundled };
      const supabase = await createServerSupabase();
      const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle();
      if (error) {
        if (isMissingTable(error)) throw new AccountsSetupError(error.message);
        throw new Error(`Reading your profile failed: ${error.message}`);
      }
      let profile = data as Profile | null;
      if (!profile) {
        const inserted = await supabase.from("profiles").insert({ id: user.id }).select(PROFILE_COLUMNS).single();
        if (inserted.error) throw new Error(`Creating your profile failed: ${inserted.error.message}`);
        profile = inserted.data as Profile;
      }
      return { user: { id: user.id, email: user.email }, profile };
    }),
);

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
