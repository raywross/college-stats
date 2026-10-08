import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/revalidate";
import { supabaseClient } from "@/lib/supabase";
import { getData } from "@/lib/data";
import { emailConfigured, sendEmail } from "@/lib/email";
import { smsConfigured, composeWeekText, type TextTask } from "@/lib/sms";
import { buildYourWeek, type WeekLine } from "@/lib/emails/your-week";
import { buildParentSummary, type ParentSummaryStudent } from "@/lib/emails/parent-summary";
import { gradeOf, loadCycle } from "@/lib/planner/cycle";
import { NO_MONEY, stuckSignals, summaryLine } from "@/lib/planner/summary";
import { PLAN_ITEM_COLUMNS, PLAN_TASK_COLUMNS, planCycleKey, todayIso } from "@/lib/planner/context";
import { shortDay } from "@/lib/planner/generators/college";
import { CONSENT_COLUMNS, deliverText, readListTasks, type ConsentRow, type ListTasks } from "@/lib/planner/reminders-server";
import { addDays, stageOf } from "@/lib/planner/stage";
import { dayLabel, isOpen, compareTasks, taskDate } from "@/lib/planner/tasks";
import { dueSoon, firstOverdue, outsideTitle, yourWeekOn } from "@/lib/planner/timeline";
import type { PlanItem, PlanTask } from "@/lib/planner/types";

/**
 * The weekly reminders job (specs/planner/timeline.md "Reminders"; build brief assumption 5): Vercel Cron calls it on
 * Sunday at 23:00 UTC (Sunday evening across the US) with `Authorization: Bearer $CRON_SECRET` (vercel.json); POST is
 * exported too for a manual run. Anyone else gets 401. Uses the secret-key client, like the digest job, because it
 * reads every student's plan.
 *
 * For every student with a default list:
 *   - "Your week" email (lib/emails/your-week.ts) to the student's account when the switch is on (stored choice, else
 *     the default by grade), with the tasks due in the next seven days and the first overdue one. Nothing due: nothing.
 *   - The week's text (lib/sms.ts composeWeekText) when the student's texts are on: the first three tasks; skipped
 *     when nothing is due; the first text is ever the confirmation; at most one a day; never at night.
 * Then the parent summary (U8's extension point below).
 *
 * Returns at once, touching nothing, when neither email nor texts are configured (the secret key isn't in Vercel
 * until then, as with the digest job).
 */
async function run(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = emailConfigured();
  const texts = smsConfigured();
  if (!email && !texts) {
    console.info("weekly: neither email nor texts are configured; nothing to do.");
    return Response.json({ configured: false });
  }

  const client = supabaseClient("publish");
  const siteUrl = request.nextUrl.origin;
  const today = todayIso();
  const summary = { students: 0, emails: 0, texts: 0, skipped: 0, errors: 0 };

  const { data: students, error } = await client.from("students").select("id, user_id, display_name, grad_year").is("deleted_at", null);
  if (error) return Response.json({ error: `Reading students failed: ${error.message}` }, { status: 500 });

  for (const s of (students ?? []) as StudentRow[]) {
    try {
      const list = await client.from("lists").select("id").eq("student_id", s.id).eq("is_default", true).maybeSingle();
      const listId = (list.data as { id: string } | null)?.id;
      if (!listId) continue;
      summary.students++;
      const plan = await readListTasks(client, listId);
      const week = dueSoon(plan.tasks, today);
      const overdue = firstOverdue(plan.tasks, today);
      if (week.length === 0 && !overdue) {
        summary.skipped++;
        continue;
      }
      if (email && s.user_id && (await sendYourWeek(client, s, plan, week, overdue, today, siteUrl))) summary.emails++;
      if (texts && week.length > 0 && (await sendWeekText(client, s, plan, week, siteUrl))) summary.texts++;
    } catch (err) {
      summary.errors++;
      console.error(`weekly: student ${s.id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* U8 extension: the weekly parent summary (specs/planner/parents.md "The weekly summary"), off by default.      */
  /* Each guardian who's turned it on, per student they can see: the summary line, Your part (at most five), the   */
  /* stuck signals, and what the student ticked this week, titles only, one link to the household. A guardian with */
  /* texts on also gets the week's Your part as one text (composeWeekText, like the student's).                   */
  /* ---------------------------------------------------------------- */
  if (email || texts) {
    const { data: prefs } = await client.from("notification_prefs").select("user_id, parent_summary, unsubscribe_token").eq("parent_summary", true);
    for (const p of (prefs ?? []) as { user_id: string; parent_summary: boolean; unsubscribe_token: string }[]) {
      try {
        const sent = await sendParentSummary(client, p.user_id, p.unsubscribe_token, today, siteUrl, email, texts);
        if (sent) summary.emails++;
      } catch (err) {
        summary.errors++;
        console.error(`weekly: parent summary for ${p.user_id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  return Response.json({ configured: true, emailConfigured: email, textsConfigured: texts, ...summary });
}

export const GET = run;
export const POST = run;

interface StudentRow {
  id: string;
  user_id: string | null;
  display_name: string | null;
  grad_year: number | null;
}

function line(t: PlanTask, plan: ListTasks): { title: string; when: string; guardian: boolean } {
  return {
    title: outsideTitle(t, t.item_id ? (plan.names[t.item_id] ?? null) : null),
    when: shortDay(taskDate(t)!),
    guardian: t.assignee === "guardian",
  };
}

async function sendYourWeek(
  client: SupabaseClient,
  s: StudentRow,
  plan: ListTasks,
  week: PlanTask[],
  overdue: PlanTask | null,
  today: string,
  siteUrl: string,
): Promise<boolean> {
  const userId = s.user_id!;
  let prefs = (await client.from("notification_prefs").select("your_week, unsubscribe_token").eq("user_id", userId).maybeSingle()).data as {
    your_week: boolean | null;
    unsubscribe_token: string;
  } | null;
  if (!yourWeekOn(prefs?.your_week, gradeOf(s.grad_year, today))) return false;
  if (!prefs) {
    // Every account with mail gets a prefs row (and so an unsubscribe token) before its first email.
    const created = await client.from("notification_prefs").upsert({ user_id: userId }, { onConflict: "user_id" }).select("your_week, unsubscribe_token").single();
    if (created.error) throw new Error(`notification_prefs: ${created.error.message}`);
    prefs = created.data as { your_week: boolean | null; unsubscribe_token: string };
  }
  const toLine = (t: PlanTask): WeekLine => {
    const l = line(t, plan);
    return { title: l.title, when: l.when, who: l.guardian ? "Parent" : null };
  };
  const built = buildYourWeek({
    firstName: s.display_name?.trim().split(/\s+/)[0] ?? null,
    week: week.map(toLine),
    overdue: overdue ? toLine(overdue) : null,
    siteUrl,
    planPath: `/household/${s.id}/plan`,
    unsubscribeToken: prefs.unsubscribe_token,
  });
  if (!built) return false;
  const { data: userRes, error } = await client.auth.admin.getUserById(userId);
  const to = error ? null : (userRes.user?.email ?? null);
  if (!to) return false;
  const result = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text, headers: built.headers });
  return result.sent;
}

async function sendWeekText(client: SupabaseClient, s: StudentRow, plan: ListTasks, week: PlanTask[], siteUrl: string): Promise<boolean> {
  const { data } = await client
    .from("sms_consents")
    .select(CONSENT_COLUMNS)
    .eq("student_id", s.id)
    .is("revoked_at", null)
    .is("provider_opt_out_at", null)
    .maybeSingle();
  if (!data) return false;
  const tasks: TextTask[] = week.map((t) => {
    const l = line(t, plan);
    return { title: l.title, when: l.when, who: l.guardian ? "Parent" : null };
  });
  const body = composeWeekText(tasks, `${siteUrl}/household/${s.id}/plan`);
  if (!body) return false;
  const first = s.display_name?.trim().split(/\s+/)[0] ?? null;
  const result = await deliverText(client, data as ConsentRow, "week", body, { forName: first });
  return result.sent;
}

/* ------------------------------------------------------------------ */
/* U8: the weekly parent summary                                       */
/* ------------------------------------------------------------------ */

const YOUR_PART_EMAIL_MAX = 5;

/** The guardian's visible students, by their active guardian memberships (service-role read; no RLS to apply). */
async function studentsVisibleTo(client: SupabaseClient, guardianUserId: string): Promise<{ id: string; display_name: string | null; grad_year: number | null }[]> {
  const memberships = await client.from("household_members").select("household_id").eq("user_id", guardianUserId).eq("role", "guardian").eq("status", "active");
  const householdIds = ((memberships.data ?? []) as { household_id: string }[]).map((m) => m.household_id);
  if (householdIds.length === 0) return [];
  const rows = await client.from("household_members").select("student_id").in("household_id", householdIds).eq("role", "student").eq("status", "active");
  const studentIds = [...new Set(((rows.data ?? []) as { student_id: string | null }[]).map((r) => r.student_id).filter((id): id is string => id !== null))];
  if (studentIds.length === 0) return [];
  const students = await client.from("students").select("id, display_name, grad_year").in("id", studentIds).is("deleted_at", null);
  return (students.data ?? []) as { id: string; display_name: string | null; grad_year: number | null }[];
}

/** One student's section of the summary (lib/planner/summary.ts, computed the same way as the Plan tab). */
async function parentSummaryStudent(client: SupabaseClient, s: { id: string; display_name: string | null; grad_year: number | null }, today: string): Promise<ParentSummaryStudent | null> {
  const list = await client.from("lists").select("id").eq("student_id", s.id).eq("is_default", true).maybeSingle();
  const listId = (list.data as { id: string } | null)?.id;
  if (!listId) return null;
  const [items, tasks] = await Promise.all([
    client.from("list_items").select(PLAN_ITEM_COLUMNS).eq("list_id", listId),
    client.from("plan_tasks").select(PLAN_TASK_COLUMNS).eq("list_id", listId),
  ]);
  const itemRows = (items.data ?? []) as PlanItem[];
  const taskRows = (tasks.data ?? []) as PlanTask[];
  const itemIds = itemRows.map((i) => i.id);
  const visitRows = itemIds.length
    ? ((await client.from("plan_visits").select("on_date, created_at, updated_at").in("item_id", itemIds)).data ?? [])
    : [];
  const visits = visitRows as { on_date: string; created_at: string; updated_at: string }[];
  const { getSchoolById } = await getData();
  const schools: Record<string, { name: string; links: null }> = {};
  for (const i of itemRows) if (!schools[i.unit_id]) schools[i.unit_id] = { name: getSchoolById(i.unit_id)?.name ?? "A college", links: null };
  const { current, stages } = stageOf({ items: itemRows, tasks: taskRows, today });
  const grade = gradeOf(s.grad_year, today);
  const cycle = loadCycle(planCycleKey(s.grad_year, today));
  const summary = summaryLine({ current, stages, tasks: taskRows, items: itemRows, schools, visits, today });
  const signals = stuckSignals({ items: itemRows, tasks: taskRows, visits, schools, money: NO_MONEY, cycle, grade, today });
  const itemById = new Map(itemRows.map((i) => [i.id, i]));
  const yourPartTasks = taskRows
    .filter((t) => isOpen(t, today) && (t.assignee === "guardian" || t.assignee === "either"))
    .sort(compareTasks)
    .slice(0, YOUR_PART_EMAIL_MAX)
    .map((t) => {
      const college = t.item_id ? (schools[itemById.get(t.item_id)?.unit_id ?? ""]?.name ?? null) : null;
      return { title: outsideTitle(t, college), when: taskDate(t) ? dayLabel(taskDate(t)!, today) : null };
    });
  const weekAgo = addDays(today, -7);
  const tickedThisWeek = taskRows.filter((t) => t.done_at !== null && t.done_at.slice(0, 10) >= weekAgo).map((t) => t.title);
  return {
    studentId: s.id,
    firstName: s.display_name?.trim().split(/\s+/)[0] ?? null,
    summary,
    yourPart: yourPartTasks,
    stuckSignals: signals.map((sig) => sig.text),
    tickedThisWeek,
  };
}

/** Sends one guardian's weekly summary (email, and the week's Your part as a text when they have texts on). */
async function sendParentSummary(client: SupabaseClient, userId: string, unsubscribeToken: string, today: string, siteUrl: string, email: boolean, texts: boolean): Promise<boolean> {
  const students = await studentsVisibleTo(client, userId);
  if (students.length === 0) return false;
  const sections = (await Promise.all(students.map((s) => parentSummaryStudent(client, s, today)))).filter((s): s is ParentSummaryStudent => s !== null);
  let sent = false;
  if (email) {
    const { data: userRes, error } = await client.auth.admin.getUserById(userId);
    const to = error ? null : (userRes.user?.email ?? null);
    const built = to ? buildParentSummary({ guardianFirstName: null, students: sections, siteUrl, unsubscribeToken }) : null;
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
