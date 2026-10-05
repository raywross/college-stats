"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getAccount } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { SITE_NAME } from "@/lib/brand";
import { EMAIL_RE, HOUSEHOLD_ERRORS, errorMessage, invitationEmail, shortDate } from "@/lib/household-rules";

/**
 * Household Server Actions (specs/product/accounts.md "Built: households"). Each one checks the session and sends
 * only ids and the user's change; the database functions and policies decide whether it's allowed, and their
 * refusals come back as plain messages (HOUSEHOLD_ERRORS).
 */

export type HouseholdActionState = { status: "idle" } | { status: "done"; message?: string } | { status: "error"; message: string };

export type InviteState =
  | { status: "idle" }
  | { status: "created"; link: string; email: string; emailed: boolean; expires: string }
  | { status: "error"; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(form: FormData, name: string): string | null {
  const v = String(form.get(name) ?? "");
  return UUID_RE.test(v) ? v : null;
}

async function signedIn() {
  const account = await getAccount();
  if (!account) return null;
  if (account.profile.deleted_at) return null;
  return account;
}

const SESSION_ENDED: HouseholdActionState = { status: "error", message: HOUSEHOLD_ERRORS.not_signed_in };

function failed(error: { message?: string }, what: string): HouseholdActionState {
  console.error(`household: ${what} failed: ${error.message}`);
  return { status: "error", message: errorMessage(error, HOUSEHOLD_ERRORS, FAILED) };
}

/** Creates a household with the user as its first member, then opens the household page. */
export async function createHousehold(_prev: HouseholdActionState, form: FormData): Promise<HouseholdActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) return { status: "error", message: HOUSEHOLD_ERRORS.invalid_name };
  const role = form.get("role") === "student" ? "student" : "guardian";
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_household", { p_name: name, p_role: role });
  if (error) return failed(error, "create_household");
  redirect("/account/household");
}

/** Adds a managed student (a child without an account yet) to a household the user is a guardian of. */
export async function addManagedStudent(_prev: HouseholdActionState, form: FormData): Promise<HouseholdActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const household = id(form, "household");
  const name = String(form.get("name") ?? "").trim();
  const yearInput = String(form.get("grad_year") ?? "").trim();
  if (!household) return { status: "error", message: FAILED };
  if (!name || name.length > 80) return { status: "error", message: HOUSEHOLD_ERRORS.invalid_name };
  const year = yearInput ? Number(yearInput) : null;
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) return { status: "error", message: HOUSEHOLD_ERRORS.invalid_grad_year };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("add_managed_student", { p_household: household, p_name: name, p_grad_year: year });
  if (error) return failed(error, "add_managed_student");
  refresh();
  return { status: "done", message: `Added ${name}.` };
}

/**
 * Creates an invitation and returns its link to show on screen (only its hash is stored, so this is the one time
 * it can be shown). Also emails it when email is set up; "not configured" is normal before the sending domain
 * exists, and the on-screen link covers it.
 */
export async function inviteToHousehold(_prev: InviteState, form: FormData): Promise<InviteState> {
  const account = await signedIn();
  if (!account) return { status: "error", message: HOUSEHOLD_ERRORS.not_signed_in };
  const household = id(form, "household");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const side = form.get("side") === "student" ? "student" : "guardian";
  const student = side === "student" ? id(form, "student") : null;
  const canEdit = side === "guardian" && form.get("can_edit") === "on";
  if (!household) return { status: "error", message: FAILED };
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: "error", message: HOUSEHOLD_ERRORS.invalid_email };
  if (account.user.email && email === account.user.email.toLowerCase()) return { status: "error", message: "That's your own email. Invite someone else." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_household: household,
    p_email: email,
    p_side: side,
    p_student: student,
    p_can_edit: canEdit,
  });
  if (error) {
    console.error(`household: create_invitation failed: ${error.message}`);
    return { status: "error", message: errorMessage(error, HOUSEHOLD_ERRORS, FAILED) };
  }
  const { token, expires_at } = data as { id: string; token: string; expires_at: string };

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const link = `${origin}/invite/${token}`;
  const expires = shortDate(expires_at);

  const { data: hh } = await supabase.from("households").select("name").eq("id", household).maybeSingle();
  const message = invitationEmail({
    inviter: account.profile.display_name,
    household: (hh as { name: string } | null)?.name ?? "your family's",
    side,
    link,
    siteName: SITE_NAME,
    expires,
  });
  const sent = await sendEmail({ to: email, ...message });
  refresh();
  return { status: "created", link, email, emailed: sent.sent, expires };
}

/** Cancels a pending invitation (any active member of its household may). */
export async function revokeInvitation(_prev: HouseholdActionState, form: FormData): Promise<HouseholdActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const invitation = id(form, "invitation");
  if (!invitation) return { status: "error", message: FAILED };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", invitation).is("accepted_at", null).select("id");
  if (error) return failed(error, "revoke invitation");
  if (!data?.length) return { status: "error", message: "That invitation was already used or cancelled." };
  refresh();
  return { status: "done" };
}

/** A guardian removes another member. Access stops at once. */
export async function removeMember(_prev: HouseholdActionState, form: FormData): Promise<HouseholdActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const member = id(form, "member");
  if (!member) return { status: "error", message: FAILED };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("household_members").delete().eq("id", member).select("id");
  if (error) return failed(error, "remove member");
  if (!data?.length) return { status: "error", message: "Only a guardian of this household can remove someone." };
  refresh();
  return { status: "done" };
}

/** Leaves a household (the user's guardian membership and their own student record's). */
export async function leaveHousehold(_prev: HouseholdActionState, form: FormData): Promise<HouseholdActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const household = id(form, "household");
  if (!household) return { status: "error", message: FAILED };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("leave_household", { p_household: household });
  if (error) return failed(error, "leave_household");
  refresh();
  return { status: "done" };
}

/** Grants or removes a guardian's edit access (the student decides; see set_member_can_edit). */
export async function setMemberCanEdit(_prev: HouseholdActionState, form: FormData): Promise<HouseholdActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const member = id(form, "member");
  if (!member) return { status: "error", message: FAILED };
  const canEdit = form.get("can_edit") === "true";
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_member_can_edit", { p_member: member, p_can_edit: canEdit });
  if (error) return failed(error, "set_member_can_edit");
  refresh();
  return { status: "done" };
}
