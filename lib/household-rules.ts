/**
 * Households, pure parts (specs/product/accounts.md "Built: households"): the shapes the household functions in
 * supabase/migrations/20261005125000_households.sql return, the rules the UI mirrors (who may remove whom, who may
 * change edit access), the access-log wording, error messages, and the invitation email; plus, for the household
 * hub (specs/product/household-hub.md; 20261006150000_household_hub.sql), roster statuses, avatar letters, person
 * links, and phone numbers. No server or browser APIs,
 * so tests, server code, and client components can all import it. Server reads live in lib/households.ts.
 */
import type { MemberRole } from "@/lib/accounts";

/**
 * Where a roster row stands (specs/product/household-hub.md "The roster"): an active member; a managed student with
 * no account and no invitation ("No account yet"); or someone invited who hasn't accepted, before or after the
 * seven days run out.
 */
export type RosterStatus = "active" | "invited" | "expired" | "managed";

/**
 * One row of household_roster() (supabase/migrations/20261006150000_household_hub.sql): everyone in the household by
 * name, members and pending invitations alike. A pending invitation is a row with `member_id` null and the name the
 * inviter typed; a managed student's hand-over invitation is carried on that student's own row instead.
 */
export interface RosterMember {
  /** household_members.id; null for a pending invitation's row. */
  member_id: string | null;
  role: MemberRole;
  /** Guardians. */
  user_id: string | null;
  /** Students (including a managed record waiting to be handed over). */
  student_id: string | null;
  display_name: string | null;
  can_edit: boolean;
  /** A managed student (no account of their own yet). */
  managed: boolean;
  /** A managed student the viewer created. */
  managed_by_me: boolean;
  is_me: boolean;
  /** When they joined, or for an invitation, when it was sent. */
  joined: string;
  status: RosterStatus;
  /** The pending invitation on this row (an invited person, or a managed student's hand-over). */
  invitation_id: string | null;
  expires_at: string | null;
  /** Students: high school graduation year. */
  grad_year: number | null;
  /** E.164, shown to the household only (formatPhone). */
  phone: string | null;
  /** Only on invitations the viewer sent; null everywhere else. */
  email: string | null;
}

/** A household the viewer belongs to, with its roster (members and pending invitations, in one list). */
export interface HouseholdView {
  id: string;
  name: string;
  created: string;
  members: RosterMember[];
  /** The viewer's own rows: as a guardian and/or through their own student record. */
  me: { guardian: RosterMember | null; student: RosterMember | null };
}

/**
 * Seats in a household (public.household_max_members(); a test checks the two agree): active members plus
 * invitations still waiting for an answer, in any mix of guardians and students. An invitation handing a managed
 * student over to their own account takes no seat (the record already holds one), and neither does an expired one.
 * An account is in one household at a time (specs/product/accounts.md "Built: one household, six seats").
 */
export const HOUSEHOLD_MAX_MEMBERS = 6;

/**
 * Mirrors public.household_seats_taken(): every member row (active members and managed students, whether or not a
 * hand-over is pending on it) plus invitation rows that are still open.
 */
export function householdSeats(h: Pick<HouseholdView, "members">): { taken: number; max: number; full: boolean } {
  const taken = h.members.filter((m) => m.member_id !== null || m.status === "invited").length;
  return { taken, max: HOUSEHOLD_MAX_MEMBERS, full: taken >= HOUSEHOLD_MAX_MEMBERS };
}

/** Pending invitation rows (someone invited who isn't a member yet), and hand-overs waiting on a managed student. */
export function isPending(m: Pick<RosterMember, "status">): boolean {
  return m.status === "invited" || m.status === "expired";
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

/**
 * The roster avatar's letter: the first letter of the first name, else the role's ("G" or "S"). Never an email's,
 * and never "?".
 */
export function memberInitial(m: Pick<RosterMember, "display_name" | "role">): string {
  const first = m.display_name?.trim().split(/\s+/)[0] ?? "";
  const letter = Array.from(first)[0];
  if (letter) return letter.toLocaleUpperCase("en-US");
  return m.role === "guardian" ? "G" : "S";
}

/** The person's page: `/household/<student id>` for a student, `/household/<user id>` for a guardian. */
export function personHref(m: Pick<RosterMember, "student_id" | "user_id">): string | null {
  const id = m.student_id ?? m.user_id;
  return id ? `/household/${id}` : null;
}

/* ------------------------------------------------------------------ */
/* Phones                                                              */
/* ------------------------------------------------------------------ */

/** What the database accepts (profiles.phone, students.phone, invitations.phone): E.164. */
export const E164_RE = /^\+[1-9][0-9]{6,14}$/;

/**
 * A phone number as typed, in E.164, or null when it can't be one. Punctuation and spaces are dropped; ten digits
 * (or eleven starting with 1) are a US number; a leading "+" with 7 to 15 digits is taken as is. Only the US is
 * known as a default country; anything else needs the "+".
 */
export function normalizePhone(input: unknown, defaultCountry: "US" | string = "US"): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || /[^0-9+\s().\-]/.test(trimmed)) return null;
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (trimmed.startsWith("+")) {
    if (trimmed.indexOf("+", 1) !== -1) return null;
    const e164 = `+${digits}`;
    return E164_RE.test(e164) ? e164 : null;
  }
  if (trimmed.includes("+") || defaultCountry !== "US") return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "(615) 555-0100" for a US number; any other E.164 number as stored. */
export function formatPhone(e164: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}

/** Mirrors the "Members: guardians remove" policy: an active guardian removes anyone else (leaving is separate). */
export function canRemove(viewer: HouseholdView["me"], target: RosterMember): boolean {
  return viewer.guardian !== null && !target.is_me && target.member_id !== null;
}

/**
 * Mirrors set_member_can_edit(): may the viewer grant (or revoke) this guardian's edit access? A student of the
 * household may, and so may a guardian when every student there is a managed record they created. Nobody grants
 * themselves; a guardian may always drop their own.
 */
export function editAccessControl(viewer: HouseholdView["me"], target: RosterMember, members: RosterMember[]): { grant: boolean; revoke: boolean } {
  if (target.role !== "guardian" || target.member_id === null) return { grant: false, revoke: false };
  // Only member rows count (the SQL looks at active memberships, not invitations).
  const students = members.filter((m) => m.role === "student" && m.member_id !== null);
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
  // One household per account, six seats (20261005170000_household_limits_and_home.sql)
  already_in_household: "You're already in a household. Leave it first to start or join another.",
  household_full: `This household is full: ${HOUSEHOLD_MAX_MEMBERS} people, counting invitations waiting for an answer. Cancel an invitation or remove someone to make room.`,
  // The household hub (20261006150000_household_hub.sql)
  invalid_phone: "Enter a phone number like (615) 555-0100, or one starting with + and the country code.",
  invite_self: "That's your own email. Enter theirs.",
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
 * users, so they're escaped. `mode` is which link it carries: "password" for the invite Edge Function's link, which
 * signs a new person in so all that's left is choosing a password; "accept" (the default) for the plain
 * /invite/<token> link, which someone who already has an account opens and signs in to accept.
 */
export function invitationEmail({
  inviter,
  household,
  side,
  link,
  siteName,
  expires,
  mode = "accept",
}: {
  inviter: string | null;
  household: string;
  side: MemberRole;
  link: string;
  siteName: string;
  expires: string;
  mode?: "password" | "accept";
}): { subject: string; html: string; text: string } {
  const who = inviter?.trim() || "Someone";
  const as = side === "guardian" ? "a parent or guardian" : "a student";
  const subject = `${who} invited you to the ${household} household on ${siteName}`;
  const lines = [
    `${who} invited you to join the "${household}" household on ${siteName} as ${as}.`,
    side === "guardian"
      ? "Guardians can see the students' college lists and plans. Students never see a guardian's finances."
      : "Your guardians will be able to see your college list and plans. You can leave the household at any time.",
    mode === "password"
      ? `Open this link to choose a password (it works until ${expires}):`
      : `Open this link and sign in to accept (it works until ${expires}):`,
  ];
  const button = mode === "password" ? "Choose a password" : "Accept the invitation";
  const text = `${lines.join("\n\n")}\n${link}\n\nIf you weren't expecting this, ignore this email.`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f4;color:#1c1830;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d8;border-radius:16px;padding:24px">
<p style="margin:0 0 16px">${escapeHtml(lines[0])}</p>
<p style="margin:0 0 16px;color:#57516b">${escapeHtml(lines[1])}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#5b3df5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:999px">${button}</a></p>
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
