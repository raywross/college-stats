/**
 * The counselor portal's invitation emails (specs/product/counselor-portal.md "How a student joins", "Members and
 * settings"): a student invited to a caseload, or a counselor invited into the organization. Plain HTML plus a text
 * alternative in the household invitation's style (lib/household-rules.ts invitationEmail). The link is the site's
 * own `/join/<token>` (lib/org-rules.ts joinHref), which works for 30 days; the email says what the counselor will and
 * won't see, and that the student can end it. Pure: the Server Action sends it with lib/email.ts sendEmail.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface OrgInvitationEmailInput {
  /** The counselor who sent it (their display name), or null. */
  inviter: string | null;
  orgName: string;
  side: "student" | "counselor";
  /** The absolute `/join/<token>` link. */
  link: string;
  siteName: string;
  /** "Dec 1, 2026". */
  expires: string;
  /** The invited student's first name, when the counselor typed one. */
  firstName?: string | null;
}

/** The subject, HTML, and text of one invitation. */
export function orgInvitationEmail(input: OrgInvitationEmailInput): { subject: string; html: string; text: string } {
  const who = input.inviter?.trim() || input.orgName;
  const hi = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : null;
  const subject =
    input.side === "student" ? `${who} invited you to share your ${input.siteName} account with them` : `${who} invited you to ${input.orgName} on ${input.siteName}`;
  const lines =
    input.side === "student"
      ? [
          `${who} (${input.orgName}) invited you to share your ${input.siteName} account with them. ${input.siteName} is free for you to start.`,
          "They'll see your record, your college list and advisor, and your essays, so they can help. They never see your parents' finances. You can see each time they look, and you can end it any time from your account.",
          `Open this link to join (it works until ${input.expires}):`,
        ]
      : [
          `${who} invited you to join ${input.orgName} on ${input.siteName} as a counselor. ${input.siteName} is free for counselors.`,
          "You'll see the students who share their accounts with the organization.",
          `Open this link and sign in with this email address to join (it works until ${input.expires}):`,
        ];
  const button = input.side === "student" ? "Join" : "Join the organization";
  const body = hi ? [hi, ...lines] : lines;
  const text = `${body.join("\n\n")}\n${input.link}\n\nIf you weren't expecting this, ignore this email.`;
  // What they'll see reads quieter than the invitation itself, as the household email does.
  const paragraphs = body.map((l) => `<p style="margin:0 0 16px${l === lines[1] ? ";color:#57516b" : ""}">${escapeHtml(l)}</p>`).join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f4;color:#1c1830;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d8;border-radius:16px;padding:24px">
${paragraphs}
<p style="margin:0 0 24px"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#5b3df5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:999px">${button}</a></p>
<p style="margin:0;color:#57516b;font-size:13px">This link works until ${escapeHtml(input.expires)}. If you weren't expecting it, ignore this email.</p>
</div></body></html>`;
  return { subject, html, text };
}
