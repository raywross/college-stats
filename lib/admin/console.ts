/**
 * The admin console's pure parts (specs/product/admin.md "The console", "People"): the sections of the rail, reading
 * the forms the Server Actions receive, the plain words for every refusal, status chips, the search's routing, the
 * log's labels, and the one line /household shows after Quad support links someone. No server or browser APIs and no
 * `server-only`, so the pages, the client components, and the tests share it. Server Actions re-check everything here:
 * a form is never trusted because the browser's button was disabled.
 */
import { ADMIN_ERRORS, SUPPORT_VIEWER_NAME } from "./constants.ts";
import { DELETE_CONFIRMATION, EMAIL_RE, HOUSEHOLD_ERRORS, errorMessage, normalizePhone } from "../household-rules.ts";
import { isUuid } from "../household-hub.ts";
import { isRoleHint } from "../accounts.ts";
import type { AdminAuthResult } from "./auth-function.ts";
import type { AdminState } from "./auth.ts";

/* ------------------------------------------------------------------ */
/* The rail                                                            */
/* ------------------------------------------------------------------ */

export type AdminSectionKey = "people" | "households" | "organizations" | "colleges" | "health" | "operations" | "jobs" | "essays" | "log";

export interface AdminSection {
  key: AdminSectionKey;
  label: string;
  href: string;
  /** Route prefixes that belong to this section (the rail highlights it under any of them). */
  under: string[];
  /** One line under the label in the rail. */
  hint: string;
}

/**
 * The sections of the spec's console table, with People and Households apart (owner, 2026-10-13). Colleges, Health,
 * and Operations link to pages other units build; the rail doesn't need them to exist.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: "people", label: "People", href: "/admin/people", under: ["/admin/people", "/admin/students"], hint: "Accounts and students" },
  { key: "households", label: "Households", href: "/admin/households", under: ["/admin/households"], hint: "Families and invitations" },
  // Organizations (specs/product/counselor-portal.md "The channel"): counselors and schools running a caseload.
  { key: "organizations", label: "Organizations", href: "/admin/organizations", under: ["/admin/organizations"], hint: "Counselors and their caseloads" },
  { key: "colleges", label: "Colleges", href: "/admin/colleges", under: ["/admin/colleges", "/admin/high-schools", "/admin/selectivity"], hint: "Hidden values, selectivity" },
  { key: "health", label: "Health", href: "/admin/health", under: ["/admin/health"], hint: "Which data is fresh" },
  { key: "operations", label: "Operations", href: "/admin/operations", under: ["/admin/operations"], hint: "Runs and approvals" },
  // Essays (specs/product/essays/sources.md "The hand read"): the prompts a person reads from the application form.
  { key: "essays", label: "Essays", href: "/admin/essays", under: ["/admin/essays"], hint: "Prompts read from the form" },
  // Jobs (specs/product/admin-jobs.md): every scheduled job, its next run, and its history.
  { key: "jobs", label: "Jobs", href: "/admin/jobs", under: ["/admin/jobs"], hint: "Schedules and past runs" },
  { key: "log", label: "Log", href: "/admin/log", under: ["/admin/log", "/admin/admins"], hint: "Every admin action" },
];

/** The section a path belongs to, or null for the landing page and the MFA page. */
export function activeSection(pathname: string): AdminSectionKey | null {
  return ADMIN_SECTIONS.find((s) => s.under.some((p) => pathname === p || pathname.startsWith(`${p}/`)))?.key ?? null;
}

export type ConsoleShell = { shell: "not-found" } | { shell: "setup" } | { shell: "mfa"; enrolled: boolean } | { shell: "console" };

/**
 * What app/admin/layout.tsx renders for a standing (lib/admin/auth.ts adminState()): a 404 for anyone who isn't an
 * admin (the console's existence isn't advertised), a setup notice before the migration, the second-factor step for an
 * admin at aal1, the console for an admin at aal2. Pure, so the table is tested; the layout switches on it.
 */
export function shellFor(state: AdminState): ConsoleShell {
  switch (state.kind) {
    case "admin":
      return { shell: "console" };
    case "needs-mfa":
      return { shell: "mfa", enrolled: state.enrolled };
    case "setup-missing":
      return { shell: "setup" };
    default:
      return { shell: "not-found" };
  }
}

/** Where the global search sends a query (people, students, households, invitations; colleges have their own page). */
export function searchHref(q: string): string {
  const trimmed = q.trim();
  return trimmed ? `/admin/people?q=${encodeURIComponent(trimmed)}` : "/admin/people";
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const ZONE = "America/New_York";

/**
 * "Oct 12, 2026". A moment is shown in the site's zone; a bare date ("2027-01-01": a deadline, a visit) has no time of
 * day, so it is shown as written, not shifted a day by the zone.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: dateOnly ? "UTC" : ZONE }).format(new Date(iso));
}

/** "Oct 12, 2026, 3:04 PM". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: ZONE }).format(new Date(iso));
}

/** Whole days from `now` until `iso` (never negative). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

/** "Deleting in 12 days" for a deleted account's purge date. */
export function deletingLabel(purgeAt: string, now: Date = new Date()): string {
  const days = daysUntil(purgeAt, now);
  return days === 0 ? "Deleting today" : `Deleting in ${days} ${days === 1 ? "day" : "days"}`;
}

/* ------------------------------------------------------------------ */
/* Refusals in plain words                                             */
/* ------------------------------------------------------------------ */

export const ADMIN_FAILED = "That didn't work. Try again in a moment.";

/** The plain-words message for a database refusal (the admin_*() functions raise the keys of ADMIN_ERRORS). */
export function adminErrorMessage(error: { message?: string } | null | undefined, fallback: string = ADMIN_FAILED): string {
  return errorMessage(error, { ...HOUSEHOLD_ERRORS, ...ADMIN_ERRORS }, fallback);
}

type AuthFailure = Extract<AdminAuthResult, { ok: false }>;

export const ADMIN_AUTH_ERRORS: Record<AuthFailure["reason"], string> = {
  bad_request: "That request wasn't valid. Reload the page and try again.",
  unauthorized: "Your session ended. Sign in again, then retry.",
  not_admin: ADMIN_ERRORS["admin only"],
  user_not_found: ADMIN_ERRORS.user_not_found,
  email_taken: "Another account already uses that email address.",
  not_deleted: "Delete now only works on an account that is already scheduled for deletion. Delete the account first.",
  not_configured: "The admin-auth function isn't set up for this copy of the site, so this action isn't available here.",
  error: ADMIN_FAILED,
};

/** The plain-words message for a failed admin-auth call (lib/admin/auth-function.ts). */
export function authFailureMessage(result: AuthFailure): string {
  if (result.reason === "not_configured" && result.detail === "email_not_configured") return "Email sending isn't set up yet. Use Copy reset link.";
  return ADMIN_AUTH_ERRORS[result.reason] ?? ADMIN_FAILED;
}

/* ------------------------------------------------------------------ */
/* Typed confirmations                                                 */
/* ------------------------------------------------------------------ */

/** Whether `typed` is the confirmation word or address (case and surrounding spaces don't matter). */
export function typedMatches(typed: unknown, expected: string): boolean {
  if (typeof typed !== "string" || expected.trim() === "") return false;
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}

/** The word typed to delete an account (the same one the person types for their own: "delete"). */
export const CONFIRM_DELETE = DELETE_CONFIRMATION;

/** The word typed to remove someone from a household (admin_unlink). */
export const CONFIRM_REMOVE = "remove";

/** The word typed to delete a student record. */
export const CONFIRM_DELETE_RECORD = "delete";

/** The word typed to revert a change set or a reference document to an older version (client-safe: no server imports here). */
export const CONFIRM_REVERT = "revert";

/* ------------------------------------------------------------------ */
/* Reading forms                                                       */
/* ------------------------------------------------------------------ */

type FormLike = { get(name: string): FormDataEntryValue | string | null };
type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const text = (form: FormLike, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** A uuid field, or null when it's missing or not one. */
export function formId(form: FormLike, name: string): string | null {
  const v = text(form, name);
  return isUuid(v) ? v : null;
}

const MAX_NAME = 80;

/** Edit details (admin_update_profile): every key is sent, except a blank birth year, which can't be cleared. */
export function parseProfileEdit(form: FormLike, today: Date = new Date()): Parsed<Record<string, string | number | null>> {
  const name = text(form, "display_name");
  if (name.length > MAX_NAME) return fail(ADMIN_ERRORS.invalid_name);
  const patch: Record<string, string | number | null> = { display_name: name || null };

  const year = text(form, "birth_year");
  if (year) {
    if (!/^\d{4}$/.test(year) || Number(year) > today.getFullYear() || Number(year) < today.getFullYear() - 120) return fail("Enter the birth year as four digits, like 2008.");
    patch.birth_year = Number(year);
  }

  const role = text(form, "role_hint");
  if (role && !isRoleHint(role)) return fail(ADMIN_ERRORS.invalid_patch);
  patch.role_hint = role || null;

  const phone = text(form, "phone");
  if (phone) {
    const e164 = normalizePhone(phone);
    if (!e164) return fail(HOUSEHOLD_ERRORS.invalid_phone);
    patch.phone = e164;
  } else {
    patch.phone = null;
  }
  return { ok: true, value: patch };
}

/** Edit a student record (admin_update_student): name, grad year, phone. */
export function parseStudentEdit(form: FormLike, today: Date = new Date()): Parsed<Record<string, string | number | null>> {
  const name = text(form, "display_name");
  if (name.length > MAX_NAME) return fail(ADMIN_ERRORS.invalid_name);
  const patch: Record<string, string | number | null> = { display_name: name || null };

  const grad = text(form, "grad_year");
  if (grad) {
    const y = Number(grad);
    if (!/^\d{4}$/.test(grad) || y < today.getFullYear() - 10 || y > today.getFullYear() + 12) return fail(HOUSEHOLD_ERRORS.invalid_grad_year);
    patch.grad_year = y;
  } else {
    patch.grad_year = null;
  }

  const phone = text(form, "phone");
  if (phone) {
    const e164 = normalizePhone(phone);
    if (!e164) return fail(HOUSEHOLD_ERRORS.invalid_phone);
    patch.phone = e164;
  } else {
    patch.phone = null;
  }
  return { ok: true, value: patch };
}

/** Rename a household. */
export function parseHouseholdName(form: FormLike): Parsed<{ name: string }> {
  const name = text(form, "name");
  if (!name || name.length > MAX_NAME) return fail(ADMIN_ERRORS.invalid_name);
  return { ok: true, value: { name } };
}

/** Change email: the new address typed twice, and whether to move invitations addressed to the old one. */
export function parseEmailChange(form: FormLike): Parsed<{ email: string; repointInvitations: boolean }> {
  const email = text(form, "email").toLowerCase();
  const again = text(form, "email_again").toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(HOUSEHOLD_ERRORS.invalid_email);
  if (email !== again) return fail("The two addresses don't match. Type the new address twice, the same way.");
  return { ok: true, value: { email, repointInvitations: form.get("repoint") === "on" || form.get("repoint") === "1" } };
}

/** The reason for a deactivation: free text, required. */
export function parseReason(form: FormLike): Parsed<string> {
  const reason = text(form, "reason");
  if (reason.length < 3) return fail("Say why (a few words): it goes in the log.");
  if (reason.length > 500) return fail("Keep the reason under 500 characters.");
  return { ok: true, value: reason };
}

/** A grant's optional note (admin_grant keeps 200 characters). */
export function parseGrantNote(form: FormLike): string | null {
  return text(form, "note").slice(0, 200) || null;
}

/** A six-digit authenticator code, spaces allowed ("123 456"). */
export function parseTotpCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/* ------------------------------------------------------------------ */
/* Search results                                                      */
/* ------------------------------------------------------------------ */

export interface ResultRow {
  kind: "user" | "student" | "household" | "invitation";
  id: string;
  household_id: string | null;
}

/** The page a search hit opens. An invitation opens the household it was sent from. */
export function resultHref(row: ResultRow): string | null {
  switch (row.kind) {
    case "user":
      return `/admin/people/${row.id}`;
    case "student":
      return `/admin/students/${row.id}`;
    case "household":
      return `/admin/households/${row.id}`;
    case "invitation":
      return row.household_id ? `/admin/households/${row.household_id}` : null;
  }
}

/** One hit goes straight to its page; none or several show the list. */
export function singleHitHref(rows: ResultRow[]): string | null {
  return rows.length === 1 ? resultHref(rows[0]) : null;
}

export type ChipTone = "neutral" | "warn" | "danger" | "good" | "info";

/** Status chips on a result row: Paused, Deleting, Invited, No account yet. */
export function statusChips(status: string): { label: string; tone: ChipTone }[] {
  switch (status) {
    case "paused":
      return [{ label: "Paused", tone: "warn" }];
    case "deleting":
      return [{ label: "Deleting", tone: "danger" }];
    case "invited":
      return [{ label: "Invited", tone: "info" }];
    case "managed":
      return [{ label: "No account yet", tone: "neutral" }];
    default:
      return [];
  }
}

/**
 * The sentence on the button that adds someone already in another household: it names that household, because the
 * add is a move (a person is in one household at a time; their lists and numbers stay with them). Null when they
 * aren't in another household.
 */
export function moveWarning(name: string | null, fromName: string | null, fromId: string | null, toId: string): string | null {
  if (!fromId || fromId === toId) return null;
  return `${name ?? "They"} ${name ? "is" : "are"} in the household ${fromName ? `“${fromName}”` : "of another family"}. Adding them here moves them out of it; their lists and numbers stay with them.`;
}

export const KIND_LABELS: Record<ResultRow["kind"], string> = { user: "Person", student: "Student record", household: "Household", invitation: "Invitation" };

/* ------------------------------------------------------------------ */
/* The log                                                             */
/* ------------------------------------------------------------------ */

/** Every action the log records, with plain words. Operations adds `ops.*` and `review.*` rows of its own. */
export const LOG_ACTIONS: Record<string, string> = {
  "profile.update": "Edited a person's details",
  "student.update": "Edited a student record",
  "household.update": "Renamed a household",
  "household.link": "Added someone to a household",
  "household.unlink": "Removed someone from a household",
  "invitation.revoke": "Cancelled an invitation",
  "student.claim": "Attached a student record to an account",
  "account.delete": "Deleted an account",
  "account.restore": "Restored an account",
  "student.delete": "Deleted a student record",
  "household.close": "Closed a household",
  "account.export": "Exported a person's data",
  "access.view": "Opened a student's data",
  "admin.grant": "Made someone an admin",
  "admin.revoke": "Revoked an admin",
  "auth.email": "Changed an email address",
  "auth.recovery": "Made a password-reset link",
  "auth.sign_out": "Signed someone out everywhere",
  "account.suspend": "Deactivated an account",
  "account.unsuspend": "Reactivated an account",
  "account.purge": "Deleted an account now",
  "auth.confirm": "Confirmed an email address",
  "auth.unconfirm": "Marked an email address unconfirmed",
  "setting.set": "Changed a site setting",
};

/** A log action in words; unknown actions (from a later unit) show as written. */
export function actionLabel(action: string): string {
  return LOG_ACTIONS[action] ?? action;
}

export const TARGET_KINDS = ["user", "student", "household", "invitation", "member"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Where a log row's target lives in the console, when it has a page. */
export function targetHref(kind: string | null, id: string | null): string | null {
  if (!kind || !id || !isUuid(id)) return null;
  if (kind === "user") return `/admin/people/${id}`;
  if (kind === "student") return `/admin/students/${id}`;
  if (kind === "household") return `/admin/households/${id}`;
  return null;
}

export interface LogQuery {
  action?: string;
  adminId?: string;
  targetKind?: TargetKind;
  targetId?: string;
  before?: number;
}

type SearchParamValue = string | string[] | undefined;

const first = (v: SearchParamValue): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

/** The log's filters from the URL (anything malformed is ignored, never an error). */
export function parseLogQuery(params: Record<string, SearchParamValue>): LogQuery {
  const q: LogQuery = {};
  const action = first(params.action);
  if (/^[a-z_]+(\.[a-z_]+)?$/.test(action)) q.action = action;
  const admin = first(params.admin);
  if (isUuid(admin)) q.adminId = admin;
  const kind = first(params.kind);
  if ((TARGET_KINDS as readonly string[]).includes(kind)) q.targetKind = kind as TargetKind;
  const target = first(params.target);
  if (target && target.length <= 64) q.targetId = target;
  const before = first(params.before);
  if (/^\d{1,15}$/.test(before)) q.before = Number(before);
  return q;
}

/** A query as a URL's search string (the paging links keep the filters). */
export function logHref(q: LogQuery): string {
  const p = new URLSearchParams();
  if (q.action) p.set("action", q.action);
  if (q.adminId) p.set("admin", q.adminId);
  if (q.targetKind) p.set("kind", q.targetKind);
  if (q.targetId) p.set("target", q.targetId);
  if (q.before !== undefined) p.set("before", String(q.before));
  const s = p.toString();
  return s ? `/admin/log?${s}` : "/admin/log";
}

/* ------------------------------------------------------------------ */
/* What the household is told                                          */
/* ------------------------------------------------------------------ */

export interface NoticeRow {
  at: string;
  action: string;
  member_name: string | null;
}

/** "Oct 12": month and day in the site's zone. */
function monthDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ZONE }).format(new Date(iso));
}

/**
 * The one-line notice on /household after an admin links or unlinks someone ("Quad support added Jordan to this
 * household on Oct 12"). Always "Quad support", never the admin's name; a name that is really an email address is
 * left out ("someone"), since a household sees names, not addresses.
 */
export function householdNoticeLine(row: NoticeRow): string {
  const name = row.member_name && !row.member_name.includes("@") ? row.member_name.trim() : "";
  const who = name || "someone";
  const verb = row.action === "household.unlink" ? `removed ${who} from` : `added ${who} to`;
  return `${SUPPORT_VIEWER_NAME} ${verb} this household on ${monthDay(row.at)}`;
}

/** The notice rows worth a line: links and unlinks only, newest first. */
export function householdNoticeLines(rows: NoticeRow[]): string[] {
  return rows
    .filter((r) => r.action === "household.link" || r.action === "household.unlink")
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(householdNoticeLine);
}

/* ------------------------------------------------------------------ */
/* Access to a student's data                                          */
/* ------------------------------------------------------------------ */

/** What admin_log_access records for a student page (a fixed label: the log gets no free text from the page). */
export const STUDENT_PAGE_VIEW = "student page";

/* ------------------------------------------------------------------ */
/* What a Server Action tells the page                                 */
/* ------------------------------------------------------------------ */

/**
 * The result of a console action. `link` is set only by Copy reset link: it is held in the browser's memory for that
 * page view and shown once; it is never logged, stored, or put in a URL.
 */
export type AdminActionState = { status: "idle" } | { status: "done"; message?: string; link?: string } | { status: "error"; message: string };

export const IDLE: AdminActionState = { status: "idle" };
export const SESSION_ENDED_MESSAGE = "Your admin session ended. Reload the page and sign in again.";
export const BAD_FORM_MESSAGE = "That form was incomplete. Reload the page and try again.";

/** True for what redirect() and notFound() throw: they must reach Next.js, never be turned into an error message. */
export function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^NEXT_(REDIRECT|HTTP_ERROR_FALLBACK)/.test(digest);
}

/* ------------------------------------------------------------------ */
/* Sign-in activity                                                    */
/* ------------------------------------------------------------------ */

/** One row of admin_user_auth_activity(). */
export interface AuthActivityRow {
  at: string;
  kind: string;
  detail: string | null;
  source: "audit" | "session" | "account" | "support";
}

/** Supabase Auth's audit actions and the console's own kinds, in words. Unknown kinds show as written. */
export const AUTH_ACTIVITY_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  user_signedup: "Signed up",
  user_repeated_signup: "Tried to sign up again with this email",
  user_confirmation_requested: "Asked for a confirmation email",
  user_recovery_requested: "Asked for a password reset",
  user_reauthenticate_requested: "Asked for a verification code",
  user_updated_password: "Changed their password",
  user_modified: "Updated their account",
  user_invited: "Was invited",
  invite_accepted: "Accepted an invitation",
  user_deleted: "Account deleted",
  token_revoked: "A session ended",
  mfa_code_login: "Signed in with an authenticator code",
  factor_in_progress: "Started adding an authenticator",
  factor_unenrolled: "Removed an authenticator",
  factor_deleted: "Removed an authenticator",
  challenge_created: "Was asked for an authenticator code",
  verification_attempted: "Entered an authenticator code",
  identity_unlinked: "Removed a sign-in method",
  session_started: "Session started",
  session_active: "Last active in that session",
  account_created: "Account created",
  confirmation_sent: "Confirmation email sent",
  email_confirmed: "Email confirmed",
  recovery_sent: "Password reset link sent or made",
  email_change_sent: "Email change link sent",
  last_sign_in: "Last sign-in",
  factor_added: "Authenticator added",
};

/** "Safari on iPhone" from a user agent; null when it can't be read. Never the full string or an address. */
export function deviceLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari" : null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Another app or browser";
}

/** A row's label and detail line for the panel. */
export function describeAuthActivity(row: AuthActivityRow): { label: string; detail: string | null } {
  if (row.source === "support") return { label: `Quad support: ${(LOG_ACTIONS[row.kind] ?? row.kind).toLowerCase()}`, detail: null };
  const label = AUTH_ACTIVITY_LABELS[row.kind] ?? row.kind.replace(/_/g, " ");
  if (row.source === "session" && row.detail) {
    const [aal, ...ua] = row.detail.split(" · ");
    const device = deviceLabel(ua.join(" · "));
    return { label, detail: [device, aal === "aal2" ? "passed the authenticator code" : null].filter(Boolean).join(" · ") || null };
  }
  if (row.kind === "factor_added" && row.detail) return { label, detail: /verified/.test(row.detail) ? "In use" : "Not finished" };
  return { label, detail: null };
}
