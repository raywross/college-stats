import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { applySubscription, billingService, sendTrialReminder, siteOrigin } from "@/lib/billing-server";
import { billingConfigured, fetchSubscription, webhookEvent } from "@/lib/stripe";
import type { SubscriptionRow } from "@/lib/billing";

/**
 * Stripe's webhook (specs/product/commercialization.md "Billing"; specs/product/advisor.md "2. The trial"). Signature-
 * verified with STRIPE_WEBHOOK_SECRET over the raw body; anything else answers 400 and Stripe retries nothing it
 * shouldn't. Each event id is recorded in `stripe_events` first, so a retry of one already handled does nothing.
 *
 * Handled:
 * - `checkout.session.completed`: the subscription the session made is fetched and stored (the return page does the
 *   same, so whichever lands first writes the row and the other finds it there).
 * - `customer.subscription.created|updated|deleted`: the row is written from the event's object; the change's events
 *   (trial started, converted, cancelled; a year cancelled or renewed) go to telemetry.
 * - `customer.subscription.trial_will_end`: three days before the end, the one reminder email, once.
 * Every other type is acknowledged and ignored. Node runtime (the Stripe SDK and the secret-key client).
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!billingConfigured()) return Response.json({ error: "Billing isn't configured" }, { status: 503 });
  const raw = await request.text();
  const event = await webhookEvent(raw, request.headers.get("stripe-signature"));
  if (!event) return Response.json({ error: "Bad signature" }, { status: 400 });

  const service = billingService();
  const { error: seen } = await service.from("stripe_events").insert({ id: event.id, type: event.type });
  if (seen) {
    // A duplicate id is a retry of something handled: say so and stop. Any other failure is ours; let Stripe retry.
    if (/duplicate key|23505/.test(seen.message)) return Response.json({ received: true, duplicate: true });
    console.error(`stripe webhook: recording ${event.id} failed: ${seen.message}`);
    return Response.json({ error: "Couldn't record the event" }, { status: 500 });
  }

  try {
    const outcome = await handle(service, event);
    return Response.json({ received: true, ...outcome });
  } catch (err) {
    // Let Stripe retry: the event row is removed so the retry isn't taken for a duplicate.
    await service.from("stripe_events").delete().eq("id", event.id);
    console.error(`stripe webhook: ${event.type} ${event.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Handling failed" }, { status: 500 });
  }
}

async function handle(service: ReturnType<typeof billingService>, event: Stripe.Event): Promise<Record<string, unknown>> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!subId) return { ignored: "no subscription" };
      const result = await applySubscription(service, await fetchSubscription(subId));
      return { subscription: subId, stored: result !== null };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const result = await applySubscription(service, event.data.object);
      return { subscription: event.data.object.id, stored: result !== null, status: result?.next.status ?? null };
    }
    case "customer.subscription.trial_will_end": {
      const result = await applySubscription(service, event.data.object);
      if (!result) return { ignored: "unknown subscription" };
      const row = result.next as SubscriptionRow;
      const reminder = await sendTrialReminder(service, row, siteOrigin());
      return { subscription: row.stripe_subscription_id, reminder };
    }
    default:
      return { ignored: event.type };
  }
}
