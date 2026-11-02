"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getAccount } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { supabaseClient } from "@/lib/supabase";
import { emailConfigured, sendEmail } from "@/lib/email";
import { SITE_NAME } from "@/lib/brand";
import { trackServer } from "@/lib/analytics-server";
import { EMAIL_RE, shortDate } from "@/lib/household-rules";
import { isUuid, requestOrigin } from "@/lib/household-hub";
import { myOrganization, orgRoster } from "@/lib/orgs";
import { ORG_ASK_NOTE_MAX, ORG_NAME_MAX, ORG_NOTE_MAX, joinHref, orgErrorMessage, type OrgAskKind } from "@/lib/org-rules";
import { ORG_DELETE_CONFIRMATION, ORG_INVITE_BATCH_MAX, isRecordSection, type StudentInviteResult } from "@/lib/org-caseload";
import { orgInvitationEmail } from "@/lib/emails/org-invitation";
import { orgAskEmail } from "@/lib/emails/org-ask";
import { planHref } from "@/lib/planner/plan-tabs";
import { CASELOAD_HREF } from "@/lib/org-hrefs";

/**
 * The counselor portal's Server Actions (specs/product/counselor-portal.md "The counselor's pages"). Each checks the
 * session and sends only ids and the counselor's change; the database functions and policies
 * (supabase/migrations/20261102120000_organizations.sql) decide whether it's allowed, and their refusals come back as
 * plain sentences (lib/org-rules.ts orgErrorMessage). The portal is free, so no entitlement is asked.
 *
 * Invitations travel as the site's own 30-day link, `/join/<token>`, emailed when email is set up and always shown to
 * copy. An ask emails the student once, when they have an account.
 */

/** The same shape as the household's, so the hub's HouseholdActionButton runs these too. */
export type OrgActionState = { status: "idle" } | { status: "done"; message?: string } | { status: "error"; message: string };

export type InviteStudentsState = { status: "idle" } | { status: "invited"; results: StudentInviteResult[] } | { status: "error"; message: string };

export type InviteCounselorState =
  | { status: "idle" }
  | { status: "invited"; email: string; link: string; emailed: boolean; expires: string }
  | { status: "error"; message: string };

const SESSION_ENDED = { status: "error", message: orgErrorMessage("not_signed_in") } as const;

async function signedIn() {
  const account = await getAccount();
  if (!account || account.profile.deleted_at) return null;
  return account;
}

function id(form: FormData, name: string): string | null {
  const v = String(form.get(name) ?? "");
  return isUuid(v) ? v : null;
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function failed(error: { message?: string }, what: string): { status: "error"; message: string } {
  console.error(`org: ${what} failed: ${error.message}`);
  return { status: "error", message: orgErrorMessage(error.message) };
}

const BAD_REQUEST = { status: "error", message: "That didn't work. Reload the page and try again." } as const;

/** A website as typed ("riveracollege.com"), or null; the SQL checks its length. */
function website(form: FormData): string | null {
  const v = text(form, "website");
  return v ? v.slice(0, 200) : null;
}

function gradYear(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2040 ? n : null;
}

/* ------------------------------------------------------------------ */
/* The organization                                                    */
/* ------------------------------------------------------------------ */

/** Start an organization (the caller becomes its owner) and land on the caseload. */
export async function createOrganization(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const name = text(form, "name");
  const kind = text(form, "kind");
  if (!name || name.length > ORG_NAME_MAX) return { status: "error", message: orgErrorMessage("invalid_name") };
  if (kind !== "iec" && kind !== "school") return { status: "error", message: orgErrorMessage("invalid_kind") };
  const ncessch = kind === "school" ? text(form, "highSchoolId") || null : null;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_organization", { p_name: name, p_kind: kind, p_ncessch: ncessch, p_website: website(form) });
  if (error) return failed(error, "create_organization");
  await trackServer("org_created", { kind });
  redirect(CASELOAD_HREF);
}

/** The owner changes the name, high school, or website. */
export async function updateOrganization(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const org = id(form, "org");
  const name = text(form, "name");
  if (!org) return BAD_REQUEST;
  if (!name || name.length > ORG_NAME_MAX) return { status: "error", message: orgErrorMessage("invalid_name") };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_organization", { p_org: org, p_name: name, p_ncessch: text(form, "highSchoolId") || null, p_website: website(form) });
  if (error) return failed(error, "update_organization");
  refresh();
  return { status: "done", message: "Saved." };
}

/** A new join code; the old one stops working at once. */
export async function regenerateJoinCode(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const org = id(form, "org");
  if (!org) return BAD_REQUEST;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("regenerate_join_code", { p_org: org });
  if (error) return failed(error, "regenerate_join_code");
  refresh();
  return { status: "done", message: "New code made. The old one no longer works." };
}

/** Name another owner, or make an owner a counselor (the last owner can't step down). */
export async function setMemberRole(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const member = id(form, "member");
  const role = text(form, "role");
  if (!member || (role !== "owner" && role !== "counselor")) return BAD_REQUEST;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_org_member_role", { p_member: member, p_role: role });
  if (error) return failed(error, "set_org_member_role");
  refresh();
  return { status: "done" };
}

export async function removeMember(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const member = id(form, "member");
  if (!member) return BAD_REQUEST;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("remove_org_member", { p_member: member });
  if (error) return failed(error, "remove_org_member");
  refresh();
  return { status: "done" };
}

export async function leaveOrganization(_prev: OrgActionState, _form: FormData): Promise<OrgActionState> {
  void _form;
  if (!(await signedIn())) return SESSION_ENDED;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("leave_organization");
  if (error) return failed(error, "leave_organization");
  redirect(CASELOAD_HREF);
}

/** The owner deletes the organization after typing the confirmation word: every grant ends, notes and asks go. */
export async function deleteOrganization(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const org = id(form, "org");
  if (!org) return BAD_REQUEST;
  if (text(form, "confirm").toLowerCase() !== ORG_DELETE_CONFIRMATION) return { status: "error", message: `Type “${ORG_DELETE_CONFIRMATION}” to confirm.` };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("delete_organization", { p_org: org });
  if (error) return failed(error, "delete_organization");
  redirect(CASELOAD_HREF);
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

async function inviteOne(
  supabase: Supabase,
  inv: { org: string; orgName: string; inviter: string | null; side: "student" | "counselor"; email: string; displayName: string | null; gradYear: number | null; origin: string },
): Promise<{ ok: true; link: string; emailed: boolean; expires: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("org_invite", {
    p_org: inv.org,
    p_side: inv.side,
    p_email: inv.email,
    p_display_name: inv.displayName,
    p_grad_year: inv.gradYear,
  });
  if (error) {
    console.error(`org: org_invite failed: ${error.message}`);
    return { ok: false, message: orgErrorMessage(error.message) };
  }
  const row = data as { id: string; token: string; expires_at: string };
  const link = `${inv.origin}${joinHref(row.token)}`;
  const expires = shortDate(row.expires_at);
  const message = orgInvitationEmail({
    inviter: inv.inviter,
    orgName: inv.orgName,
    side: inv.side,
    link,
    siteName: SITE_NAME,
    expires,
    firstName: inv.side === "student" ? (inv.displayName?.split(/\s+/)[0] ?? null) : null,
  });
  const sent = await sendEmail({ to: inv.email, ...message });
  return { ok: true, link, emailed: sent.sent, expires };
}

/**
 * Invite one or several students (specs "How a student joins", the invitation door). `rows` is JSON from the form:
 * [{ firstName, lastName, email, gradYear }], at most ORG_INVITE_BATCH_MAX. Each line succeeds or fails on its own.
 */
export async function inviteStudents(_prev: InviteStudentsState, form: FormData): Promise<InviteStudentsState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const org = await myOrganization();
  if (!org || org.id !== id(form, "org")) return { status: "error", message: orgErrorMessage("not_a_member") };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("rows") ?? "[]"));
  } catch {
    return BAD_REQUEST;
  }
  const rows = (Array.isArray(raw) ? raw : [])
    .map((r) => r as { firstName?: unknown; lastName?: unknown; email?: unknown; gradYear?: unknown })
    .map((r) => ({
      first: String(r.firstName ?? "").trim().slice(0, 60),
      last: String(r.lastName ?? "").trim().slice(0, 60),
      email: String(r.email ?? "").trim().toLowerCase(),
      gradYear: gradYear(r.gradYear),
    }))
    .filter((r) => r.first || r.email);
  if (rows.length === 0) return { status: "error", message: "Add at least one student with an email address." };
  if (rows.length > ORG_INVITE_BATCH_MAX) return { status: "error", message: `Add at most ${ORG_INVITE_BATCH_MAX} students at a time.` };

  const supabase = await createServerSupabase();
  const origin = requestOrigin(await headers());
  const results: StudentInviteResult[] = [];
  for (const r of rows) {
    const name = [r.first, r.last].filter(Boolean).join(" ") || r.email;
    if (!EMAIL_RE.test(r.email)) {
      results.push({ name, email: r.email, link: null, emailed: false, expires: null, error: orgErrorMessage("invalid_email") });
      continue;
    }
    const out = await inviteOne(supabase, {
      org: org.id,
      orgName: org.name,
      inviter: account.profile.display_name,
      side: "student",
      email: r.email,
      displayName: name === r.email ? null : name,
      gradYear: r.gradYear,
      origin,
    });
    if (out.ok) {
      await trackServer("org_student_invited", { method: "email" });
      results.push({ name, email: r.email, link: out.link, emailed: out.emailed, expires: out.expires, error: null });
    } else {
      results.push({ name, email: r.email, link: null, emailed: false, expires: null, error: out.message });
    }
  }
  refresh();
  return { status: "invited", results };
}

/** Send a pending student invitation again (org_invite returns the pending one for the same email). */
export async function resendStudentInvitation(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const invitation = id(form, "invitation");
  const org = await myOrganization();
  if (!invitation || !org) return BAD_REQUEST;
  const row = (await orgRoster(org.id)).find((r) => r.invitation_id === invitation);
  if (!row?.email) return { status: "error", message: orgErrorMessage("invitation_not_found") };
  const supabase = await createServerSupabase();
  const out = await inviteOne(supabase, {
    org: org.id,
    orgName: org.name,
    inviter: account.profile.display_name,
    side: "student",
    email: row.email,
    displayName: row.display_name,
    gradYear: row.grad_year,
    origin: requestOrigin(await headers()),
  });
  if (!out.ok) return { status: "error", message: out.message };
  refresh();
  return { status: "done", message: out.emailed ? `Sent again to ${row.email}.` : "Email isn't set up here. Copy the link instead." };
}

export async function cancelOrgInvitation(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const invitation = id(form, "invitation");
  if (!invitation) return BAD_REQUEST;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("cancel_org_invitation", { p_invitation: invitation });
  if (error) return failed(error, "cancel_org_invitation");
  refresh();
  return { status: "done" };
}

/** An owner invites a counselor by email: a 30-day link, emailed when configured, always shown to copy. */
export async function inviteCounselor(_prev: InviteCounselorState, form: FormData): Promise<InviteCounselorState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const org = await myOrganization();
  if (!org || org.id !== id(form, "org")) return { status: "error", message: orgErrorMessage("not_a_member") };
  const email = text(form, "email").toLowerCase();
  if (!EMAIL_RE.test(email)) return { status: "error", message: orgErrorMessage("invalid_email") };
  const supabase = await createServerSupabase();
  const out = await inviteOne(supabase, {
    org: org.id,
    orgName: org.name,
    inviter: account.profile.display_name,
    side: "counselor",
    email,
    displayName: text(form, "name").slice(0, 120) || null,
    gradYear: null,
    origin: requestOrigin(await headers()),
  });
  if (!out.ok) return { status: "error", message: out.message };
  refresh();
  return { status: "invited", email, link: out.link, emailed: out.emailed, expires: out.expires };
}

/* ------------------------------------------------------------------ */
/* Asks and notes                                                      */
/* ------------------------------------------------------------------ */

/** The student's own email, read with the service role only after org_ask succeeded (which proved the grant). */
async function studentEmail(userId: string): Promise<string | null> {
  try {
    const { data } = await supabaseClient("publish").auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask a student for a missing record section, their first colleges, or one custom line (specs "Asking a student for
 * something"). org_ask holds the limits (one open per section, three a week); the student is emailed once when they
 * have an account and email is set up.
 */
export async function askStudent(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const account = await signedIn();
  if (!account) return SESSION_ENDED;
  const org = id(form, "org");
  const student = id(form, "student");
  const kind = text(form, "kind") as OrgAskKind;
  if (!org || !student || !["record_section", "list", "custom"].includes(kind)) return BAD_REQUEST;
  const section = kind === "record_section" ? text(form, "section") : null;
  if (kind === "record_section" && !isRecordSection(section)) return BAD_REQUEST;
  const note = kind === "custom" ? text(form, "note") : null;
  if (kind === "custom" && (!note || note.length > ORG_ASK_NOTE_MAX)) return { status: "error", message: orgErrorMessage("invalid_ask") };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("org_ask", { p_org: org, p_student: student, p_kind: kind, p_section: section, p_note: note });
  if (error) return failed(error, "org_ask");
  await trackServer("org_ask_sent", { kind });

  // The one email (best effort: the ask is recorded either way, and shows in the student's advisor).
  if (emailConfigured()) {
    try {
      const [{ data: s }, organization] = await Promise.all([supabase.from("students").select("user_id").eq("id", student).maybeSingle(), myOrganization()]);
      const userId = (s as { user_id: string | null } | null)?.user_id ?? null;
      const to = userId ? await studentEmail(userId) : null;
      if (to && organization) {
        const link = `${requestOrigin(await headers())}${planHref({ tab: "next" })}`;
        await sendEmail({
          to,
          ...orgAskEmail({ ask: { kind, section, note, asked_by_name: account.profile.display_name, org_name: organization.name }, link, siteName: SITE_NAME }),
        });
      }
    } catch (err) {
      console.error(`org: ask email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  refresh();
  return { status: "done", message: "Asked." };
}

/** Mark an ask done: the family from the notice (a custom ask), or the office. */
export async function completeAsk(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const request = id(form, "request");
  if (!request) return BAD_REQUEST;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("org_ask_done", { p_request: request });
  if (error) return failed(error, "org_ask_done");
  refresh();
  return { status: "done" };
}

/** A note the office keeps on a student (the family never sees it). The author is stamped by the database. */
export async function addOrgNote(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const org = id(form, "org");
  const student = id(form, "student");
  const body = text(form, "body");
  if (!org || !student) return BAD_REQUEST;
  if (!body) return { status: "error", message: "Write the note first." };
  if (body.length > ORG_NOTE_MAX) return { status: "error", message: `Keep a note under ${ORG_NOTE_MAX.toLocaleString("en-US")} characters.` };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("org_notes").insert({ org_id: org, student_id: student, body });
  if (error) return failed(error, "org_notes insert");
  refresh();
  return { status: "done", message: "Saved." };
}

/** The author deletes their own note (the policy allows only the author). */
export async function deleteOrgNote(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  if (!(await signedIn())) return SESSION_ENDED;
  const note = id(form, "note");
  if (!note) return BAD_REQUEST;
  const supabase = await createServerSupabase();
  const { error, count } = await supabase.from("org_notes").delete({ count: "exact" }).eq("id", note);
  if (error) return failed(error, "org_notes delete");
  if (count === 0) return { status: "error", message: "Only the note's author can delete it." };
  refresh();
  return { status: "done" };
}
