import type { NextRequest } from "next/server";
import { withJobRun } from "@/lib/jobs/record";
import { isAuthorized } from "@/lib/revalidate";
import { applySubscription, billingService, sendTrialReminder, siteOrigin } from "@/lib/billing-server";
import { billingConfigured, fetchSubscription } from "@/lib/stripe";
import type { SubscriptionRow } from "@/lib/billing";

/**
 * The nightly reconcile (specs/product/commercialization.md "Billing": "A nightly job reconciles against Stripe").
 * Every subscription that can still change (trialing, active, past due, incomplete, paused) is fetched from Stripe and
 * rewritten through the same path the webhook uses, so a missed or failed webhook corrects itself within a day; the
 * change's events are sent the same way. A trial ending within three days whose reminder never went out gets it here.
 * Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`; without Stripe's keys the job answers `configured: false`.
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
  const summary = { configured: true, checked: 0, changed: 0, reminders: 0, errors: 0 };
  const soon = Date.now() + 3 * 86_400_000;
  for (const row of rows) {
    try {
      const result = await applySubscription(service, await fetchSubscription(row.stripe_subscription_id));
      summary.checked++;
      if (result && (result.prev?.status !== result.next.status || result.prev?.cancel_at_period_end !== result.next.cancel_at_period_end || result.prev?.current_period_end !== result.next.current_period_end)) summary.changed++;
      const next = result?.next ?? row;
      if (next.status === "trialing" && next.trial_end && !next.reminder_sent_at && new Date(next.trial_end).getTime() <= soon) {
        const sent = await sendTrialReminder(service, next, siteOrigin());
        if (sent.sent) summary.reminders++;
      }
    } catch (err) {
      summary.errors++;
      console.error(`subscriptions: ${row.stripe_subscription_id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return Response.json(summary);
}

const recorded = withJobRun("subscriptions", run);
export const GET = recorded;
export const POST = recorded;
