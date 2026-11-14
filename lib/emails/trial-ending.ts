/**
 * "Your trial ends in three days" (specs/product/advisor.md "2. The trial"): the one email before a student's trial
 * ends. With a card on file (a subscription will charge), what the trial covered, the date and the amount, one button
 * to keep it (nothing to do), one link to cancel. Without one, the same facts and one button to add a card so the
 * advisor carries on. No second reminder; the texts never carry billing. Pure string templates, HTML plus a plain-text
 * alternative, like lib/emails/your-week.ts, so the webhook, the reconcile, and tests/billing.test.mts call it directly.
 */
import { SITE_NAME } from "../brand.ts";
import { ADVISOR_NAME } from "../planner/advisor.ts";
import { BILLING_EMAIL } from "../contacts.ts";
import { priceLabel, shortDay } from "../billing.ts";

export interface TrialEndingInput {
  firstName: string | null;
  /** A live subscription will charge at the end; false for a trial with no card yet. */
  hasCard: boolean;
  priceVariant: string | null;
  /** ISO. */
  trialEnd: string;
  /** Colleges on the student's lists, moves done since the trial began; null when unknown. */
  colleges: number | null;
  movesDone: number | null;
  /** The students the trial is for, first names; empty for the reader's own. */
  studentNames: string[];
  /** Origin, no trailing slash. */
  siteUrl: string;
  today?: Date;
}

export interface BuiltTrialEnding {
  subject: string;
  html: string;
  text: string;
  advisorHref: string;
  manageHref: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The sentence about what the trial covered, or null when nothing is known. */
export function coveredLine(input: Pick<TrialEndingInput, "colleges" | "movesDone" | "studentNames">): string | null {
  const parts: string[] = [];
  if (input.colleges !== null) parts.push(plural(input.colleges, "college on the list", "colleges on the list"));
  if (input.movesDone !== null && input.movesDone > 0) parts.push(plural(input.movesDone, "move done", "moves done"));
  if (!parts.length) return null;
  const whose = input.studentNames.length === 1 ? `${input.studentNames[0]}'s advisor` : input.studentNames.length > 1 ? "your students' advisors" : "your advisor";
  return `So far, ${whose} ${input.studentNames.length > 1 ? "have" : "has"} ${parts.join(" and ")}.`;
}

export function buildTrialEnding(input: TrialEndingInput): BuiltTrialEnding {
  const today = input.today ?? new Date();
  const when = shortDay(input.trialEnd, today);
  const price = priceLabel("student", input.priceVariant);
  const advisorHref = `${input.siteUrl}/advisor`;
  const manageHref = `${input.siteUrl}/account#advisor`;
  const startHref = `${input.siteUrl}/advisor/start`;
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const covered = coveredLine(input);
  const subject = `Your ${ADVISOR_NAME} trial ends ${when}`;
  const whose = input.studentNames.length === 1 ? `${input.studentNames[0]}'s` : input.studentNames.length > 1 ? "your students'" : "your";

  const keep = input.hasCard
    ? `To keep it, there's nothing to do: on ${when} your card is charged ${price}, and the advisor carries on.`
    : `To keep it, add a card before ${when}: ${price}, charged when the trial ends, and the advisor carries on without a gap.`;
  const stop = input.hasCard
    ? `To cancel, open your account page before ${when} and choose Cancel; nothing is charged, and the list, its levels, the calendar, and the offers stay where they are, read-only.`
    : `If you do nothing, nothing is charged: on ${when} ${whose} advisor turns read-only, and the list, its levels, the calendar, and the offers stay where they are.`;
  const button = input.hasCard ? { label: "Keep my advisor", href: advisorHref } : { label: "Add a card", href: startHref };
  const secondary = input.hasCard ? { label: "Manage or cancel", href: manageHref } : { label: "Open your advisor", href: advisorHref };

  const text = [
    greeting,
    "",
    `Your free trial of ${ADVISOR_NAME} ends ${when}.`,
    ...(covered ? [covered] : []),
    "",
    keep,
    `${button.label}: ${button.href}`,
    "",
    stop,
    `${secondary.label}: ${secondary.href}`,
    "",
    `Questions about billing: ${BILLING_EMAIL}`,
    `${SITE_NAME}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f6f5fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1830;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 28px 24px;">
<p style="margin:0 0 12px;font-size:16px;">${escapeHtml(greeting)}</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;">Your free trial of ${escapeHtml(ADVISOR_NAME)} ends ${escapeHtml(when)}.</h1>
${covered ? `<p style="margin:0 0 16px;font-size:15px;color:#4a4664;">${escapeHtml(covered)}</p>` : ""}
<p style="margin:0 0 16px;font-size:15px;">${escapeHtml(keep)}</p>
<p style="margin:0 0 20px;"><a href="${button.href}" style="display:inline-block;background:#5b3df5;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#4a4664;">${escapeHtml(stop)}</p>
<p style="margin:0 0 20px;font-size:14px;"><a href="${secondary.href}" style="color:#5b3df5;">${escapeHtml(secondary.label)}</a></p>
<p style="margin:0;font-size:12px;color:#8a86a3;">Questions about billing: <a href="mailto:${BILLING_EMAIL}" style="color:#8a86a3;">${BILLING_EMAIL}</a> · ${escapeHtml(SITE_NAME)}</p>
</div></body></html>`;

  return { subject, html, text, advisorHref, manageHref };
}
