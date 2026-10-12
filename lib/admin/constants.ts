/**
 * The admin console's constants (specs/product/admin.md). Pure: no server-only imports, so pages, components, and
 * tests share them.
 */
import { SITE_NAME } from "../brand.ts";

/**
 * Where a paused person asks to be restored. None yet (owner decision 2026-10-12: no support address until the new
 * domain exists); set it here and the paused notice names it.
 */
export const SUPPORT_CONTACT: string | null = null;

/** Rows per page on /admin/log. */
export const ADMIN_LOG_PAGE = 100;

/**
 * How families see an admin: the viewer in "Who viewed your information" and the actor in the household's notice.
 * Never the admin's own name. my_access_log() (20261012200000_admin.sql) returns the same text; a test keeps them equal.
 */
export const SUPPORT_VIEWER_NAME = `${SITE_NAME} support`;

/** What /login?paused=1 says (and any page that finds the signed-in account paused). */
export function pausedNotice(contact: string | null = SUPPORT_CONTACT): string {
  return contact
    ? `This account is paused. Contact ${SUPPORT_VIEWER_NAME} at ${contact} to restore it.`
    : `This account is paused. Contact ${SUPPORT_VIEWER_NAME} to restore it.`;
}

/** The sign-in page a paused account is sent to. */
export const PAUSED_LOGIN_PATH = "/login?paused=1";

/**
 * The request header that turns on the "Admins read" policies (20261012200000_admin.sql admin_reads()). Only the
 * console's Supabase client (lib/admin/people.ts adminSupabase()) sends it, so an admin browsing the ordinary site
 * reads only what any family member would.
 */
export const ADMIN_CONSOLE_HEADER = "x-quad-console";

/** Plain words for the refusals the admin functions raise (the SQL raises these names). */
export const ADMIN_ERRORS: Record<string, string> = {
  "admin only": "Only an admin signed in with their second factor can do that.",
  invalid_patch: "That change isn't one the console can make.",
  invalid_name: "Give it a name (up to 80 characters).",
  invalid_link: "Pick either a student record or a person to add.",
  invalid_action: "That isn't an action the log records.",
  user_not_found: "That account doesn't exist any more.",
  student_not_found: "That student record doesn't exist or was deleted.",
  household_not_found: "That household doesn't exist or was closed.",
  member_not_found: "That person isn't in this household any more.",
  account_deleted: "That account is scheduled for deletion. Restore it first.",
  already_member: "They're already in this household.",
  household_full: "This household is full: six people, counting invitations waiting for an answer. Cancel an invitation or remove someone first.",
  already_in_household: "They're already in a household. Move them, or remove them from it first.",
  last_guardian_of_managed:
    "This is the only parent or guardian of a student without an account. Add another guardian to the household first, or delete the student's record.",
  invitation_not_found: "That invitation doesn't exist.",
  invitation_used: "That invitation was already accepted.",
  invitation_revoked: "That invitation was already cancelled.",
  student_has_account: "That student record belongs to an account. Use the account's own actions instead.",
  user_has_student: "That person already has their own student record. They can merge this one by accepting a hand-over invitation from the family.",
  revoke_admin_first: "That account is an admin. Revoke their admin access first.",
  not_deleted: "That account isn't scheduled for deletion.",
  household_not_empty: "Only an empty household can be closed. Remove everyone first.",
  already_admin: "They're already an admin.",
  not_admin: "They aren't an admin.",
  cannot_revoke_self: "You can't revoke your own admin access. Ask another admin.",
  last_admin: "This is the last admin. Grant someone else first.",
  birth_year_not_allowed: "That birth year is under the 13+ rule.",
};
