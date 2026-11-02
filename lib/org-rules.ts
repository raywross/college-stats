/**
 * The counselor portal's pure rules and types (specs/product/counselor-portal.md): organizations, their members, the
 * caseload's roster, the family's view of a grant, asks and notes, the error sentences for the SQL functions'
 * refusals, and the join-code format. Rows mirror supabase/migrations/20261102120000_organizations.sql. No server or
 * browser APIs here, so tests, server code, and client components can all import it; server reads live in lib/orgs.ts.
 */

export type OrgKind = "iec" | "school";
export type OrgRole = "owner" | "counselor";

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  iec: "Independent consultant",
  school: "School counseling office",
};

/** A member as my_organization() returns them (names come through the function: profiles is own-row only). */
export interface OrgMember {
  member_id: string;
  user_id: string;
  display_name: string | null;
  role: OrgRole;
  is_me: boolean;
  joined: string;
}

/** my_organization(): the caller's organization, with the caller's role and every member. */
export interface Organization {
  id: string;
  name: string;
  kind: OrgKind;
  /** The school's high school (public.high_schools.id); null for consultants. */
  ncessch: string | null;
  website: string | null;
  /** Stored without the "QUAD-" prefix (formatJoinCode adds it). */
  join_code: string;
  created: string;
  my_role: OrgRole;
  members: OrgMember[];
}

/** org_roster(): a student with a live grant ("active"), or a student invitation ("invited", "expired"). */
export interface OrgRosterRow {
  status: "active" | "invited" | "expired";
  /** Active rows. */
  grant_id: string | null;
  student_id: string | null;
  display_name: string | null;
  grad_year: number | null;
  can_edit: boolean | null;
  granted_at: string | null;
  source: "invite" | "code" | null;
  has_account: boolean | null;
  /** Invitation rows. */
  invitation_id: string | null;
  /** The email the counselor typed (invitation rows only). */
  email: string | null;
  expires_at: string | null;
  /** The clear token for Copy link while the invitation is pending; null once expired. */
  token: string | null;
}

/** my_counselor_grants(): a live grant as the student or their guardian sees it in /account. */
export interface CounselorGrantView {
  grant_id: string;
  org_id: string;
  org_name: string;
  /** Members' names, owners first. */
  counselor_names: string[];
  can_edit: boolean;
  granted_at: string;
  student_id: string;
}

export type OrgAskKind = "record_section" | "list" | "custom";

/** public.org_requests: "Ms. Rivera asked you to add your SAT score." */
export interface OrgAsk {
  id: string;
  org_id: string;
  student_id: string;
  kind: OrgAskKind;
  /** A record section key (record_section asks only). */
  section: string | null;
  /** The custom line (required for custom asks), at most ORG_ASK_NOTE_MAX characters. */
  note: string | null;
  created_by: string | null;
  created: string;
  done_at: string | null;
  seen_at: string | null;
}

/** org_open_asks(): an open ask with who asked, for the notice at the top of Next steps. */
export interface OpenOrgAsk {
  id: string;
  org_id: string;
  org_name: string;
  kind: OrgAskKind;
  section: string | null;
  note: string | null;
  created: string;
  asked_by_name: string | null;
  seen_at: string | null;
}

/** public.org_notes: the office's notes on a student, never the family's. */
export interface OrgNote {
  id: string;
  org_id: string;
  student_id: string;
  author_id: string | null;
  /** From the organization's members (lib/orgs.ts fills it); null when the author has left or has no name. */
  author_name: string | null;
  body: string;
  created: string;
  updated: string;
}

/** The limits the SQL holds (a test reads them from the migration). */
export const ORG_NAME_MAX = 120;
export const ORG_INVITATION_DAYS = 30;
export const ORG_ASK_NOTE_MAX = 200;
export const ORG_ASKS_PER_WEEK = 3;
export const ORG_NOTE_MAX = 4000;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Sentences for the codes the organization functions raise (`raise exception '<code>'`). */
export const ORG_ERRORS: Record<string, string> = {
  already_in_organization: "You're already in a counselor organization. Leave it from its members page first.",
  not_a_member: "You're not a member of this organization.",
  owners_only: "Only the organization's owners can do that.",
  last_owner: "Name another owner first: an organization always has one.",
  no_such_code: "That code doesn't match an organization. Check it with your counselor.",
  invitation_used: "This invitation has already been used.",
  invitation_expired: "This invitation has expired. Invitations last 30 days; ask your counselor for a new one.",
  invitation_revoked: "This invitation was cancelled.",
  invitation_not_found: "This invitation link isn't valid. Ask your counselor for a new one.",
  invitation_wrong_email: "This invitation was sent to a different email address. Sign in with that address to accept it.",
  not_a_student: "This is for students and their parents. Sign in with a student's account, or a parent's who can see the student.",
  already_on_caseload: "That student is already on your caseload.",
  already_a_member: "That person is already a member of your organization.",
  ask_limit: "You've asked three times this week. Asks open up again in a few days.",
  ask_open: "You already asked for this, and it isn't done yet.",
  grant_ended: "This student's access has ended.",
  grant_not_found: "That access isn't there anymore.",
  request_not_found: "That ask isn't there anymore.",
  invalid_ask: "An ask needs a section, or a short note of at most 200 characters.",
  invalid_name: "Give the organization a name of at most 120 characters.",
  invalid_kind: "Choose whether you're an independent consultant or work at a school.",
  invalid_email: "Enter a valid email address.",
  invalid_grad_year: "Enter a graduation year like 2027.",
  invalid_website: "Enter a website of at most 200 characters.",
  invalid_school: "Choose the high school from the list.",
  invalid_role: "Choose owner or counselor.",
  invalid_side: "Invite a student or a counselor.",
  counselor_cannot_change: "Only the student or their family can do that.",
  account_deleted: "This account is being deleted.",
  not_signed_in: "Sign in first.",
};

const ORG_ERROR_CODES = Object.keys(ORG_ERRORS).sort((a, b) => b.length - a.length);

/**
 * The sentence for a refusal: `codeOrMessage` is the code itself or an error message containing it (Supabase returns
 * the raised text as the message). A message with no known code gets a plain fallback, never the raw database text.
 */
export function orgErrorMessage(codeOrMessage: string | null | undefined): string {
  const text = codeOrMessage ?? "";
  if (ORG_ERRORS[text]) return ORG_ERRORS[text];
  const code = ORG_ERROR_CODES.find((c) => new RegExp(`\\b${c}\\b`).test(text));
  return code ? ORG_ERRORS[code] : "Something went wrong. Try again in a moment.";
}

/* ------------------------------------------------------------------ */
/* Join codes and links                                                */
/* ------------------------------------------------------------------ */

/** A stored join code: 4 to 6 capital letters (the database makes six, consonant then vowel). */
export const JOIN_CODE_RE = /^[A-Z]{4,6}$/;

/** An invitation token in a /join link: 64 lowercase hex characters (a code is letters only). */
export const INVITATION_TOKEN_RE = /^[0-9a-f]{64}$/;

/** "QUAD-RIVERA": how a code is shown and printed. */
export function formatJoinCode(code: string): string {
  return `QUAD-${code}`;
}

/**
 * What a person typed, as a stored code, or null when it can't be one: case, spaces, and the "QUAD-" prefix don't
 * matter ("quad-rivera", "QUAD RIVERA", " Rivera "). public.org_normalize_code() reads it the same way.
 */
export function parseJoinCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase().replace(/^QUAD[-\s]+/, "").replace(/[^A-Z]/g, "");
  return JOIN_CODE_RE.test(code) ? code : null;
}

/** Whether a /join/[code] segment is an invitation token rather than a code. */
export function isInvitationToken(segment: string): boolean {
  return INVITATION_TOKEN_RE.test(segment);
}

/** The link a counselor shares: `/join/<code>` (or `/join/<token>` for an invitation). */
export function joinHref(codeOrToken: string): string {
  return `/join/${encodeURIComponent(codeOrToken)}`;
}

/** The counselor's page for one student. */
export function orgStudentHref(studentId: string): string {
  return `/org/students/${encodeURIComponent(studentId)}`;
}
