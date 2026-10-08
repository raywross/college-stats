import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/revalidate";
import { supabaseClient } from "@/lib/supabase";
import { emailConfigured, sendEmail } from "@/lib/email";
import { smsConfigured, composeWeekText, type TextTask } from "@/lib/sms";
import { buildYourWeek, type WeekLine } from "@/lib/emails/your-week";
import { gradeOf } from "@/lib/planner/cycle";
import { todayIso } from "@/lib/planner/context";
import { shortDay } from "@/lib/planner/generators/college";
import { CONSENT_COLUMNS, deliverText, readListTasks, type ConsentRow, type ListTasks } from "@/lib/planner/reminders-server";
import { dueSoon, firstOverdue, outsideTitle, yourWeekOn } from "@/lib/planner/timeline";
import { taskDate } from "@/lib/planner/tasks";
import type { PlanTask } from "@/lib/planner/types";

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
  /* EXTENSION POINT (U8, specs/planner/parents.md "The weekly summary") */
  /* The parent summary email (lib/emails/parent-summary.ts) goes here:  */
  /* for each guardian with the summary on, per student they can see,   */
  /* using the same `client`, `today`, `siteUrl`, and `summary` counts.  */
  /* ---------------------------------------------------------------- */

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
