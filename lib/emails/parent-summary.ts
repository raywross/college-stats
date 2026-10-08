/**
 * The weekly parent summary (specs/planner/parents.md "The weekly summary"): one email on Sunday evening to a
 * guardian who's turned it on, per student they can see: the summary line, Your part (at most five), the stuck
 * signals, and what the student ticked this week (titles only). One link, to the household page (it covers every
 * student in one view); no notes, no numbers, no other household member's content, no comparison between students.
 * Pure string templates, HTML plus a plain-text alternative, like lib/digest.ts and lib/emails/your-week.ts, so
 * app/api/cron/weekly/route.ts and tests/planner-parents.test.mts call it directly under plain node --test.
 */
import { SITE_NAME } from "../brand.ts";

export const YOUR_PART_MAX = 5;

export interface ParentSummaryStudent {
  studentId: string;
  /** First name; "your student" when unknown. */
  firstName: string | null;
  /** lib/planner/summary.ts summaryLine(), already computed. */
  summary: string;
  /** Open tasks assigned to this guardian or either, at most five (the caller slices; this just renders what it's given, up to YOUR_PART_MAX). */
  yourPart: { title: string; when: string | null }[];
  /** lib/planner/summary.ts stuckSignals()'s text lines. */
  stuckSignals: string[];
  /** Titles the student ticked this week, titles only. */
  tickedThisWeek: string[];
}

export interface ParentSummaryInput {
  guardianFirstName: string | null;
  /** Students with nothing to say (no Your part, no signals, nothing ticked) are left out by the caller. */
  students: ParentSummaryStudent[];
  /** Origin, no trailing slash. */
  siteUrl: string;
  unsubscribeToken: string;
}

export interface BuiltParentSummary {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  planHref: string;
  unsubscribeHref: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function utm(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_source=parent-summary`;
}

const COLORS = { text: "#1c1f26", muted: "#6b7280", border: "#e4e4e7", bg: "#ffffff", link: "#5b4bda" };

/** The email, or null when there's no student with anything to say this week. */
export function buildParentSummary(input: ParentSummaryInput): BuiltParentSummary | null {
  const students = input.students.filter((s) => s.yourPart.length > 0 || s.stuckSignals.length > 0 || s.tickedThisWeek.length > 0 || s.summary);
  if (students.length === 0) return null;
  const planHref = utm(`${input.siteUrl}/household`);
  const unsubscribeHref = utm(`${input.siteUrl}/unsubscribe/${input.unsubscribeToken}/parent-summary`);
  const hello = input.guardianFirstName ? `${input.guardianFirstName}, here` : "Here";
  const subject = students.length === 1 ? `${students[0].firstName ?? "Your student"}'s week` : `This week: ${students.length} students`;

  const block = (s: ParentSummaryStudent): string => {
    const name = s.firstName ?? "Your student";
    const yourPart = s.yourPart.slice(0, YOUR_PART_MAX);
    return `
      <div style="margin-bottom:20px;">
        <p style="margin:0 0 6px;font-weight:700;">${escapeHtml(name)}</p>
        <p style="margin:0 0 8px;color:${COLORS.muted};">${escapeHtml(s.summary)}</p>
        ${
          yourPart.length
            ? `<p style="margin:0 0 4px;font-weight:600;">Your part</p><ul style="margin:0 0 8px;padding-left:20px;">${yourPart
                .map((t) => `<li style="margin-bottom:4px;">${escapeHtml(t.title)}${t.when ? ` · ${escapeHtml(t.when)}` : ""}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${
          s.stuckSignals.length
            ? `<ul style="margin:0 0 8px;padding-left:20px;color:${COLORS.muted};">${s.stuckSignals.map((t) => `<li style="margin-bottom:4px;">${escapeHtml(t)}</li>`).join("")}</ul>`
            : ""
        }
        ${
          s.tickedThisWeek.length
            ? `<p style="margin:0;color:${COLORS.muted};">Ticked this week: ${s.tickedThisWeek.map(escapeHtml).join(", ")}</p>`
            : ""
        }
      </div>`;
  };

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${COLORS.bg};">
    <div style="font-family:Arial,Helvetica,sans-serif;color:${COLORS.text};font-size:14px;line-height:1.55;max-width:600px;margin:0 auto;padding:24px 20px;">
      <p style="margin:0 0 16px;">${escapeHtml(hello)}'s this week, for each student you can see.</p>
      ${students.map(block).join("")}
      <p style="margin:0 0 20px;"><a href="${escapeHtml(planHref)}" style="color:${COLORS.link};font-weight:700;">Open the household</a></p>
      <hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0 16px;" />
      <p style="color:${COLORS.muted};font-size:12px;margin:0;">
        You get this because the weekly summary is on for your ${escapeHtml(SITE_NAME)} account.
        <a href="${escapeHtml(unsubscribeHref)}" style="color:${COLORS.link};">Turn off the weekly summary</a>
      </p>
    </div>
  </body>
</html>`;

  const lines = [`${hello}'s this week, for each student you can see.`, ""];
  for (const s of students) {
    lines.push(s.firstName ?? "Your student", s.summary);
    for (const t of s.yourPart.slice(0, YOUR_PART_MAX)) lines.push(`- ${t.title}${t.when ? ` · ${t.when}` : ""}`);
    for (const t of s.stuckSignals) lines.push(`- ${t}`);
    if (s.tickedThisWeek.length) lines.push(`Ticked this week: ${s.tickedThisWeek.join(", ")}`);
    lines.push("");
  }
  lines.push(`Open the household: ${planHref}`, "", `Turn off the weekly summary: ${unsubscribeHref}`);

  return {
    subject,
    html,
    text: lines.join("\n"),
    headers: { "List-Unsubscribe": `<${unsubscribeHref}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    planHref,
    unsubscribeHref,
  };
}
