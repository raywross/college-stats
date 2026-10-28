/**
 * The morning confirmation email (specs/planner/v3/guides/show-interest.md "The confirmation email"): one per person
 * per day, about the acts they opened yesterday or earlier and haven't answered. The newest leads ("Yesterday you
 * opened Duke's tour sign-up for Nov 3. Did you register?") with two one-click links (Yes · No, by the act's token);
 * each other pending act gets a line with its own two links. The Your week footer and unsubscribe (it is part of the
 * plan's reminders), in the digest's style. Pure string templates, HTML plus a plain-text alternative, like
 * lib/emails/your-week.ts, so the job and tests/interest-confirm-email.test.mts call it directly.
 *
 * Never a personal number: no score, target, estimate, or level. The only numbers are dates and times; a college's
 * own event title passes through (escaped); a test registration is named "SAT" or "ACT" and nothing else, whatever
 * its stored title says.
 */
import { ADVISOR_PATH } from "../planner/advisor.ts";
import { SITE_NAME } from "../brand.ts";
import { actLabel, coalesceByKey, confirmUrl, shortDate, testOf, whenLabel, type InterestActRow } from "../planner/interest-acts.ts";
import { SOCIAL_LABELS } from "../social.ts";

export type ConfirmAct = Pick<InterestActRow, "id" | "item_id" | "act" | "network" | "event_id" | "event_starts_at" | "event_title" | "clicked_at" | "confirm_token">;

export interface InterestConfirmInput {
  /** The person's pending acts, newest first (the first leads). */
  acts: readonly ConfirmAct[];
  /** College name by list item id. */
  names: Record<string, string>;
  /** Each event's own zone by event id, for the clock time (no zone: the date alone). */
  zones?: Record<string, string>;
  /** Origin, no trailing slash. */
  siteUrl: string;
  /** The Your week unsubscribe link (`/unsubscribe/{token}/week`). */
  unsubscribeUrl: string;
  /** For "Yesterday" versus "On Oct 12". */
  now?: Date;
}

export interface BuiltInterestConfirm {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

const COLORS = { text: "#1c1f26", muted: "#6b7280", border: "#e4e4e7", bg: "#ffffff", link: "#5b4bda", button: "#1c1f26", buttonText: "#ffffff" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

function collegeOf(act: ConfirmAct, names: Record<string, string>): string {
  return (act.item_id ? names[act.item_id] : null) ?? "the college";
}

/** The act's name in the email: a test registration is the test's name only (never its stored title). */
function safeTitle(act: ConfirmAct): string | null {
  if (act.act === "test_register") return testOf(act);
  return act.event_title;
}

/** "Yesterday" or "On Oct 12" for when the act was opened. */
function openedWhen(act: ConfirmAct, now: Date): string {
  const clicked = act.clicked_at.slice(0, 10);
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);
  return clicked === yesterday ? "Yesterday" : `On ${shortDate(clicked)}`;
}

/** The lead's sentence and question. */
function leadLines(act: ConfirmAct, names: Record<string, string>, zone: string | null, now: Date): { opened: string; question: string } {
  const college = collegeOf(act, names);
  const when = whenLabel(act, zone);
  const opened = openedWhen(act, now);
  switch (act.act) {
    case "follow":
      return { opened: `${opened} you opened ${possessive(college)} ${act.network ? SOCIAL_LABELS[act.network] : "social"} page.`, question: "Are you following it?" };
    case "info_request":
      return { opened: `${opened} you opened ${possessive(college)} information request.`, question: "Did you send it?" };
    case "mailing_list":
      return { opened: `${opened} you opened ${possessive(college)} mailing list sign-up.`, question: "Did you join?" };
    case "test_register":
      return { opened: `${opened} you opened the ${safeTitle(act) ?? "test"} registration${when ? ` for ${when}` : ""}.`, question: "Did you register?" };
    default:
      return { opened: `${opened} you opened ${possessive(college)} ${actLabel(act.act, safeTitle(act))} sign-up${when ? ` for ${when}` : ""}.`, question: "Did you register?" };
  }
}

/** One other pending act's line: "Duke's open house, Nov 8". */
function otherLine(act: ConfirmAct, names: Record<string, string>, zone: string | null): string {
  const college = collegeOf(act, names);
  const when = whenLabel(act, zone);
  switch (act.act) {
    case "follow":
      return `Following ${college}${act.network ? ` on ${SOCIAL_LABELS[act.network]}` : ""}`;
    case "info_request":
      return `${possessive(college)} information request`;
    case "mailing_list":
      return `${possessive(college)} mailing list`;
    case "test_register":
      return `The ${safeTitle(act) ?? "test"} registration${when ? `, ${when}` : ""}`;
    default:
      return `${possessive(college)} ${actLabel(act.act, safeTitle(act))}${when ? `, ${when}` : ""}`;
  }
}

function subjectFor(act: ConfirmAct, names: Record<string, string>): string {
  const college = collegeOf(act, names);
  switch (act.act) {
    case "follow":
      return `Are you following ${college}${act.network ? ` on ${SOCIAL_LABELS[act.network]}` : ""}?`;
    case "info_request":
      return `Did you request information from ${college}?`;
    case "mailing_list":
      return `Did you join ${possessive(college)} mailing list?`;
    case "test_register":
      return `Did you register for the ${safeTitle(act) ?? "test"}?`;
    default:
      return `Did you register for ${possessive(college)} ${actLabel(act.act, safeTitle(act))}?`;
  }
}

/** The email, or null when there's nothing pending to ask about. */
export function buildInterestConfirm(input: InterestConfirmInput): BuiltInterestConfirm | null {
  // A duplicate pending row for the same act (QA finding 3) never earns two lines in the same email.
  const [lead, ...others] = coalesceByKey(input.acts);
  if (!lead) return null;
  const now = input.now ?? new Date();
  const zones = input.zones ?? {};
  const zoneOf = (a: ConfirmAct) => (a.event_id ? (zones[a.event_id] ?? null) : null);
  const site = input.siteUrl.replace(/\/$/, "");
  const planHref = `${site}${ADVISOR_PATH}?utm_source=interest-confirm`;
  const unsubscribeHref = input.unsubscribeUrl;

  const { opened, question } = leadLines(lead, input.names, zoneOf(lead), now);
  const yes = confirmUrl(site, lead.confirm_token, "yes");
  const no = confirmUrl(site, lead.confirm_token, "no");
  const lines = others.map((a) => ({ text: otherLine(a, input.names, zoneOf(a)), yes: confirmUrl(site, a.confirm_token, "yes"), no: confirmUrl(site, a.confirm_token, "no") }));

  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 22px;border-radius:999px;font-weight:700;text-decoration:none;${
      primary ? `background:${COLORS.button};color:${COLORS.buttonText};` : `border:1px solid ${COLORS.border};color:${COLORS.text};`
    }">${label}</a>`;
  const otherItems = lines
    .map(
      (l) =>
        `<li style="margin-bottom:6px;">${escapeHtml(l.text)}: <a href="${escapeHtml(l.yes)}" style="color:${COLORS.link};font-weight:700;">Yes</a> · <a href="${escapeHtml(l.no)}" style="color:${COLORS.link};font-weight:700;">No</a></li>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${COLORS.bg};">
    <div style="font-family:Arial,Helvetica,sans-serif;color:${COLORS.text};font-size:14px;line-height:1.55;max-width:600px;margin:0 auto;padding:24px 20px;">
      <p style="margin:0 0 4px;">${escapeHtml(opened)}</p>
      <p style="margin:0 0 14px;font-weight:700;">${escapeHtml(question)}</p>
      <p style="margin:0 0 18px;">${button(yes, "Yes", true)}&nbsp;&nbsp;${button(no, "No", false)}</p>
      ${lines.length ? `<p style="margin:0 0 4px;font-weight:700;">Also waiting for an answer</p><ul style="margin:0 0 14px;padding-left:20px;">${otherItems}</ul>` : ""}
      <p style="margin:0 0 20px;color:${COLORS.muted};">Yes puts it on your list; a visit goes on the family calendar. No leaves your list as it is.</p>
      <p style="margin:0 0 20px;"><a href="${escapeHtml(planHref)}" style="color:${COLORS.link};font-weight:700;">Open your advisor</a></p>
      <hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0 16px;" />
      <p style="color:${COLORS.muted};font-size:12px;margin:0;">
        You get this because Your week, your advisor's reminders, is on for your ${escapeHtml(SITE_NAME)} account.
        <a href="${escapeHtml(unsubscribeHref)}" style="color:${COLORS.link};">Turn off Your week</a>
      </p>
    </div>
  </body>
</html>`;

  const text = [opened, question, "", `Yes: ${yes}`, `No: ${no}`, ""];
  if (lines.length) {
    text.push("Also waiting for an answer");
    for (const l of lines) text.push(`- ${l.text}. Yes: ${l.yes} No: ${l.no}`);
    text.push("");
  }
  text.push("Yes puts it on your list; a visit goes on the family calendar. No leaves your list as it is.", "", `Open your advisor: ${planHref}`, "", `Turn off Your week: ${unsubscribeHref}`);

  return {
    subject: subjectFor(lead, input.names),
    html,
    text: text.join("\n"),
    headers: { "List-Unsubscribe": `<${unsubscribeHref}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
