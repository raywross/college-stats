/**
 * Accounts and households: types for the rows in supabase/migrations/20261005120000_accounts.sql and the pure
 * rules around them. No server or browser APIs here, so tests, server code, and client components can all import
 * it. Server access lives in lib/auth.ts; the full design in specs/product/accounts.md.
 */

export type RoleHint = "student" | "guardian" | "counselor";

export const ROLE_HINTS: { value: RoleHint; label: string }[] = [
  { value: "student", label: "A student" },
  { value: "guardian", label: "A parent or guardian" },
  { value: "counselor", label: "A counselor" },
];

export function isRoleHint(value: unknown): value is RoleHint {
  return value === "student" || value === "guardian" || value === "counselor";
}

/** public.profiles: one per auth user, created by the sign-up trigger. */
export interface Profile {
  id: string;
  display_name: string | null;
  birth_year: number | null;
  role_hint: RoleHint | null;
  created: string;
  updated: string;
  deleted_at: string | null;
}

/** The signed-in user (from Supabase Auth, verified with getUser()) plus their profile row. */
export interface Account {
  user: { id: string; email: string | null };
  profile: Profile;
}

/** public.students: the record every tool attaches to. */
export interface StudentRecord {
  id: string;
  /** The student's own account; null for a managed student who hasn't signed up. */
  user_id: string | null;
  display_name: string | null;
  grad_year: number | null;
  /** The guardian who created a managed record; cleared when the student claims it. */
  managed_by: string | null;
  created: string;
  deleted_at: string | null;
}

export interface Household {
  id: string;
  name: string;
  created_by: string | null;
  created: string;
  deleted_at: string | null;
}

export type MemberRole = "guardian" | "student";
/** Only "active" grants access; "invited" is reserved (pending invitations live in public.invitations). */
export type MemberStatus = "invited" | "active";

export interface HouseholdMember {
  id: string;
  household_id: string;
  /** Set for guardians. */
  user_id: string | null;
  /** Set for students. */
  student_id: string | null;
  role: MemberRole;
  status: MemberStatus;
  invited_email: string | null;
  /** Guardian rows: may edit the household's students. */
  can_edit: boolean;
  created: string;
  accepted_at: string | null;
}

/** public.invitations, without token_hash (the token itself is returned once by create_invitation()). */
export interface Invitation {
  id: string;
  household_id: string;
  email: string;
  /** The role the invitee joins as. */
  side: MemberRole;
  /** Side "student": the managed record the invitee claims. */
  student_id: string | null;
  can_edit: boolean;
  invited_by: string | null;
  created: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
}

/**
 * A student the signed-in user can see, and how: their own record, as a guardian (a household or a managed record),
 * or as a counselor through an organization's grant (specs/product/counselor-portal.md).
 */
export interface StudentAccess {
  student: StudentRecord;
  relation: "self" | "guardian" | "counselor";
  canEdit: boolean;
}

/** A live grant to an organization the signed-in user is a member of (viewer_bundle().grants). */
export interface CounselorGrant {
  org_id: string;
  student_id: string;
  can_edit: boolean;
}

/* ------------------------------------------------------------------ */
/* Age rule                                                            */
/* ------------------------------------------------------------------ */

/** Nobody under 13 may hold an account (accounts.md "Minors"; COPPA; Supabase's terms). */
export const MIN_ACCOUNT_AGE = 13;

/**
 * Whether a birth year is allowed to hold an account on `today`. With only a year, someone born in year Y is
 * certainly 13 only from January 1 of Y + 14, so the rule is conservative: a birth year exactly 13 years back is
 * refused (that person may still be 12). Years more than 120 back are refused as typos. The database enforces the
 * same rule (public.birth_year_allowed).
 */
export function birthYearAllowed(year: number, today: Date = new Date()): boolean {
  if (!Number.isInteger(year)) return false;
  const thisYear = today.getFullYear();
  return year >= thisYear - 120 && thisYear - year >= MIN_ACCOUNT_AGE + 1;
}

/** Cookie remembering an under-13 refusal for a day, so the age question can't simply be retried with another year. */
export const AGE_GATE_COOKIE = "quad_age_gate";

/** A four-digit birth year from form input, or null when it isn't one. */
export function parseBirthYear(input: unknown): number | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const s = String(input).trim();
  if (!/^\d{4}$/.test(s)) return null;
  return Number(s);
}

/* ------------------------------------------------------------------ */
/* Redirects                                                           */
/* ------------------------------------------------------------------ */

/**
 * The `?next=` target after sign-in, only ever a same-origin relative path. Anything else (an absolute URL, a
 * protocol-relative `//host`, backslashes, control characters, or a loop back into /login or /auth) falls back.
 */
/**
 * What a magic link brings back to /auth/confirm in the URL fragment (Supabase's implicit flow, used because the
 * default email template can't be changed on the free plan without custom SMTP): the session tokens, or Supabase's
 * error for a stale or reused link. Null when the fragment has neither.
 */
export type AuthFragment =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; code: string; message: string };

export function parseAuthFragment(hash: string): AuthFragment | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error_code") ?? params.get("error");
  if (error) return { ok: false, code: error, message: params.get("error_description") ?? error };
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) return { ok: true, accessToken, refreshToken };
  return null;
}

export function safeNextPath(next: unknown, fallback = "/account"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, "http://quad.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://quad.invalid") return fallback;
  if (url.pathname === "/login" || url.pathname.startsWith("/auth/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/login?next=…` for a page that needs a signed-in user. */
export function loginHref(next?: string): string {
  const path = next ? safeNextPath(next, "") : "";
  return path ? `/login?next=${encodeURIComponent(path)}` : "/login";
}

/**
 * Where a new account lands after confirming its email (specs/product/counselor-portal.md "The channel"): a counselor
 * who signed up with no page to come back to (`next` is the default, /account) goes to the portal, `/org`, to start
 * their organization; everyone else, and every explicit `next`, goes where `next` says. `fresh` is whether this is the
 * confirmation of a new account (lib/signup-events-rules.ts isFreshConfirmation); an ordinary sign-in never moves.
 */
export function firstLanding(next: string, roleHint: unknown, fresh: boolean): string {
  return fresh && roleHint === "counselor" && next === "/account" ? "/org" : next;
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/**
 * Who-can-see-what from rows the user's session already read (RLS has filtered them), mirroring
 * public.can_edit_student: the user's own record is "self" and editable; a record they manage or reach through an
 * active guardian membership is "guardian", editable when they manage it or that membership has can_edit; a record
 * reached only through a live grant to their organization (`grants`) is "counselor", editable when the grant has
 * can_edit. A student reached both ways is "guardian": the family's relation wins. Anything else readable with no
 * membership row in view stays "guardian", as before counselors existed. Soft-deleted records are dropped. Order:
 * self, then guardian, then counselor, each by name.
 */
export function resolveStudentAccess(
  userId: string,
  students: StudentRecord[],
  memberships: HouseholdMember[],
  grants: CounselorGrant[] = [],
): StudentAccess[] {
  const myGuardian = memberships.filter((m) => m.role === "guardian" && m.status === "active" && m.user_id === userId);
  const guardianHouseholds = new Set(myGuardian.map((m) => m.household_id));
  const editHouseholds = new Set(myGuardian.filter((m) => m.can_edit).map((m) => m.household_id));
  const studentRows = memberships.filter((m) => m.role === "student" && m.status === "active" && m.student_id);
  const viaHousehold = new Set(studentRows.filter((m) => guardianHouseholds.has(m.household_id)).map((m) => m.student_id as string));
  const editable = new Set(studentRows.filter((m) => editHouseholds.has(m.household_id)).map((m) => m.student_id as string));
  const granted = new Map<string, boolean>();
  for (const g of grants) granted.set(g.student_id, (granted.get(g.student_id) ?? false) || g.can_edit);
  const rank = { self: 0, guardian: 1, counselor: 2 } as const;
  return students
    .filter((s) => !s.deleted_at)
    .map((student): StudentAccess => {
      if (student.user_id === userId) return { student, relation: "self", canEdit: true };
      const family = student.managed_by === userId || viaHousehold.has(student.id);
      if (!family && granted.has(student.id)) return { student, relation: "counselor", canEdit: granted.get(student.id) === true };
      return { student, relation: "guardian", canEdit: student.managed_by === userId || editable.has(student.id) };
    })
    .sort((a, b) =>
      a.relation === b.relation ? (a.student.display_name ?? "").localeCompare(b.student.display_name ?? "") : rank[a.relation] - rank[b.relation],
    );
}

/** Whether a signed-in user with this role hint gets a student record of their own (created lazily). */
export function wantsOwnStudent(roleHint: RoleHint | null): boolean {
  return roleHint === null || roleHint === "student";
}

/* ------------------------------------------------------------------ */
/* Header state (/api/me)                                              */
/* ------------------------------------------------------------------ */

/**
 * A plain cookie set beside the session cookies and cleared with them (lib/supabase-server.ts, proxy.ts): "1" while a
 * session is stored. The one cookie page scripts read (useMe), so the header knows at hydration whether to show
 * "Sign in" or the avatar, without a request. It carries no identity and the server never trusts it; the session
 * cookies themselves stay httpOnly.
 */
export const SIGNED_IN_COOKIE = "quad_signed_in";

/** One cookie as @supabase/ssr hands them to `setAll` (the options are the `cookie` package's). */
export interface CookieToSet<O extends { maxAge?: number; httpOnly?: boolean } = { maxAge?: number; httpOnly?: boolean }> {
  name: string;
  value: string;
  options: O;
}

/**
 * The marker cookie to set beside a batch of session cookies, or null when the batch sets none: "1" with the session
 * cookie's own lifetime when a session is written, and the same cleared (empty, maxAge 0, the way @supabase/ssr
 * clears) when the session is. Never httpOnly, so scripts can read it.
 */
export function signedInCookieFor<O extends { maxAge?: number; httpOnly?: boolean }>(toSet: readonly CookieToSet<O>[]): CookieToSet<O> | null {
  const session = toSet.filter((c) => c.name.startsWith("sb-"));
  if (session.length === 0) return null;
  const writing = session.some((c) => c.value !== "" && (c.options.maxAge ?? 1) > 0);
  const options = writing ? { ...session[0].options, httpOnly: false } : { ...session[0].options, httpOnly: false, maxAge: 0 };
  return { name: SIGNED_IN_COOKIE, value: writing ? "1" : "", options };
}

/** What /api/me tells the header's AccountMenu. Nothing more than the menu shows. */
export interface MeState {
  /** Sign-in is available on this deployment. */
  configured: boolean;
  signedIn: boolean;
  /** The opaque account id (`auth.users.id`), the analytics distinct id when signed in (specs/product/telemetry.md);
   * null when signed out. */
  id: string | null;
  name: string | null;
  email: string | null;
  /** A member of a counselor organization (my_organization()): the menu shows Caseload. False when signed out. */
  org: boolean;
}

/**
 * The header avatar's one letter (specs/product/household-hub.md "Names, not logins"): the first letter of the first
 * name, else of the email, else "?". The roster uses memberInitial() (lib/household-rules.ts), which never shows "?".
 */
export function initialsFor(name: string | null, email: string | null): string {
  const first = Array.from((name ?? "").trim().split(/\s+/)[0] ?? "")[0];
  if (first) return first.toLocaleUpperCase("en-US");
  const local = Array.from((email ?? "").split("@")[0])[0];
  return local ? local.toLocaleUpperCase("en-US") : "?";
}

/** Messages for accept_invitation()'s refusals (the SQL raises these names). */
export const INVITATION_ERRORS: Record<string, string> = {
  invitation_not_found: "This invitation link isn't valid. Ask for a new one.",
  invitation_expired: "This invitation has expired. Invitations last 7 days; ask for a new one.",
  invitation_revoked: "This invitation was cancelled.",
  invitation_used: "This invitation has already been used.",
  invitation_wrong_email: "This invitation was sent to a different email address. Sign in with that address to accept it.",
  invitation_own: "You can't accept your own invitation.",
  not_signed_in: "Sign in to accept this invitation.",
  already_in_household: "You're already in a household with other people. Leave it from your account page first, then open this link again.",
  household_full: "This household is full (six people, counting invitations waiting for an answer). Ask whoever invited you to make room.",
};
