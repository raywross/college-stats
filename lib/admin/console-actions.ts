import "server-only";
/**
 * What every console Server Action does around its one change (specs/product/admin.md "People"): check the session is
 * an admin at aal2 (a stale tab gets a message, not a 404), hand the action the console's Supabase client, turn
 * refusals into plain words, and call the admin-auth function with the admin's own token. The pages' reads are in
 * lib/admin/people.ts; the guards are the database's (is_admin() in every function), so this is a convenience.
 *
 * Nothing here logs an email, a link, or a reason: failures log the action's name and the database's refusal code.
 */
import { refresh } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminState } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { callAdminAuth, type AdminAuthRequest } from "@/lib/admin/auth-function";
import {
  ADMIN_FAILED,
  SESSION_ENDED_MESSAGE,
  adminErrorMessage,
  authFailureMessage,
  isNextControlFlow,
  type AdminActionState,
} from "@/lib/admin/console";

export interface AdminContext {
  userId: string;
  /** The admin's own session with the console header (lib/admin/people.ts adminSupabase()). */
  supabase: SupabaseClient;
}

export const SESSION_ENDED: AdminActionState = { status: "error", message: SESSION_ENDED_MESSAGE };

/**
 * Runs `run` only for an admin at aal2. Anything it throws becomes a generic message (and a log line naming `what`),
 * except redirect() and notFound(), which pass through.
 */
export async function withAdmin(what: string, run: (ctx: AdminContext) => Promise<AdminActionState>): Promise<AdminActionState> {
  const state = await adminState();
  if (state.kind !== "admin") return SESSION_ENDED;
  try {
    return await run({ userId: state.userId, supabase: await adminSupabase() });
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    console.error(`admin: ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "error", message: ADMIN_FAILED };
  }
}

/** A database refusal as an error state, with the log line. */
export function rpcFailure(what: string, error: { message?: string }): AdminActionState {
  console.error(`admin: ${what} failed: ${error.message ?? "unknown error"}`);
  return { status: "error", message: adminErrorMessage(error) };
}

/**
 * Runs one admin_*() function. Returns the plain-words error state on a refusal, or null on success (so a caller can
 * go on to a second step, like Delete account's sign-out).
 */
export async function callAdminRpc(
  ctx: AdminContext,
  what: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<AdminActionState | null> {
  const { error } = await ctx.supabase.rpc(fn, args);
  return error ? rpcFailure(what, error) : null;
}

/**
 * The admin's access token, forwarded to the admin-auth function, which verifies it with Supabase Auth and checks
 * is_admin() (aal2) itself. getSession() trusts the cookie unchecked, which is why the rest of the site uses
 * getClaims(); that's acceptable here only because the token is nothing but forwarded (lib/admin/auth-function.ts).
 */
async function accessToken(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

/** One admin-auth operation as the signed-in admin. `link` comes back only for recovery_link. */
export async function runAuth(ctx: AdminContext, req: AdminAuthRequest, done: string): Promise<AdminActionState> {
  const result = await callAdminAuth(req, await accessToken(ctx.supabase));
  if (!result.ok) return { status: "error", message: authFailureMessage(result) };
  refresh();
  return result.link ? { status: "done", message: done, link: result.link } : { status: "done", message: done };
}
