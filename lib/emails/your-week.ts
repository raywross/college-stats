/**
 * "Your week" (specs/planner/timeline.md "Reminders"): one email on Sunday evening to a student with the plan's tasks
 * due in the next seven days and the first overdue one, one line each, and one link to the plan; nothing else. Pure
 * string templates, HTML plus a plain-text alternative, like lib/digest.ts, so app/api/cron/weekly/route.ts and
 * tests/planner-timeline.test.mts call it directly under plain node --test.
 *
 * Next steps (specs/planner/next-steps/notifications.md "Channels"): the Now list's first three moves lead, each with
 * its why's first clause, then the week; what was done in the last seven days shows once, titles only.
 *
 * A line is a title, its college, its date, and whose step it is: never a detail, a note, or a number.
 */
import { SITE_NAME } from "../brand.ts";

export interface WeekLine {
  /** "Michigan: apply (ED I)" (lib/planner/timeline.ts outsideTitle). */
  title: string;
  /** "Nov 1"; "this season" for an undated move. */
  when: string;
  /** "Parent" on a guardian's step; null on the student's own. */
  who: string | null;
  /** Next steps: a move's why, its first clause; none on a plain task. */
  why?: string | null;
}

export interface YourWeekInput {
  firstName: string | null;
  /** Due in the next seven days, soonest first. */
  week: WeekLine[];
  /** The first overdue task, if any. */
  overdue: WeekLine | null;
  /** Next steps: the Now list's first three moves, dated first, shown above the week. */
  moves?: WeekLine[];
  /** Next steps: titles done in the last seven days (each shows in one week's mail, then not). */
  done?: string[];
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

/** At most this many lines from the moves and the week together (the plan has the rest). */
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

/** The email, or null when there's no move, nothing due, and nothing overdue (nothing is sent then). */
export function buildYourWeek(input: YourWeekInput): BuiltYourWeek | null {
  const moves = (input.moves ?? []).slice(0, YOUR_WEEK_MAX);
  if (input.week.length === 0 && !input.overdue && moves.length === 0) return null;
  const week = input.week.slice(0, YOUR_WEEK_MAX - moves.length);
  const more = input.week.length - week.length;
  const done = input.done ?? [];
  const planHref = utm(`${input.siteUrl}${input.planPath}`);
  const unsubscribeHref = utm(`${input.siteUrl}/unsubscribe/${input.unsubscribeToken}/week`);
  const hello = input.firstName ? `${input.firstName}, here` : "Here";
  const count = moves.length + week.length;
  const subject = moves.length
    ? `Your week: ${count} next step${count === 1 ? "" : "s"}`
    : week.length
      ? `Your week: ${week.length} step${week.length === 1 ? "" : "s"} due`
      : "Your week: one step is overdue";
  const intro = moves.length ? `${hello}'s your week on the plan.` : `${hello}'s what's due in the next seven days.`;

  const items = week.map((l) => `<li style="margin-bottom:6px;">${escapeHtml(lineText(l))}</li>`).join("");
  const moveItems = moves
    .map((l) => `<li style="margin-bottom:6px;">${escapeHtml(lineText(l))}${l.why ? `<br /><span style="color:${COLORS.muted};">${escapeHtml(l.why)}</span>` : ""}</li>`)
    .join("");
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${COLORS.bg};">
    <div style="font-family:Arial,Helvetica,sans-serif;color:${COLORS.text};font-size:14px;line-height:1.55;max-width:600px;margin:0 auto;padding:24px 20px;">
      <p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
      ${input.overdue ? `<p style="margin:0 0 12px;color:${COLORS.warn};font-weight:700;">Overdue: ${escapeHtml(lineText(input.overdue))}</p>` : ""}
      ${moves.length ? `<p style="margin:0 0 4px;font-weight:700;">Next steps</p><ul style="margin:0 0 12px;padding-left:20px;">${moveItems}</ul>` : ""}
      ${week.length ? `${moves.length ? `<p style="margin:0 0 4px;font-weight:700;">Due this week</p>` : ""}<ul style="margin:0 0 12px;padding-left:20px;">${items}</ul>` : ""}
      ${more > 0 ? `<p style="margin:0 0 12px;">…and ${more} more on your plan.</p>` : ""}
      ${done.length ? `<p style="margin:0 0 12px;color:${COLORS.muted};">Done: ${escapeHtml(done.join(", "))}</p>` : ""}
      <p style="margin:0 0 20px;"><a href="${escapeHtml(planHref)}" style="color:${COLORS.link};font-weight:700;">Open your plan</a></p>
      <hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0 16px;" />
      <p style="color:${COLORS.muted};font-size:12px;margin:0;">
        You get this because Your week is on for your ${escapeHtml(SITE_NAME)} account.
        <a href="${escapeHtml(unsubscribeHref)}" style="color:${COLORS.link};">Turn off Your week</a>
      </p>
    </div>
  </body>
</html>`;

  const lines = [intro, ""];
  if (input.overdue) lines.push(`Overdue: ${lineText(input.overdue)}`, "");
  if (moves.length) {
    lines.push("Next steps");
    for (const l of moves) lines.push(`- ${lineText(l)}${l.why ? `. ${l.why}` : ""}`);
    lines.push("");
    if (week.length) lines.push("Due this week");
  }
  for (const l of week) lines.push(`- ${lineText(l)}`);
  if (week.length) lines.push("");
  if (more > 0) lines.push(`…and ${more} more on your plan.`, "");
  if (done.length) lines.push(`Done: ${done.join(", ")}`, "");
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
