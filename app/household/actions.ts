"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getAccount } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { SITE_NAME } from "@/lib/brand";
import { EMAIL_RE, HOUSEHOLD_ERRORS, errorMessage, invitationEmail, shortDate } from "@/lib/household-rules";
import { invitationLink, isUuid, parseAddPerson, requestOrigin } from "@/lib/household-hub";

/**
 * Household Server Actions (specs/product/household-hub.md; specs/product/accounts.md "Built: households"). Each one
 * checks the session and sends only ids and the user's change; the database functions and policies decide whether
 * it's allowed, and their refusals come back as plain messages (HOUSEHOLD_ERRORS).
 *
 * Invitations travel as this site's own seven-day link, /invite/<token>, whether emailed, shown, or copied. The invite
 * Edge Function (lib/invite-function.ts) is called only when the invited person opens that link
 * (app/invite/[token]/actions.ts), because the sign-in link it mints lasts about an hour and each new one cancels the
 * last.
 */

export type HouseholdActionState = { status: "idle" } | { status: "done"; message?: string } | { status: "error"; message: string };

export type AddPersonState =
  | { status: "idle" }
  | { status: "added"; name: string }
  | { status: "invited"; name: string; email: string; link: string | null; emailed: boolean; expires: string; fallback?: "signed-in-accept" }
  | { status: "error"; message: string };

const FAILED = "That didn't work. Try again in a moment.";

function id(form: FormData, name: string): string | null {
  const v = String(form.get(name) ?? "");
  return isUuid(v) ? v : null;
}

async function signedIn() {
  const account = await getAccount();
  if (!account) return null;
  if (account.profile.deleted_at) return null;
  return account;
}

const SESSION_ENDED = { status: "error", message: HOUSEHOLD_ERRORS.not_signed_in } as const;

function failed(error: { message?: string }, what: string): { status: "error"; message: string } {
  console.error(`household: ${what} failed: ${error.message}`);
  return { status: "error", message: errorMessage(error, HOUSEHOLD_ERRORS, FAILED) };
}

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Shows the invitation's link and emails it when email is set up ("not configured" is normal before the sending
 * domain exists, and the on-screen link covers it). The email says "choose a password": opening the link signs a new
 * person in through the invite Edge Function; someone who already has an account is asked to sign in instead.
 */
async function deliverInvitation(
  supabase: Supabase,
  inv: { household: string; name: string; email: string; side: "guardian" | "student"; token: string; expiresAt: string; inviter: string | null },
): Promise<AddPersonState> {
  const link = invitationLink(requestOrigin(await headers()), inv.token);
  const expires = shortDate(inv.expiresAt);
  const { data: hh } = await supabase.from("households").select("name").eq("id", inv.household).maybeSingle();
  const message = invitationEmail({
    inviter: inv.inviter,
    household: (hh as { name: string } | null)?.name ?? "your family's",
    side: inv.side,
    link,
    siteName: SITE_NAME,
    expires,
    mode: "password",
  });
  const sent = await sendEmail({ to: inv.email, ...message });
  return { status: "invited", name: inv.name, email: inv.email, link, emailed: sent.sent, expires };
}

/**
 * Add someone (specs/product/household-hub.md "Adding a person"): a parent or guardian is invited by email; a student
 * without an email becomes a managed record; a student with one becomes a managed record plus an invitation to claim
 * it (create_invitation's eight-argument form does both, one seat). With `household` empty, the viewer starts a
 * household named `household_name` first, joining as `my_role`.
 */
export async function addPerson(_prev: AddPersonState, form: FormData): Promise<AddPersonState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const parsed = parseAddPerson(form, account.user.email);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const input = parsed.value;
  const supabase = await createServerSupabase();

  let household = input.household;
  if (!household) {
    const created = await supabase.rpc("create_household", { p_name: input.householdName, p_role: input.myRole });
    if (created.error) return failed(created.error, "create_household");
    household = created.data as string;
  }

  if (input.email) {
    const { data, error } = await supabase.rpc("create_invitation", {
      p_household: household,
      p_email: input.email,
      p_side: input.role,
      p_student: null,
      p_can_edit: input.canEdit,
      p_display_name: input.displayName,
      p_phone: input.phone,
      p_grad_year: input.gradYear,
    });
    if (error) {
      refresh();
      return failed(error, "create_invitation");
    }
    const inv = data as { id: string; token: string; expires_at: string };
    const delivered = await deliverInvitation(supabase, {
      household,
      name: input.displayName,
      email: input.email,
      side: input.role,
      token: inv.token,
      expiresAt: inv.expires_at,
      inviter: account.profile.display_name,
    });
    refresh();
    return delivered;
  }

  // A student without an email: a managed record the guardian keeps until the student claims it.
  const { data: studentId, error } = await supabase.rpc("add_managed_student", { p_household: household, p_name: input.displayName, p_grad_year: input.gradYear });
  if (error) {
    refresh();
    return failed(error, "add_managed_student");
  }
  if (input.phone) {
    const phone = await supabase.from("students").update({ phone: input.phone }).eq("id", studentId as string);
    if (phone.error) console.error(`household: saving a managed student's phone failed: ${phone.error.message}`);
  }
  refresh();
  return { status: "added", name: input.displayName };
}

/**
 * "Invite them" on a managed student's row: an invitation to the student's email that hands the record over when they
 * accept (no new seat). If they already have a record of their own, accepting merges this one into it.
 */
export async function inviteManagedStudent(_prev: AddPersonState, form: FormData): Promise<AddPersonState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const household = id(form, "household");
  const student = id(form, "student");
  const name = String(form.get("name") ?? "").trim() || "Your student";
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!household || !student) return { status: "error", message: FAILED };
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: "error", message: HOUSEHOLD_ERRORS.invalid_email };
  if (account.user.email && email === account.user.email.toLowerCase()) return { status: "error", message: HOUSEHOLD_ERRORS.invite_self };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_household: household,
    p_email: email,
    p_side: "student",
    p_student: student,
    p_can_edit: false,
    p_display_name: name,
    p_phone: null,
    p_grad_year: null,
  });
  if (error) return failed(error, "create_invitation (hand-over)");
  const inv = data as { id: string; token: string; expires_at: string };
  const delivered = await deliverInvitation(supabase, { household, name, email, side: "student", token: inv.token, expiresAt: inv.expires_at, inviter: account.profile.display_name });
  refresh();
  return delivered;
}

/**
 * "Copy link" on an invited row: the same /invite/<token> link that was sent, read from the stored token (household
 * members can read their household's invitations). Nothing is minted, so the link already sent keeps working.
 */
export async function copyInvitationLink(invitationId: string): Promise<{ link: string } | { error: string }> {
  if (!(await signedIn())) return { error: HOUSEHOLD_ERRORS.not_signed_in };
  if (!isUuid(invitationId)) return { error: FAILED };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("invitations")
    .select("token, expires_at")
    .eq("id", invitationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    console.error(`household: reading an invitation's token failed: ${error.message}`);
    return { error: FAILED };
  }
  const row = data as { token: string | null; expires_at: string } | null;
  if (!row?.token) return { error: "That invitation isn't waiting any more. Use Send again to make a new link." };
  if (Date.parse(row.expires_at) <= Date.now()) return { error: "That link has expired. Use Send again to make a new one." };
  return { link: invitationLink(requestOrigin(await headers()), row.token) };
}

/**
 * "Send again" on an invited or expired row: a new link with a fresh seven days (reissue_invitation; the old link
 * stops working), emailed when email is set up and shown to copy either way.
 */
export async function resendInvitation(_prev: AddPersonState, form: FormData): Promise<AddPersonState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const invitation = id(form, "invitation");
  const household = id(form, "household");
  const name = String(form.get("name") ?? "").trim() || "them";
  if (!invitation || !household) return { status: "error", message: FAILED };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("reissue_invitation", { p_invitation: invitation });
  if (error) return failed(error, "reissue_invitation");
  const re = data as { token: string; expires_at: string; email: string; side: "guardian" | "student" };
  const delivered = await deliverInvitation(supabase, { household, name, email: re.email, side: re.side, token: re.token, expiresAt: re.expires_at, inviter: account.profile.display_name });
  refresh();
  return delivered;
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
  redirect("/household");
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
