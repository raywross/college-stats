/**
 * The one-time email for an ask (specs/product/counselor-portal.md "Asking a student for something"): "Ms. Rivera
 * asked you to add a test score or target", with a link to the advisor, where the ask waits as a notice at the top
 * of Next steps. The invitation email's plain style (lib/emails/org-invitation.ts). Never a number or a grade: the
 * ask names a section or carries the counselor's own line. Sent once, by the Server Action that creates the ask, and
 * only when the student has an account.
 */
import { askSentence } from "../org-caseload.ts";
import type { OpenOrgAsk } from "../org-rules.ts";
import { escapeHtml } from "./org-invitation.ts";

export interface OrgAskEmailInput {
  ask: Pick<OpenOrgAsk, "kind" | "section" | "note" | "asked_by_name" | "org_name">;
  /** The absolute link to the student's advisor (Next steps). */
  link: string;
  siteName: string;
}

export function orgAskEmail(input: OrgAskEmailInput): { subject: string; html: string; text: string } {
  const line = askSentence(input.ask);
  const who = input.ask.asked_by_name?.trim() || input.ask.org_name;
  const subject = `${who} asked you for something in your ${input.siteName} advisor`;
  const after = "It's waiting at the top of Next steps in your advisor.";
  const text = `${line}\n\n${after}\n${input.link}\n\nYou can end ${input.ask.org_name}'s access any time from your account.`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f4;color:#1c1830;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d8;border-radius:16px;padding:24px">
<p style="margin:0 0 16px">${escapeHtml(line)}</p>
<p style="margin:0 0 16px;color:#57516b">${escapeHtml(after)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#5b3df5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:999px">Open your advisor</a></p>
<p style="margin:0;color:#57516b;font-size:13px">You can end ${escapeHtml(input.ask.org_name)}'s access any time from your account.</p>
</div></body></html>`;
  return { subject, html, text };
}
