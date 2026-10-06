/**
 * The household hub's pure parts (specs/product/household-hub.md): reading the Add someone form, the links an
 * invitation travels as, the "choose a password" step's address, the roster's status line, and the hub's summary
 * line. No Next.js, server, or browser APIs, so tests (tests/household-hub-pages.test.mts), Server Actions, and
 * client components can all import it. Server reads live in lib/households.ts; shared rules in lib/household-rules.ts.
 */
import type { MemberRole } from "./accounts.ts";
import { EMAIL_RE, HOUSEHOLD_ERRORS, memberName, normalizePhone, shortDate, type RosterMember } from "./household-rules.ts";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* ------------------------------------------------------------------ */
/* Add someone                                                         */
/* ------------------------------------------------------------------ */

/** What addPerson needs, read and checked from the form. */
export interface AddPersonInput {
  /** The household to add to; null to start one first (`householdName` then names it). */
  household: string | null;
  householdName: string | null;
  /** The viewer's own role in a household started here. */
  myRole: MemberRole;
  role: MemberRole;
  /** "First Last", or just the first name. */
  displayName: string;
  firstName: string;
  /** Lowercased; null for a student added without one. */
  email: string | null;
  /** E.164. */
  phone: string | null;
  /** Students only. */
  gradYear: number | null;
  /** A guardian invited by a student: may edit the student's list and profile. */
  canEdit: boolean;
}

export type ParsedAddPerson = { ok: true; value: AddPersonInput } | { ok: false; message: string };

/** Anything with FormData's `get` (tests pass a Map-backed stand-in). */
export interface FormLike {
  get(name: string): unknown;
}

function text(form: FormLike, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

const MAX_NAME = 80;

/**
 * Reads the Add someone form (components/account/AddPersonForm.tsx). Fields: `household` (an id, or "" to start a
 * household named `household_name`, with the viewer joining as `my_role`), `role` (guardian | student),
 * `first_name`, `last_name?`, `email?` (required for a guardian), `phone?`, `grad_year?` (students), `can_edit?`.
 * `viewerEmail` refuses inviting yourself before the database does. The database checks every rule again.
 */
export function parseAddPerson(form: FormLike, viewerEmail: string | null = null): ParsedAddPerson {
  const fail = (message: string): ParsedAddPerson => ({ ok: false, message });

  const householdField = text(form, "household");
  let household: string | null = null;
  let householdName: string | null = null;
  if (householdField) {
    if (!isUuid(householdField)) return fail("That household isn't available. Reload the page and try again.");
    household = householdField;
  } else {
    householdName = text(form, "household_name");
    if (!householdName || householdName.length > MAX_NAME) return fail(HOUSEHOLD_ERRORS.invalid_name);
  }
  const myRole: MemberRole = form.get("my_role") === "student" ? "student" : "guardian";

  const roleField = form.get("role");
  if (roleField !== "guardian" && roleField !== "student") return fail("Choose a parent or guardian, or a student.");
  const role: MemberRole = roleField;
  // Only guardians add students (the database says so too); someone starting a household as the student adds a parent.
  if (!household && role === "student" && myRole === "student") return fail(HOUSEHOLD_ERRORS.only_guardians_add_students);

  const firstName = text(form, "first_name");
  const lastName = text(form, "last_name");
  if (!firstName) return fail("Enter their first name.");
  const displayName = lastName ? `${firstName} ${lastName}` : firstName;
  if (displayName.length > MAX_NAME) return fail(`Keep the name under ${MAX_NAME} characters.`);

  const emailField = text(form, "email").toLowerCase();
  const email = emailField || null;
  if (role === "guardian" && !email) return fail("Enter their email: that's where their link goes.");
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) return fail(HOUSEHOLD_ERRORS.invalid_email);
  if (email && viewerEmail && email === viewerEmail.trim().toLowerCase()) return fail(HOUSEHOLD_ERRORS.invite_self);

  const phoneField = text(form, "phone");
  const phone = phoneField ? normalizePhone(phoneField) : null;
  if (phoneField && !phone) return fail(HOUSEHOLD_ERRORS.invalid_phone);

  let gradYear: number | null = null;
  const yearField = text(form, "grad_year");
  if (role === "student" && yearField) {
    const n = Number(yearField);
    if (!/^\d{4}$/.test(yearField) || n < 2000 || n > 2100) return fail(HOUSEHOLD_ERRORS.invalid_grad_year);
    gradYear = n;
  }

  const canEdit = role === "guardian" && (form.get("can_edit") === "on" || form.get("can_edit") === "true");

  return { ok: true, value: { household, householdName, myRole, role, displayName, firstName, email, phone, gradYear, canEdit } };
}

/**
 * "The Ross household" from "Tracy Ross": the last word of a name with at least two, for the household-name field
 * a solo viewer sees. Empty when there's only one word (or none), so the field starts blank.
 */
export function defaultHouseholdName(displayName: string | null | undefined): string {
  const words = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return "";
  return `The ${words[words.length - 1]} household`;
}

/**
 * Which role the Add someone form starts on: a student adds a parent; a guardian most often adds a student
 * (specs/product/household-hub.md "Adding a person").
 */
export function defaultAddRole(viewer: { guardian: unknown; student: unknown } | null, myRole: MemberRole = "guardian"): MemberRole {
  if (viewer) return viewer.guardian ? "student" : "guardian";
  return myRole === "guardian" ? "student" : "guardian";
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/**
 * This site's origin for a request: the Origin header when there is one (Server Actions always send it), else the
 * forwarded protocol and host.
 */
export function requestOrigin(h: { get(name: string): string | null }): string {
  const origin = h.get("origin");
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost";
  return `${proto}://${host}`;
}

/** The seven-day invitation link that is emailed, shown, and copied: always ours, never Supabase's hour-long one. */
export function invitationLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${token}`;
}

/**
 * The "choose a password" step for someone the invite Edge Function just signed in. With an invitation id when the
 * caller knows it; without, "welcome=1" and the page finds the invitation recorded for the signed-in user.
 */
export function welcomePath(invitationId?: string | null): string {
  return `/account/password?welcome=${invitationId && isUuid(invitationId) ? invitationId : "1"}`;
}

/** Where the Edge Function's sign-in link lands: /auth/confirm, which signs them in and moves on to the password step. */
export function inviteRedirectTo(origin: string, invitationId?: string | null): string {
  return `${origin.replace(/\/+$/, "")}/auth/confirm?next=${encodeURIComponent(welcomePath(invitationId))}`;
}

/** The `welcome` query value on /account/password: an invitation id, "1" (find the one recorded for me), or null (an ordinary visit). */
export function parseWelcome(value: unknown): { invitation: string | null } | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string" || !v) return null;
  if (isUuid(v)) return { invitation: v.toLowerCase() };
  return v === "1" ? { invitation: null } : null;
}

/** A person's own page: their student record's for a student, their user id's for everyone else. */
export function ownPersonPath(studentId: string | null, userId: string): string {
  return `/household/${studentId ?? userId}`;
}

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

/** The roster's status chip: "Invited · expires Oct 13", "Expired", "No account yet", or nothing for an active member. */
export function statusLabel(m: Pick<RosterMember, "status" | "expires_at">, timeZone?: string): string | null {
  switch (m.status) {
    case "invited":
      return m.expires_at ? `Invited · expires ${shortDate(m.expires_at, timeZone).replace(/, \d{4}$/, "")}` : "Invited";
    case "expired":
      return "Expired";
    case "managed":
      return "No account yet";
    default:
      return null;
  }
}

/** "Alex · Tracy (you) · Jordan (invited)": the household summary on /account, names only. */
export function rosterLine(members: Pick<RosterMember, "display_name" | "role" | "managed" | "is_me" | "status">[]): string {
  return members
    .map((m) => `${memberName(m)}${m.is_me ? " (you)" : m.status === "invited" ? " (invited)" : m.status === "expired" ? " (invitation expired)" : ""}`)
    .join(" · ");
}
