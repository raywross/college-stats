import "server-only";
/**
 * Who may open the admin console (specs/product/admin.md "Who is an admin"). Server only.
 *
 * An admin has an unrevoked row in public.admins and a session at aal2 (TOTP MFA). This module checks both in the
 * app so a non-admin gets a 404 and an admin at aal1 gets the MFA step; the database checks them again on every
 * policy and function (is_admin(), 20261012200000_admin.sql), so this is a convenience, never the guard.
 *
 * Reads cookies (like lib/auth.ts), so only /admin pages, their Server Actions, and route handlers call it.
 */
import { cache } from "react";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authConfigured, getUser, sessionAal } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";

export type AdminState =
  | { kind: "admin"; userId: string }
  | { kind: "needs-mfa"; userId: string; enrolled: boolean }
  | { kind: "not-admin" }
  | { kind: "setup-missing" };

/** PostgREST/Postgres for "no such function": the admin migration isn't applied to this project yet. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "");
}

/** Whether the signed-in user has a verified TOTP factor (the MFA step enrolls one when not). */
async function hasVerifiedFactor(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.listFactors().catch(() => ({ data: null, error: true }));
  if (error || !data) return false;
  return data.all.some((f) => f.factor_type === "totp" && f.status === "verified");
}

/**
 * The signed-in person's standing with the console:
 * - "admin": an admin at aal2; the console renders.
 * - "needs-mfa": an admin at aal1; the console shows the MFA step (enroll when `enrolled` is false, else challenge).
 * - "not-admin": signed out, not an admin, revoked, paused, or deleted (is_admin_any_aal() says no).
 * - "setup-missing": signed in, but is_admin_any_aal() doesn't exist yet (apply the migration).
 */
export const adminState = cache(async (): Promise<AdminState> => {
  if (!authConfigured()) return { kind: "not-admin" };
  const user = await getUser();
  if (!user) return { kind: "not-admin" };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("is_admin_any_aal");
  if (error) return isMissingFunction(error) ? { kind: "setup-missing" } : { kind: "not-admin" };
  if (data !== true) return { kind: "not-admin" };
  if ((await sessionAal()) === "aal2") return { kind: "admin", userId: user.id };
  return { kind: "needs-mfa", userId: user.id, enrolled: await hasVerifiedFactor(supabase) };
});

/**
 * The admin, or a 404 (not a 403: the console's existence isn't advertised). Call at the top of every /admin page,
 * Server Action, and route handler. The MFA step itself reads adminState() instead.
 */
export async function requireAdmin(): Promise<{ userId: string }> {
  const state = await adminState();
  if (state.kind !== "admin") notFound();
  return { userId: state.userId };
}
