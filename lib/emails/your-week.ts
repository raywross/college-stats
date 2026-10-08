/**
 * "Your week" (specs/planner/timeline.md "Reminders"): one email on Sunday evening to a student with the plan's tasks
 * due in the next seven days and the first overdue one, one line each, and one link to the plan; nothing else. Pure
 * string templates, HTML plus a plain-text alternative, like lib/digest.ts, so app/api/cron/weekly/route.ts and
 * tests/planner-timeline.test.mts call it directly under plain node --test.
 *
 * A line is a title, its college, its date, and whose step it is: never a detail, a note, or a number.
 */
import { SITE_NAME } from "../brand.ts";

export interface WeekLine {
  /** "Michigan: apply (ED I)" (lib/planner/timeline.ts outsideTitle). */
  title: string;
  /** "Nov 1". */
  when: string;
  /** "Parent" on a guardian's step; null on the student's own. */
  who: string | null;
}

export interface YourWeekInput {
  firstName: string | null;
  /** Due in the next seven days, soonest first. */
  week: WeekLine[];
  /** The first overdue task, if any. */
  overdue: WeekLine | null;
  /** Origin, no trailing slash. */
  siteUrl: string;
  /** The person's plan page path ("/household/{id}/plan"). */
  planPath: string;
  unsubscribeToken: string;
}

export interface BuiltYourWeek {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  planHref: string;
  unsubscribeHref: string;
}

/** At most this many lines from the week (the plan has the rest). */
export const YOUR_WEEK_MAX = 8;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function utm(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_source=your-week`;
}

const COLORS = { text: "#1c1f26", muted: "#6b7280", border: "#e4e4e7", bg: "#ffffff", warn: "#b42318", link: "#5b4bda" };

function lineText(l: WeekLine): string {
  return `${l.title}: ${l.when}${l.who ? ` (${l.who})` : ""}`;
}

/** The email, or null when there's nothing due and nothing overdue (nothing is sent then). */
export function buildYourWeek(input: YourWeekInput): BuiltYourWeek | null {
  if (input.week.length === 0 && !input.overdue) return null;
  const week = input.week.slice(0, YOUR_WEEK_MAX);
  const more = input.week.length - week.length;
  const planHref = utm(`${input.siteUrl}${input.planPath}`);
  const unsubscribeHref = utm(`${input.siteUrl}/unsubscribe/${input.unsubscribeToken}/week`);
  const hello = input.firstName ? `${input.firstName}, here` : "Here";
  const subject = week.length ? `Your week: ${week.length} step${week.length === 1 ? "" : "s"} due` : "Your week: one step is overdue";

  const items = week.map((l) => `<li style="margin-bottom:6px;">${escapeHtml(lineText(l))}</li>`).join("");
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${COLORS.bg};">
    <div style="font-family:Arial,Helvetica,sans-serif;color:${COLORS.text};font-size:14px;line-height:1.55;max-width:600px;margin:0 auto;padding:24px 20px;">
      <p style="margin:0 0 12px;">${escapeHtml(hello)}&apos;s what&apos;s due in the next seven days.</p>
      ${input.overdue ? `<p style="margin:0 0 12px;color:${COLORS.warn};font-weight:700;">Overdue: ${escapeHtml(lineText(input.overdue))}</p>` : ""}
      ${week.length ? `<ul style="margin:0 0 12px;padding-left:20px;">${items}</ul>` : ""}
      ${more > 0 ? `<p style="margin:0 0 12px;">…and ${more} more on your plan.</p>` : ""}
      <p style="margin:0 0 20px;"><a href="${escapeHtml(planHref)}" style="color:${COLORS.link};font-weight:700;">Open your plan</a></p>
      <hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0 16px;" />
      <p style="color:${COLORS.muted};font-size:12px;margin:0;">
        You get this because Your week is on for your ${escapeHtml(SITE_NAME)} account.
        <a href="${escapeHtml(unsubscribeHref)}" style="color:${COLORS.link};">Turn off Your week</a>
      </p>
    </div>
  </body>
</html>`;

  const lines = [`${hello}'s what's due in the next seven days.`, ""];
  if (input.overdue) lines.push(`Overdue: ${lineText(input.overdue)}`, "");
  for (const l of week) lines.push(`- ${lineText(l)}`);
  if (week.length) lines.push("");
  if (more > 0) lines.push(`…and ${more} more on your plan.`, "");
  lines.push(`Open your plan: ${planHref}`, "", `Turn off Your week: ${unsubscribeHref}`);

  return {
    subject,
    html,
    text: lines.join("\n"),
    headers: { "List-Unsubscribe": `<${unsubscribeHref}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    planHref,
    unsubscribeHref,
  };
}
