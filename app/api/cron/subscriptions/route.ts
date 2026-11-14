import type { NextRequest } from "next/server";
import { withJobRun } from "@/lib/jobs/record";
import { isAuthorized } from "@/lib/revalidate";
import { applySubscription, billingService, sendCardlessTrialReminder, sendTrialReminder, siteOrigin } from "@/lib/billing-server";
import { billingConfigured, fetchSubscription } from "@/lib/stripe";
import { priceLiveAtWith } from "@/lib/entitlements";
import type { SubscriptionRow, TrialRow } from "@/lib/billing";

/**
 * The nightly reconcile (specs/product/commercialization.md "Billing": "A nightly job reconciles against Stripe").
 * Every subscription that can still change (trialing, active, past due, incomplete, paused) is fetched from Stripe and
 * rewritten through the same path the webhook uses, so a missed or failed webhook corrects itself within a day; the
 * change's events are sent the same way. A trial ending within three days whose reminder never went out gets it here:
 * a subscription's (Stripe's `trial_will_end` may have been missed) or a cardless one's (the database's trial, which
 * Stripe knows nothing about, asking for a card). Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`; without
 * Stripe's keys the job answers `configured: false`.
 */
async function run(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!billingConfigured()) {
    console.info("subscriptions: billing not configured; nothing to do.");
    return Response.json({ configured: false, checked: 0 });
  }
  const service = billingService();
  const { data, error } = await service.from("subscriptions").select("*").in("status", ["trialing", "active", "past_due", "incomplete", "paused"]);
  if (error) return Response.json({ error: `Reading subscriptions failed: ${error.message}` }, { status: 500 });
  const rows = (data ?? []) as SubscriptionRow[];
  const summary = { configured: true, checked: 0, changed: 0, reminders: 0, cardlessReminders: 0, errors: 0 };
  const now = Date.now();
  const soon = new Date(now + 3 * 86_400_000).toISOString();
  const origin = siteOrigin();
  for (const row of rows) {
    try {
      const result = await applySubscription(service, await fetchSubscription(row.stripe_subscription_id));
      summary.checked++;
      if (result && (result.prev?.status !== result.next.status || result.prev?.cancel_at_period_end !== result.next.cancel_at_period_end || result.prev?.current_period_end !== result.next.current_period_end)) summary.changed++;
      const next = result?.next ?? row;
      if (next.status === "trialing" && next.trial_end && !next.reminder_sent_at && next.trial_end <= soon) {
        const sent = await sendTrialReminder(service, next, origin);
        if (sent.sent) summary.reminders++;
      }
    } catch (err) {
      summary.errors++;
      console.error(`subscriptions: ${row.stripe_subscription_id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Cardless trials ending soon, with no live subscription paying for the student: the "add a card" reminder. Only
  // once the price is live (before it, a trial's end changes nothing).
  if ((await priceLiveAtWith(service)) !== null) {
    const { data: trials, error: trialsError } = await service
      .from("advisor_trials")
      .select("*")
      .is("reminder_sent_at", null)
      .gt("ends_at", new Date(now).toISOString())
      .lte("ends_at", soon);
    if (trialsError) {
      summary.errors++;
      console.error(`subscriptions: reading trials failed: ${trialsError.message}`);
    } else {
      const paid = new Set(rows.filter((r) => r.status === "trialing" || r.status === "active" || r.status === "past_due").map((r) => r.covers_student_id));
      for (const trial of (trials ?? []) as TrialRow[]) {
        if (paid.has(trial.student_id)) continue;
        try {
          const sent = await sendCardlessTrialReminder(service, trial, origin);
          if (sent.sent) summary.cardlessReminders++;
        } catch (err) {
          summary.errors++;
          console.error(`subscriptions: trial reminder for ${trial.student_id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  return Response.json(summary);
}

const recorded = withJobRun("subscriptions", run);
export const GET = recorded;
export const POST = recorded;
