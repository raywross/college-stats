/**
 * The season brief (specs/planner/next-steps/notifications.md "The season brief"): one email when a season of high
 * school turns, to the student and, separately, to each guardian. The season in one sentence, this season's moves
 * (three to six, the Now order, each its title, the first clause of its why, and one link to its card), one line on
 * what next season brings, and the unsubscribe. A guardian's brief leads with their part (yourPartMoves), then the
 * child's top three moves as read-only lines. February of freshman and sophomore year has its own brief: the
 * course-plan move and a line on the PSAT's result.
 *
 * Pure: `briefContent` picks the lines from a plan's tasks, `buildSeasonBrief` renders HTML plus plain text (like
 * lib/emails/your-week.ts), so app/api/cron/weekly/route.ts and tests/planner-briefs.test.mts call them directly.
 * Every line goes through scrubNumbers: no score, amount, percent, or count leaves the site.
 */
import { SITE_NAME } from "../brand.ts";
import { SEASON_EXPLAINER } from "../planner/moves-catalog.ts";
import type { ImportanceFacts } from "../planner/importance.ts";
import { nowMoves, taskSeason, yourPartMoves } from "../planner/moves.ts";
import { planHref } from "../planner/plan-tabs.ts";
import { nextSeason, SEASON_LABELS, type Season } from "../planner/seasons.ts";
import { compareTasks, isOpen, taskDate } from "../planner/tasks.ts";
import { outsideTitle, scrubNumbers, type BriefKey } from "../planner/timeline.ts";
import type { PlanTask } from "../planner/types.ts";

/** At most this many moves in a brief (the Now list's cap). */
export const BRIEF_MOVES_MAX = 6;
/** The child's moves under a guardian's part. */
export const BRIEF_CHILD_MAX = 3;

export interface BriefLine {
  /** "Wake Forest: show interest" (outsideTitle). */
  title: string;
  /** The why's first clause, or null. */
  why: string | null;
  /** The card on the Next steps tab ("/plan?for=…&tab=next&move=…"), a path. */
  path: string;
}

export interface BriefContent {
  role: "student" | "guardian";
  key: BriefKey;
  season: Season;
  /** The student's first name, or null. */
  firstName: string | null;
  studentId: string;
  /** The season in one sentence. */
  lead: string;
  /** The student's moves, or the guardian's own part. */
  moves: BriefLine[];
  /** A guardian's brief: the child's top three moves, read-only titles. Empty for a student. */
  childMoves: string[];
  /** Fixed lines after the moves (February: the PSAT's result). */
  notes: string[];
  /** What next season brings, or null. */
  next: string | null;
}

const FEB_LEAD = "February is for choosing next year's courses.";
const PSAT_LINE = "If you took the PSAT in the fall, its score report is out: read it for what to practice, not as a grade.";
const FEB_NEXT: Record<"freshman_feb" | "sophomore_feb", string> = {
  freshman_feb: "Next: sophomore year, from August.",
  sophomore_feb: "Next: junior year, when your advisor gets busy.",
};

/** The brief's name for its turn: "Junior spring", "Freshman-year February". */
export function briefLabel(key: BriefKey): string {
  if (key === "freshman_feb") return "Freshman-year February";
  if (key === "sophomore_feb") return "Sophomore-year February";
  return SEASON_LABELS[key];
}

/** The first clause of a move's why: up to the first sentence end, semicolon, colon, or dash; no figures. */
export function firstClause(why: string | null | undefined): string | null {
  if (!why) return null;
  const cut = why.split(/(?<=[a-z0-9)])[.;:](?:\s|$)|\s[—–]\s/i)[0] ?? why;
  const out = scrubNumbers(cut).replace(/[.,;:\s]+$/, "");
  return out ? out : null;
}

const isCourseMove = (t: PlanTask) => /choose_courses/.test(t.key ?? "");

/** Dated before undated, keeping the given order otherwise (Your week's "dated first"). */
export function datedFirst(tasks: PlanTask[]): PlanTask[] {
  return [...tasks].sort((a, b) => Number(taskDate(a) === null) - Number(taskDate(b) === null));
}

/**
 * The brief's lines from a plan's tasks. Only open moves (a skipped or done move never mails); a guardian's part is
 * the moves of theirs that belong to this season (or are overdue), the child's top three come from the guardian's
 * Now (which leaves the guardian's own moves out).
 */
export function briefContent(
  tasks: PlanTask[],
  names: Record<string, string>,
  opts: { role: "student" | "guardian"; key: BriefKey; season: Season; gradYear: number | null; today: string; studentId: string; firstName: string | null; facts: ImportanceFacts },
): BriefContent {
  const { role, key, season, gradYear, today, studentId, facts } = opts;
  const feb = key === "freshman_feb" || key === "sophomore_feb";
  const title = (t: PlanTask) => outsideTitle(t, t.item_id ? (names[t.item_id] ?? null) : null);
  const line = (t: PlanTask): BriefLine => ({ title: title(t), why: firstClause(t.detail), path: planHref({ person: studentId, tab: "next", move: t.id }) });
  const live = tasks.filter((t) => isOpen(t, today));
  const courseMoves = live.filter(isCourseMove).sort(compareTasks);

  let mine: PlanTask[];
  let child: PlanTask[];
  if (role === "student") {
    mine = feb ? courseMoves : nowMoves(live, { season, gradYear, today, viewer: "student", max: BRIEF_MOVES_MAX, facts }).now;
    child = [];
  } else {
    const part = yourPartMoves(live, today).filter((t) => {
      const d = taskDate(t);
      return taskSeason(t, gradYear, season) === season || (d !== null && d < today);
    });
    mine = part.slice(0, BRIEF_MOVES_MAX);
    child = feb ? courseMoves.filter((t) => !mine.includes(t)) : nowMoves(live, { season, gradYear, today, viewer: "guardian", facts }).now;
  }

  const next = feb
    ? FEB_NEXT[key as "freshman_feb" | "sophomore_feb"]
    : (SEASON_EXPLAINER[season].next ?? (season === "summer_after" || !nextSeason(season) ? null : `Next: ${SEASON_LABELS[nextSeason(season)!].toLowerCase()}.`));
  return {
    role,
    key,
    season,
    firstName: opts.firstName,
    studentId,
    lead: scrubNumbers(feb ? FEB_LEAD : SEASON_EXPLAINER[season].lead),
    moves: mine.map(line),
    childMoves: child.slice(0, BRIEF_CHILD_MAX).map(title),
    notes: feb ? [PSAT_LINE] : [],
    next: next ? scrubNumbers(next) : null,
  };
}

export interface BuiltSeasonBrief {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  unsubscribeHref: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function utm(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_source=season-brief`;
}

const COLORS = { text: "#1c1f26", muted: "#6b7280", border: "#e4e4e7", bg: "#ffffff", link: "#5b4bda" };

/** The subject: "Junior spring for Maya" to a student, "Maya's junior spring: your part" to a guardian. */
export function briefSubject(c: Pick<BriefContent, "role" | "key" | "firstName">): string {
  const label = briefLabel(c.key);
  if (c.role === "guardian") return `${c.firstName ? `${c.firstName}'s` : "Your student's"} ${label[0].toLowerCase()}${label.slice(1)}: your part`;
  return c.firstName ? `${label} for ${c.firstName}` : `${label}: your advisor`;
}

/** The email. Every line is already scrubbed of figures by briefContent; the subject carries only a name. */
export function buildSeasonBrief(c: BriefContent, opts: { siteUrl: string; unsubscribeToken: string }): BuiltSeasonBrief {
  const subject = briefSubject(c);
  const unsubscribeHref = utm(`${opts.siteUrl}/unsubscribe/${opts.unsubscribeToken}/season-brief`);
  const planUrl = utm(`${opts.siteUrl}${planHref({ person: c.studentId, tab: "next" })}`);
  const child = c.firstName ?? "Your student";
  const movesHeading = c.role === "guardian" ? "Your part" : "This season's next steps";
  const childHeading = `${child}'s next steps`;
  const emptyMoves = c.role === "guardian" ? "Nothing of yours this season." : "Nothing to do this season. Enjoy it.";

  const moveHtml = c.moves
    .map((m) => {
      const href = utm(`${opts.siteUrl}${m.path}`);
      return `<li style="margin-bottom:8px;"><a href="${escapeHtml(href)}" style="color:${COLORS.link};font-weight:700;">${escapeHtml(m.title)}</a>${
        m.why ? `<br /><span style="color:${COLORS.muted};">${escapeHtml(m.why)}</span>` : ""
      }</li>`;
    })
    .join("");
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${COLORS.bg};">
    <div style="font-family:Arial,Helvetica,sans-serif;color:${COLORS.text};font-size:14px;line-height:1.55;max-width:600px;margin:0 auto;padding:24px 20px;">
      <p style="margin:0 0 4px;font-weight:700;">${escapeHtml(briefLabel(c.key))}</p>
      <p style="margin:0 0 16px;">${escapeHtml(c.lead)}</p>
      <p style="margin:0 0 4px;font-weight:700;">${escapeHtml(movesHeading)}</p>
      ${c.moves.length ? `<ul style="margin:0 0 12px;padding-left:20px;">${moveHtml}</ul>` : `<p style="margin:0 0 12px;">${escapeHtml(emptyMoves)}</p>`}
      ${
        c.childMoves.length
          ? `<p style="margin:0 0 4px;font-weight:700;">${escapeHtml(childHeading)}</p><ul style="margin:0 0 12px;padding-left:20px;color:${COLORS.muted};">${c.childMoves
              .map((t) => `<li style="margin-bottom:4px;">${escapeHtml(t)}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${c.notes.map((n) => `<p style="margin:0 0 12px;">${escapeHtml(n)}</p>`).join("")}
      ${c.next ? `<p style="margin:0 0 16px;color:${COLORS.muted};">${escapeHtml(c.next)}</p>` : ""}
      <p style="margin:0 0 20px;"><a href="${escapeHtml(planUrl)}" style="color:${COLORS.link};font-weight:700;">Open Next steps</a></p>
      <hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0 16px;" />
      <p style="color:${COLORS.muted};font-size:12px;margin:0;">
        You get this because the season brief is on for your ${escapeHtml(SITE_NAME)} account.
        <a href="${escapeHtml(unsubscribeHref)}" style="color:${COLORS.link};">Turn off the season brief</a>
      </p>
    </div>
  </body>
</html>`;

  const lines = [briefLabel(c.key), c.lead, "", movesHeading];
  if (c.moves.length === 0) lines.push(emptyMoves);
  for (const m of c.moves) lines.push(`- ${m.title}${m.why ? `. ${m.why}` : ""}: ${utm(`${opts.siteUrl}${m.path}`)}`);
  lines.push("");
  if (c.childMoves.length) {
    lines.push(childHeading);
    for (const t of c.childMoves) lines.push(`- ${t}`);
    lines.push("");
  }
  for (const n of c.notes) lines.push(n, "");
  if (c.next) lines.push(c.next, "");
  lines.push(`Open Next steps: ${planUrl}`, "", `Turn off the season brief: ${unsubscribeHref}`);

  return {
    subject,
    html,
    text: lines.join("\n"),
    headers: { "List-Unsubscribe": `<${unsubscribeHref}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    unsubscribeHref,
  };
}
