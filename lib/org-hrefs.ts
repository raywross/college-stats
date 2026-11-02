/**
 * The counselor portal's links that pages outside the portal need (specs/product/counselor-portal.md "A student"): the
 * advisor's "Back to caseload" and the household hub's "Caseload" link. Pure, so client and server code share it. The
 * portal's own rules (organizations, join codes, errors) live in lib/org-rules.ts.
 */

/** The caseload: `/org`. */
export const CASELOAD_HREF = "/org";

/** One student on the caseload: `/org/students/<id>`. */
export function orgStudentHref(studentId: string): string {
  return `/org/students/${encodeURIComponent(studentId)}`;
}
