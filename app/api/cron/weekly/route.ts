import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/revalidate";
import { supabaseClient } from "@/lib/supabase";
import { getData } from "@/lib/data";
import { emailConfigured, sendEmail } from "@/lib/email";
import { smsConfigured, composeWeekText, type TextTask } from "@/lib/sms";
import { buildYourWeek, type WeekLine } from "@/lib/emails/your-week";
import { buildParentSummary, type ParentSummaryStudent } from "@/lib/emails/parent-summary";
import { briefContent, buildSeasonBrief, firstClause } from "@/lib/emails/season-brief";
import { trackServer } from "@/lib/analytics-server";
import { loadCycle } from "@/lib/planner/cycle";
import { NO_MONEY, stuckSignals, summaryLine } from "@/lib/planner/summary";
import { planCycleKey, readItems, todayIso } from "@/lib/planner/context";
import { shortDay } from "@/lib/planner/generators/college";
import { nowMoves, yourPartMoves } from "@/lib/planner/moves";
import { gradeForSeason } from "@/lib/planner/seasons";
import { briefDue, briefSentKey, outsideTitle, parentSummaryOn, seasonBriefOn, yourWeekOn, yourWeekTasks } from "@/lib/planner/timeline";
import {
  briefsSent,
  CONSENT_COLUMNS,
  deliverText,
  readStudentMoves,
  recordBriefSent,
  type ConsentRow,
  type StudentMoves,
} from "@/lib/planner/reminders-server";
import { addDays, stageOf } from "@/lib/planner/stage";
import { dayLabel, taskDate } from "@/lib/planner/tasks";
import type { PlanItem, PlanTask } from "@/lib/planner/types";
import { cleanupUnconsentedSnapshots } from "@/lib/chances/snapshot-write";

/**
 * The weekly reminders job (specs/planner/timeline.md "Reminders"; build brief assumption 5): Vercel Cron calls it on
 * Sunday at 23:00 UTC (Sunday evening across the US) with `Authorization: Bearer $CRON_SECRET` (vercel.json); POST is
 * exported too for a manual run. Anyone else gets 401. Uses the secret-key client, like the digest job, because it
 * reads every student's plan.
 *
 * For every student with a default list:
 *   - "Your week" email (lib/emails/your-week.ts) to the student's account when the switch is on (stored choice, else
 *     the default by season): the Now list's first three moves (dated first) and any new ED or interest move, then
 *     the tasks due in the next seven days and the first overdue one, and what was done this week, once. Nothing to
 *     say: nothing.
 *   - The week's text (lib/sms.ts composeWeekText) when the student's texts are on: the dated lines only, trimmed to
 *     three; skipped when nothing is dated; the first text is ever the confirmation; at most one a day; never at night.
 *   - The season brief (lib/emails/season-brief.ts; next-steps notifications.md) on the first Sunday of a season turn,
 *     once per turn (season_briefs_sent, written only after a real send).
 * Then every guardian: the weekly parent summary for each child it covers (their stored choice, else on from the
 * child's junior spring) and each child's season brief. First, with the secret key set, the season-end cleanup of
 * unconsented application snapshots (delete_unconsented_snapshots(); specs/chances/calibration.md).
 *
 * Returns at once, touching nothing, when neither email nor texts are configured (the secret key isn't in Vercel
 * until then, as with the digest job). Nothing is sent instantly: a new move waits for the next Sunday.
 */
async function run(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Season-end cleanup of unconsented application snapshots (specs/chances/calibration.md): whatever else is
  // configured, whenever the secret key is. A no-op until a season finishes; null when the migration isn't applied.
  const snapshotsDeleted = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? await cleanupUnconsentedSnapshots(supabaseClient("publish")) : null;

  const email = emailConfigured();
  const texts = smsConfigured();
  if (!email && !texts) {
    console.info("weekly: neither email nor texts are configured; nothing to do.");
    return Response.json({ configured: false, snapshotsDeleted });
  }

  const client = supabaseClient("publish");
  const siteUrl = request.nextUrl.origin;
  const today = todayIso();
  const summary = { students: 0, emails: 0, texts: 0, briefs: 0, skipped: 0, errors: 0 };
  const plans = new Map<string, Promise<StudentMoves | null>>();
  const movesFor = (s: { id: string; grad_year: number | null }) => {
    if (!plans.has(s.id)) plans.set(s.id, readStudentMoves(client, s, today));
    return plans.get(s.id)!;
  };

  const { data: students, error } = await client.from("students").select("id, user_id, display_name, grad_year").is("deleted_at", null);
  if (error) return Response.json({ error: `Reading students failed: ${error.message}` }, { status: 500 });

  for (const s of (students ?? []) as StudentRow[]) {
    try {
      const plan = await movesFor(s);
      if (!plan) continue;
      summary.students++;
      const week = yourWeekTasks(plan.tasks, { season: plan.season, gradYear: plan.gradYear, today });
      const any = week.moves.length + week.fresh.length + week.week.length > 0 || week.overdue !== null;
      if (email && s.user_id && any && (await sendYourWeek(client, s, plan, week, siteUrl))) summary.emails++;
      if (texts && (await sendWeekText(client, s, plan, week, siteUrl))) summary.texts++;
      if (email && s.user_id && (await sendBrief(client, s.user_id, "student", s, plan, today, siteUrl))) summary.briefs++;
      if (!any) summary.skipped++;
    } catch (err) {
      summary.errors++;
      console.error(`weekly: student ${s.id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Guardians: the weekly parent summary (specs/planner/parents.md "The weekly summary") and the season brief.   */
  /* Per student a guardian can see, the summary covers the child when the guardian turned it on, or when they   */
  /* never chose and the child is in junior spring or later. A guardian with texts on also gets the week's Your  */
  /* part as one text (composeWeekText, like the student's).                                                     */
  /* ---------------------------------------------------------------- */
  const { data: memberships } = await client.from("household_members").select("user_id").eq("role", "guardian").eq("status", "active");
  const guardianIds = [...new Set(((memberships ?? []) as { user_id: string | null }[]).map((m) => m.user_id).filter((id): id is string => id !== null))];
  for (const guardianId of guardianIds) {
    try {
      const kids = await studentsVisibleTo(client, guardianId);
      if (kids.length === 0) continue;
      const prefs = await readPrefs(client, guardianId);
      const sections: ParentSummaryStudent[] = [];
      for (const k of kids) {
        const plan = await movesFor(k);
        if (!plan || !parentSummaryOn(prefs?.parent_summary, plan.season)) continue;
        const section = await parentSummaryStudent(client, k, plan, today);
        if (section) sections.push(section);
      }
      if (sections.length && (await sendParentSummary(client, guardianId, sections, siteUrl, email, texts))) summary.emails++;
      if (email) {
        for (const k of kids) {
          const plan = await movesFor(k);
          if (plan && (await sendBrief(client, guardianId, "guardian", k, plan, today, siteUrl))) summary.briefs++;
        }
      }
    } catch (err) {
      summary.errors++;
      console.error(`weekly: guardian ${guardianId} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return Response.json({ configured: true, emailConfigured: email, textsConfigured: texts, ...summary, snapshotsDeleted });
}

export const GET = run;
export const POST = run;

interface StudentRow {
  id: string;
  user_id: string | null;
  display_name: string | null;
  grad_year: number | null;
}

interface Prefs {
  your_week: boolean | null;
  parent_summary: boolean | null;
  season_brief: boolean | null;
  unsubscribe_token: string;
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** A person's prefs row; null when they have none. Reads without season_brief before the next-steps migration. */
async function readPrefs(client: SupabaseClient, userId: string): Promise<Prefs | null> {
  const full = await client.from("notification_prefs").select("your_week, parent_summary, season_brief, unsubscribe_token").eq("user_id", userId).maybeSingle();
  if (!full.error) return (full.data as Prefs | null) ?? null;
  const base = await client.from("notification_prefs").select("your_week, parent_summary, unsubscribe_token").eq("user_id", userId).maybeSingle();
  if (base.error) throw new Error(`notification_prefs: ${base.error.message}`);
  return base.data ? { ...(base.data as Omit<Prefs, "season_brief">), season_brief: null } : null;
}

/** The prefs row, created first when missing: every account with mail gets one (and so an unsubscribe token) before its first email. */
async function ensurePrefs(client: SupabaseClient, userId: string): Promise<Prefs> {
  const prefs = await readPrefs(client, userId);
  if (prefs) return prefs;
  const created = await client.from("notification_prefs").upsert({ user_id: userId }, { onConflict: "user_id" }).select("unsubscribe_token").single();
  if (created.error) throw new Error(`notification_prefs: ${created.error.message}`);
  return { your_week: null, parent_summary: null, season_brief: null, unsubscribe_token: (created.data as { unsubscribe_token: string }).unsubscribe_token };
}

async function emailOf(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  return error ? null : (data.user?.email ?? null);
}

const nameOf = (t: PlanTask, plan: StudentMoves) => (t.item_id ? (plan.names[t.item_id] ?? null) : null);

function weekLine(t: PlanTask, plan: StudentMoves, opts: { why?: boolean; when?: string } = {}): WeekLine {
  const d = taskDate(t);
  return {
    title: outsideTitle(t, nameOf(t, plan)),
    when: opts.when ?? (d ? shortDay(d) : "this season"),
    who: t.assignee === "guardian" ? "Parent" : null,
    why: opts.why ? firstClause(t.detail) : null,
  };
}

async function sendYourWeek(client: SupabaseClient, s: StudentRow, plan: StudentMoves, week: ReturnType<typeof yourWeekTasks>, siteUrl: string): Promise<boolean> {
  const userId = s.user_id!;
  const stored = await readPrefs(client, userId);
  if (!yourWeekOn(stored?.your_week, plan.season)) return false;
  const prefs = stored ?? (await ensurePrefs(client, userId));
  const built = buildYourWeek({
    firstName: firstName(s.display_name),
    moves: [...week.moves.map((t) => weekLine(t, plan, { why: true })), ...week.fresh.map((t) => weekLine(t, plan, { when: "new on your plan" }))],
    week: week.week.map((t) => weekLine(t, plan)),
    overdue: week.overdue ? weekLine(week.overdue, plan) : null,
    done: week.done.map((t) => outsideTitle(t, nameOf(t, plan))),
    siteUrl,
    planPath: `/household/${s.id}/plan`,
    unsubscribeToken: prefs.unsubscribe_token,
  });
  if (!built) return false;
  const to = await emailOf(client, userId);
  if (!to) return false;
  const result = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text, headers: built.headers });
  return result.sent;
}

/** The week's text: the dated lines only (a text is one task and one date), trimmed to three by composeWeekText. */
async function sendWeekText(client: SupabaseClient, s: StudentRow, plan: StudentMoves, week: ReturnType<typeof yourWeekTasks>, siteUrl: string): Promise<boolean> {
  const dated = [...week.moves, ...week.week].filter((t) => taskDate(t) !== null);
  if (dated.length === 0) return false;
  const { data } = await client
    .from("sms_consents")
    .select(CONSENT_COLUMNS)
    .eq("student_id", s.id)
    .is("revoked_at", null)
    .is("provider_opt_out_at", null)
    .maybeSingle();
  if (!data) return false;
  const tasks: TextTask[] = dated.map((t) => {
    const l = weekLine(t, plan);
    return { title: l.title, when: l.when, who: l.who };
  });
  const body = composeWeekText(tasks, `${siteUrl}/household/${s.id}/plan`);
  if (!body) return false;
  const result = await deliverText(client, data as ConsentRow, "week", body, { forName: firstName(s.display_name) });
  return result.sent;
}

/**
 * One person's season brief for one student, when a turn is due (lib/planner/timeline.ts briefDue) and their switch
 * is on. Recorded in season_briefs_sent only after a real send; skipped when that table isn't there yet.
 */
async function sendBrief(
  client: SupabaseClient,
  userId: string,
  role: "student" | "guardian",
  s: { id: string; display_name: string | null },
  plan: StudentMoves,
  today: string,
  siteUrl: string,
): Promise<boolean> {
  const sent = await briefsSent(client, userId, s.id);
  if (!sent) return false;
  const turn = briefDue(plan.gradYear, today, sent);
  if (!turn) return false;
  const stored = await readPrefs(client, userId);
  if (!seasonBriefOn(stored?.season_brief)) return false;
  const prefs = stored ?? (await ensurePrefs(client, userId));
  const content = briefContent(plan.tasks, plan.names, {
    role,
    key: turn.key,
    season: turn.season,
    gradYear: plan.gradYear,
    today,
    studentId: s.id,
    firstName: firstName(s.display_name),
  });
  const built = buildSeasonBrief(content, { siteUrl, unsubscribeToken: prefs.unsubscribe_token });
  const to = await emailOf(client, userId);
  if (!to) return false;
  const result = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text, headers: built.headers });
  if (!result.sent) return false;
  await recordBriefSent(client, { userId, studentId: s.id, season: turn.key, cycleStart: turn.cycleStart });
  console.info(`weekly: season brief ${briefSentKey(turn)} sent (${role}).`);
  await trackServer("brief_sent", { season: turn.season, role }, userId);
  return true;
}

/* ------------------------------------------------------------------ */
/* The weekly parent summary                                           */
/* ------------------------------------------------------------------ */

const YOUR_PART_EMAIL_MAX = 5;
const CHILD_MOVES_EMAIL_MAX = 3;

type VisibleStudent = { id: string; display_name: string | null; grad_year: number | null };

/** The guardian's visible students, by their active guardian memberships (service-role read; no RLS to apply). */
async function studentsVisibleTo(client: SupabaseClient, guardianUserId: string): Promise<VisibleStudent[]> {
  const memberships = await client.from("household_members").select("household_id").eq("user_id", guardianUserId).eq("role", "guardian").eq("status", "active");
  const householdIds = ((memberships.data ?? []) as { household_id: string }[]).map((m) => m.household_id);
  if (householdIds.length === 0) return [];
  const rows = await client.from("household_members").select("student_id").in("household_id", householdIds).eq("role", "student").eq("status", "active");
  const studentIds = [...new Set(((rows.data ?? []) as { student_id: string | null }[]).map((r) => r.student_id).filter((id): id is string => id !== null))];
  if (studentIds.length === 0) return [];
  const students = await client.from("students").select("id, display_name, grad_year").in("id", studentIds).is("deleted_at", null);
  return (students.data ?? []) as VisibleStudent[];
}

/**
 * One student's section of the summary (lib/planner/summary.ts, computed the same way as the Plan tab): their part
 * first (yourPartMoves), then the child's top three moves as read-only titles, the summary line, the stuck signals,
 * and what was ticked this week. Every title goes through outsideTitle (no figures).
 */
async function parentSummaryStudent(client: SupabaseClient, s: VisibleStudent, plan: StudentMoves, today: string): Promise<ParentSummaryStudent | null> {
  const items = await readItems(client, plan.listId);
  const itemRows = (items.data ?? []) as PlanItem[];
  const taskRows = plan.tasks;
  const itemIds = itemRows.map((i) => i.id);
  const visitRows = itemIds.length
    ? ((await client.from("plan_visits").select("on_date, created_at, updated_at").in("item_id", itemIds)).data ?? [])
    : [];
  const visits = visitRows as { on_date: string; created_at: string; updated_at: string }[];
  const { getSchoolById } = await getData();
  const schools: Record<string, { name: string; links: null }> = {};
  for (const i of itemRows) if (!schools[i.unit_id]) schools[i.unit_id] = { name: getSchoolById(i.unit_id)?.name ?? "A college", links: null };
  const { current, stages } = stageOf({ items: itemRows, tasks: taskRows, today });
  const grade = gradeForSeason(plan.season);
  const cycle = loadCycle(planCycleKey(plan.gradYear, today));
  const summary = summaryLine({ current, stages, tasks: taskRows, items: itemRows, schools, visits, today });
  const signals = stuckSignals({ items: itemRows, tasks: taskRows, visits, schools, money: NO_MONEY, cycle, grade, today });
  const yourPart = yourPartMoves(taskRows, today)
    .slice(0, YOUR_PART_EMAIL_MAX)
    .map((t) => ({ title: outsideTitle(t, nameOf(t, plan)), when: taskDate(t) ? dayLabel(taskDate(t)!, today) : null }));
  const childMoves = nowMoves(taskRows, { season: plan.season, gradYear: plan.gradYear, today, viewer: "guardian" })
    .now.slice(0, CHILD_MOVES_EMAIL_MAX)
    .map((t) => outsideTitle(t, nameOf(t, plan)));
  const weekAgo = addDays(today, -7);
  const tickedThisWeek = taskRows.filter((t) => t.done_at !== null && t.done_at.slice(0, 10) >= weekAgo).map((t) => outsideTitle(t, nameOf(t, plan)));
  // Plan v3 (specs/planner/v3/parents.md "Rules"): the week's skipped moves, titles only.
  const skipped = taskRows.filter((t) => t.dismissed_at !== null && t.dismissed_at.slice(0, 10) >= weekAgo).map((t) => outsideTitle(t, nameOf(t, plan)));
  return {
    studentId: s.id,
    firstName: firstName(s.display_name),
    summary,
    yourPart,
    childMoves,
    stuckSignals: signals.map((sig) => sig.text),
    tickedThisWeek,
    skipped,
  };
}

/** Sends one guardian's weekly summary (email, and the week's Your part as a text when they have texts on). */
async function sendParentSummary(client: SupabaseClient, userId: string, sections: ParentSummaryStudent[], siteUrl: string, email: boolean, texts: boolean): Promise<boolean> {
  let sent = false;
  if (email) {
    const prefs = await ensurePrefs(client, userId);
    const to = await emailOf(client, userId);
    const built = to ? buildParentSummary({ guardianFirstName: null, students: sections, siteUrl, unsubscribeToken: prefs.unsubscribe_token }) : null;
    if (to && built) {
      const result = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text, headers: built.headers });
      sent = result.sent || sent;
    }
  }
  if (texts) {
    const { data: consent } = await client.from("sms_consents").select(CONSENT_COLUMNS).eq("user_id", userId).is("revoked_at", null).is("provider_opt_out_at", null).maybeSingle();
    if (consent) {
      const tasks: TextTask[] = sections.flatMap((s) => s.yourPart.map((t) => ({ title: t.title, when: t.when })));
      const body = composeWeekText(tasks, `${siteUrl}/household`);
      if (body) await deliverText(client, consent as ConsentRow, "parent", body, {});
    }
  }
  return sent;
}
