/**
 * The site's email addresses, set up by the owner on 2026-10-28 as aliases of the support mailbox (Google Workspace,
 * domain usequad.app; specs/supabase.md "Email addresses"). One place, so a page or an email never spells an address
 * itself. Pure and client-safe.
 */

export const EMAIL_DOMAIN = "usequad.app";

/** Account help; the sender of the sign-in emails (Supabase Auth through Resend's SMTP); replies to every email land here. */
export const SUPPORT_EMAIL = `support@${EMAIL_DOMAIN}`;
/** Everything that isn't support: counselors and consultants, partnerships, press. */
export const HELLO_EMAIL = `hello@${EMAIL_DOMAIN}`;
/** Questions about personal data: exports, deletion, what is held about a minor, the counselor data agreements. */
export const PRIVACY_EMAIL = `privacy@${EMAIL_DOMAIN}`;
/** Corrections to a college's figures, a college's mark coming down, document and data-partnership asks. */
export const DATA_EMAIL = `data@${EMAIL_DOMAIN}`;
/** The sender of the advisor's own mail (digests, visit alerts, your week, briefs); `EMAIL_FROM` on Vercel names it. */
export const ADVISOR_EMAIL = `advisor@${EMAIL_DOMAIN}`;
/** Receipts and refunds, once the trial and billing ship (specs/product/commercialization.md). */
export const BILLING_EMAIL = `billing@${EMAIL_DOMAIN}`;
/** Machine mail about the site: hosting and provider notices, and the owner alerts the Data Steward will send. */
export const OPS_EMAIL = `ops@${EMAIL_DOMAIN}`;

/** A `mailto:` link with an optional subject and body, encoded. */
export function mailto(address: string, opts: { subject?: string; body?: string } = {}): string {
  const q = new URLSearchParams();
  if (opts.subject) q.set("subject", opts.subject);
  if (opts.body) q.set("body", opts.body);
  const s = q.toString().replace(/\+/g, "%20");
  return s ? `mailto:${address}?${s}` : `mailto:${address}`;
}
