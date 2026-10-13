"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { callAdminRpc, runAuth, withAdmin } from "@/lib/admin/console-actions";
import {
  BAD_FORM_MESSAGE,
  CONFIRM_DELETE,
  formId,
  parseEmailChange,
  parseProfileEdit,
  parseReason,
  typedMatches,
  type AdminActionState,
} from "@/lib/admin/console";

/**
 * A person's actions (specs/product/admin.md "A person"). Each reads its ids and fields from the form, checks the
 * session is an admin at aal2, and calls one admin_*() function or one admin-auth operation, which write the log row.
 * Typed confirmations are checked here again: the disabled button in the browser is not the rule.
 */

const badForm: AdminActionState = { status: "error", message: BAD_FORM_MESSAGE };

/** Edit details: name, birth year, role hint, phone. */
export async function editProfile(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("profile edit", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    const parsed = parseProfileEdit(form);
    if (!parsed.ok) return { status: "error", message: parsed.message };
    const failed = await callAdminRpc(ctx, "profile edit", "admin_update_profile", { p_user: user, p_patch: parsed.value });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Saved." };
  });
}

/** Change email: the new address typed twice; optionally move invitations addressed to the old one. */
export async function changeEmail(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("email change", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    const parsed = parseEmailChange(form);
    if (!parsed.ok) return { status: "error", message: parsed.message };
    return runAuth(ctx, { op: "set_email", user, email: parsed.value.email, repointInvitations: parsed.value.repointInvitations }, "Email changed.");
  });
}

/** Copy reset link: the link comes back in the action's state and is shown once. Never logged, never in a URL. */
export async function copyResetLink(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("reset link", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    return runAuth(ctx, { op: "recovery_link", user }, "Reset link made. It works once and is shown only here.");
  });
}

/** Send reset email (offered only when an email provider is configured; the function refuses otherwise). */
export async function sendResetEmail(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("reset email", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    return runAuth(ctx, { op: "recovery_email", user }, "Reset email sent.");
  });
}

/** Sign out everywhere (deletes the person's sessions). */
export async function signOutEverywhere(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("sign out", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    return runAuth(ctx, { op: "sign_out", user }, "Signed out everywhere.");
  });
}

/** Deactivate: ban, end sessions, set suspended_at. A reason is required and goes in the log. */
export async function deactivate(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("deactivate", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    const reason = parseReason(form);
    if (!reason.ok) return { status: "error", message: reason.message };
    return runAuth(ctx, { op: "suspend", user, reason: reason.value }, "Account deactivated.");
  });
}

/** Reactivate: reverses all three parts of a deactivation. */
export async function reactivate(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("reactivate", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    return runAuth(ctx, { op: "unsuspend", user }, "Account reactivated.");
  });
}

/**
 * Delete account: the 30-day soft delete (admin_delete_account), then sign them out everywhere, since the database
 * function does not (a token stays valid for up to an hour). Typed "delete".
 */
export async function deleteAccount(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("account delete", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    if (!typedMatches(form.get("confirm"), CONFIRM_DELETE)) return { status: "error", message: `Type "${CONFIRM_DELETE}" to confirm.` };
    const failed = await callAdminRpc(ctx, "account delete", "admin_delete_account", { p_user: user });
    if (failed) return failed;
    const signedOut = await runAuth(ctx, { op: "sign_out", user }, "");
    refresh();
    if (signedOut.status === "error") {
      return {
        status: "done",
        message: `Account deleted. Signing them out everywhere didn't finish (${signedOut.message}) Their current session works for up to an hour; restore the account or try Sign out everywhere again.`,
      };
    }
    return { status: "done", message: "Account deleted and signed out everywhere. It can be restored for 30 days." };
  });
}

/**
 * Confirm or unconfirm the account's email (admin_set_email_confirmed). Unconfirming also signs them out; their next
 * sign-in asks them to confirm, and the sign-in page offers to send the email again.
 */
export async function setEmailConfirmed(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("email confirmation", async (ctx) => {
    const user = formId(form, "user");
    const state = form.get("confirmed");
    if (!user || (state !== "true" && state !== "false")) return badForm;
    const confirmed = state === "true";
    const failed = await callAdminRpc(ctx, "email confirmation", "admin_set_email_confirmed", { p_user: user, p_confirmed: confirmed });
    if (failed) return failed;
    refresh();
    return { status: "done", message: confirmed ? "Email confirmed. They can sign in now." : "Email marked unconfirmed and signed out everywhere." };
  });
}

/** Restore within the 30 days. */
export async function restoreAccount(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("account restore", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    const failed = await callAdminRpc(ctx, "account restore", "admin_restore_account", { p_user: user });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Account restored." };
  });
}

/**
 * Delete now: the purge of one soft-deleted account. Typed: the account's email (or "delete" for an account with
 * none). The email is read here, never taken from the form, so a forged form can't supply its own expected value.
 */
export async function deleteNow(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("delete now", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    const { data, error } = await ctx.supabase.rpc("admin_user_auth", { p_user: user });
    if (error) return { status: "error", message: "We couldn't look that account up. Try again in a moment." };
    const email = (data as { email: string | null }[] | null)?.[0]?.email ?? null;
    if (!typedMatches(form.get("confirm"), email ?? CONFIRM_DELETE)) {
      return { status: "error", message: email ? "Type the account's email address exactly to confirm." : `Type "${CONFIRM_DELETE}" to confirm.` };
    }
    const result = await runAuth(ctx, { op: "purge", user }, "Deleted now.");
    if (result.status !== "done") return result;
    redirect("/admin/people");
  });
}
