"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { applySubscription, billingService } from "@/lib/billing-server";
import { requestOrigin } from "@/lib/household-hub";
import { billingConfigured, createPortalSession, setCancelAtPeriodEnd } from "@/lib/stripe";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SubscriptionRow } from "@/lib/billing";

export type BillingActionState = { status: "idle" } | { status: "done"; message: string } | { status: "error"; message: string };

/** The signed-in person's own subscription row (row-level security shows them theirs), or null. */
async function ownRow(id: string): Promise<{ user: { id: string }; row: SubscriptionRow } | null> {
  const user = await getUser();
  if (!user || !billingConfigured()) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("subscriptions").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  return data ? { user, row: data as SubscriptionRow } : null;
}

/** Open Stripe's Customer Portal (cancel, card, invoices) for the signed-in buyer, back to /account after. */
export async function openBillingPortal(): Promise<void> {
  const user = await getUser();
  if (!user || !billingConfigured()) redirect("/account");
  const service = billingService();
  const { data } = await service.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  const customerId = (data as { stripe_customer_id: string } | null)?.stripe_customer_id;
  if (!customerId) redirect("/account#advisor");
  const origin = requestOrigin(await headers());
  redirect(await createPortalSession(customerId, `${origin}/account#advisor`));
}

/**
 * Cancel at the period's end (specs/product/advisor.md "Cancel": during the trial it ends at day 14, not at once, so
 * the family keeps what it started), or take the cancellation back. The row is rewritten from Stripe's answer.
 */
export async function setCancel(_prev: BillingActionState, form: FormData): Promise<BillingActionState> {
  const id = String(form.get("subscription") ?? "");
  const cancel = form.get("cancel") === "1";
  const own = await ownRow(id);
  if (!own) return { status: "error", message: "That subscription isn't yours, or your session ended." };
  try {
    const sub = await setCancelAtPeriodEnd(own.row.stripe_subscription_id, cancel);
    await applySubscription(billingService(), sub);
  } catch (err) {
    console.error(`billing: cancel change failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "error", message: "We couldn't change that. Try again in a moment, or manage it from the billing portal." };
  }
  refresh();
  return { status: "done", message: cancel ? (own.row.status === "trialing" ? "Cancelled. Your trial runs to its end and nothing is charged." : "Cancelled. The advisor stays whole until the year ends, then turns read-only.") : "Kept. The advisor carries on." };
}
