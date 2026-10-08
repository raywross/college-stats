import type { NextRequest } from "next/server";
import { isAuthorized } from "@/lib/revalidate";
import { supabaseClient } from "@/lib/supabase";
import { composeDayBeforeText, smsConfigured } from "@/lib/sms";
import { todayIso } from "@/lib/planner/context";
import { CONSENT_COLUMNS, deliverText, readListTasks, type ConsentRow } from "@/lib/planner/reminders-server";
import { dueTomorrow, outsideTitle } from "@/lib/planner/timeline";

/**
 * The day-before text (specs/planner/timeline.md "Texts"): for every student with texts on, one text the evening
 * before a hard deadline (an application, a reply, a deposit). Vercel Cron calls it Monday to Saturday at 23:00 UTC
 * (vercel.json); Sunday's evening belongs to the weekly job, whose text already names Monday's deadlines. Bearer
 * CRON_SECRET; POST for a manual run. Dormant (returns at once) until the Twilio env is set.
 *
 * lib/sms.ts and lib/planner/reminders-server.ts deliverText enforce the rules: an active consent, the confirmation
 * first, at most one text a day per person, none from 9 pm to 8 am in the household's time zone.
 */
async function run(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!smsConfigured()) {
    console.info("day-before: texts not configured; nothing to do.");
    return Response.json({ configured: false });
  }
  const client = supabaseClient("publish");
  const siteUrl = request.nextUrl.origin;
  const today = todayIso();
  const summary = { consents: 0, sent: 0, errors: 0 };

  const { data, error } = await client
    .from("sms_consents")
    .select(CONSENT_COLUMNS)
    .not("student_id", "is", null)
    .is("revoked_at", null)
    .is("provider_opt_out_at", null);
  if (error) return Response.json({ error: `Reading consents failed: ${error.message}` }, { status: 500 });

  for (const consent of (data ?? []) as ConsentRow[]) {
    summary.consents++;
    try {
      const list = await client.from("lists").select("id").eq("student_id", consent.student_id!).eq("is_default", true).maybeSingle();
      const listId = (list.data as { id: string } | null)?.id;
      if (!listId) continue;
      const plan = await readListTasks(client, listId);
      const task = dueTomorrow(plan.tasks, today)[0];
      if (!task) continue;
      const title = outsideTitle(task, task.item_id ? (plan.names[task.item_id] ?? null) : null);
      const body = composeDayBeforeText({ title, when: null }, `${siteUrl}/household/${consent.student_id}/plan`);
      const result = await deliverText(client, consent, "day_before", body, { taskId: task.id });
      if (result.sent) summary.sent++;
    } catch (err) {
      summary.errors++;
      console.error(`day-before: consent ${consent.id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return Response.json({ configured: true, ...summary });
}

export const GET = run;
export const POST = run;
