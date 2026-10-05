/**
 * Households, pure parts (specs/product/accounts.md "Built: households"): the shapes the household functions in
 * supabase/migrations/20261005125000_households.sql return, the rules the UI mirrors (who may remove whom, who may
 * change edit access), the access-log wording, error messages, and the invitation email. No server or browser APIs,
 * so tests, server code, and client components can all import it. Server reads live in lib/households.ts.
 */
import type { MemberRole } from "@/lib/accounts";

/** One row of household_roster(): a co-member's name and role, nothing more. */
export interface RosterMember {
  member_id: string;
  role: MemberRole;
  /** Guardians. */
  user_id: string | null;
  /** Students. */
  student_id: string | null;
  display_name: string | null;
  can_edit: boolean;
  /** A managed student (no account of their own yet). */
  managed: boolean;
  /** A managed student the viewer created. */
  managed_by_me: boolean;
  is_me: boolean;
  joined: string;
}

/** A pending invitation as members see it (the token itself is never stored, so the link can't be shown again). */
export interface PendingInvitation {
  id: string;
  email: string;
  side: MemberRole;
  student_id: string | null;
  can_edit: boolean;
  invited_by: string | null;
  created: string;
  expires_at: string;
}

/** A household the viewer belongs to, with its roster and pending invitations. */
export interface HouseholdView {
  id: string;
  name: string;
  created: string;
  members: RosterMember[];
  invitations: PendingInvitation[];
  /** The viewer's own rows: as a guardian and/or through their own student record. */
  me: { guardian: RosterMember | null; student: RosterMember | null };
}

export function viewerRoles(members: RosterMember[]): HouseholdView["me"] {
  return {
    guardian: members.find((m) => m.is_me && m.role === "guardian") ?? null,
    student: members.find((m) => m.is_me && m.role === "student") ?? null,
  };
}

/** The name to show for a member: their display name, or a role-based fallback (never an email). */
export function memberName(m: Pick<RosterMember, "display_name" | "role" | "managed">): string {
  const name = m.display_name?.trim();
  if (name) return name;
  return m.role === "guardian" ? "A guardian" : "A student";
}

/** Mirrors the "Members: guardians remove" policy: an active guardian removes anyone else (leaving is separate). */
export function canRemove(viewer: HouseholdView["me"], target: RosterMember): boolean {
  return viewer.guardian !== null && !target.is_me;
}

/**
 * Mirrors set_member_can_edit(): may the viewer grant (or revoke) this guardian's edit access? A student of the
 * household may, and so may a guardian when every student there is a managed record they created. Nobody grants
 * themselves; a guardian may always drop their own.
 */
export function editAccessControl(viewer: HouseholdView["me"], target: RosterMember, members: RosterMember[]): { grant: boolean; revoke: boolean } {
  if (target.role !== "guardian") return { grant: false, revoke: false };
  const students = members.filter((m) => m.role === "student");
  const managesAll = viewer.guardian !== null && students.length > 0 && students.every((s) => s.managed_by_me);
  const decides = viewer.student !== null || managesAll;
  return { grant: decides && !target.is_me, revoke: decides || target.is_me };
}

/* ------------------------------------------------------------------ */
/* Access log                                                          */
/* ------------------------------------------------------------------ */

/** One row of my_access_log(). */
export interface AccessLogRow {
  at: string;
  table_name: string;
  viewer_id: string;
  viewer_name: string | null;
}

/**
 * What a logged table is, in the student's words ("viewed your list"). Units that log a new table add it here;
 * anything unknown reads "your information".
 */
export const ACCESS_TABLE_LABELS: Record<string, string> = {
  students: "your student record",
  student_profiles: "your profile",
  lists: "your list",
  list_items: "your list",
  notes: "your notes",
};

export function describeAccessTable(table: string): string {
  return ACCESS_TABLE_LABELS[table] ?? "your information";
}

/** "Mom viewed your list on Oct 2": one line per viewer, thing, and day (a page view logs a row each time). */
export interface AccessLogLine {
  viewer: string;
  what: string;
  day: string;
  /** The latest view that day (ISO). */
  at: string;
  count: number;
}

export function groupAccessLog(rows: AccessLogRow[], timeZone = "America/New_York"): AccessLogLine[] {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
  const lines = new Map<string, AccessLogLine>();
  for (const r of rows) {
    const viewer = r.viewer_name?.trim() || "A former guardian";
    const what = describeAccessTable(r.table_name);
    const day = fmt.format(new Date(r.at));
    const key = `${r.viewer_id}|${what}|${day}`;
    const line = lines.get(key);
    if (line) {
      line.count++;
      if (r.at > line.at) line.at = r.at;
    } else lines.set(key, { viewer, what, day, at: r.at, count: 1 });
  }
  return [...lines.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Plain messages for the household functions' refusals (the SQL raises these names). */
export const HOUSEHOLD_ERRORS: Record<string, string> = {
  not_signed_in: "Your session ended. Sign in again.",
  not_a_member: "You're not in that household any more.",
  invalid_name: "Give it a name (up to 80 characters).",
  invalid_role: "Choose whether you're joining as a guardian or a student.",
  invalid_grad_year: "Enter a graduation year like 2028.",
  invalid_email: "Enter a valid email address.",
  invalid_side: "Choose who you're inviting.",
  invalid_student: "That student isn't one you manage in this household.",
  only_guardians_invite_students: "Only guardians can invite students.",
  only_guardians_add_students: "Only guardians can add a student.",
  only_student_grants_edit: "Only the student decides who can edit their information.",
  cannot_grant_self: "You can't give yourself edit access.",
  member_not_found: "That person isn't in this household any more.",
  account_deleted: "This account is scheduled for deletion.",
  // reissue_invitation (a new link for a pending invitation)
  invitation_not_found: "That invitation isn't pending any more.",
  invitation_used: "That invitation was already accepted.",
  invitation_revoked: "That invitation was cancelled. Invite them again instead.",
};

/** The message for a Supabase/PostgREST error raised by one of the functions above (or accept_invitation's). */
export function errorMessage(error: { message?: string } | null | undefined, messages: Record<string, string>, fallback: string): string {
  const text = error?.message ?? "";
  const key = Object.keys(messages).find((k) => new RegExp(`\\b${k}\\b`).test(text));
  return key ? messages[key] : fallback;
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

/** create_invitation() tokens: two UUIDs without dashes, 64 hex characters. */
export const INVITATION_TOKEN_RE = /^[0-9a-f]{64}$/;

export function isInvitationToken(token: unknown): token is string {
  return typeof token === "string" && INVITATION_TOKEN_RE.test(token);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * The invitation email: plain HTML (light colors, no images, no tracking) and a text alternative. Names come from
 * users, so they're escaped.
 */
export function invitationEmail({
  inviter,
  household,
  side,
  link,
  siteName,
  expires,
}: {
  inviter: string | null;
  household: string;
  side: MemberRole;
  link: string;
  siteName: string;
  expires: string;
}): { subject: string; html: string; text: string } {
  const who = inviter?.trim() || "Someone";
  const as = side === "guardian" ? "a parent or guardian" : "a student";
  const subject = `${who} invited you to the ${household} household on ${siteName}`;
  const lines = [
    `${who} invited you to join the "${household}" household on ${siteName} as ${as}.`,
    side === "guardian"
      ? "Guardians can see the students' college lists and plans. Students never see a guardian's finances."
      : "Your guardians will be able to see your college list and plans. You can leave the household at any time.",
    `Open this link to accept (it works until ${expires}):`,
  ];
  const text = `${lines.join("\n\n")}\n${link}\n\nIf you weren't expecting this, ignore this email.`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f4;color:#1c1830;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d8;border-radius:16px;padding:24px">
<p style="margin:0 0 16px">${escapeHtml(lines[0])}</p>
<p style="margin:0 0 16px;color:#57516b">${escapeHtml(lines[1])}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#5b3df5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:999px">Accept the invitation</a></p>
<p style="margin:0;color:#57516b;font-size:13px">This link works until ${escapeHtml(expires)}. If you weren't expecting it, ignore this email.</p>
</div></body></html>`;
  return { subject, html, text };
}

/** "Oct 12, 2026" for expiry dates and the like. */
export function shortDate(iso: string, timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(new Date(iso));
}

/* ------------------------------------------------------------------ */
/* Deletion preview                                                    */
/* ------------------------------------------------------------------ */

/** account_deletion_preview(). */
export interface DeletionPreview {
  own_student: boolean;
  managed: { id: string; name: string | null; kept: boolean; kept_by: string | null }[];
}

/** The confirmation word the delete form asks for. */
export const DELETE_CONFIRMATION = "delete";

/** Days a deleted account can be restored before scripts/purge-accounts.mts removes it for good. */
export const DELETE_GRACE_DAYS = 30;
