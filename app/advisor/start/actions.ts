"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/auth";
import { checkoutSentence } from "@/lib/billing";
import { billingService, cardOnFile, subscribeWithCard } from "@/lib/billing-server";
import { canStart, startOffer } from "@/lib/billing-start";
import { createSubscriptionCheckout, ensureCustomer } from "@/lib/stripe";
import { requestOrigin } from "@/lib/household-hub";

export type StartState = { status: "idle" } | { status: "error"; message: string };

/**
 * Pay for a student's advisor (specs/product/commercialization.md "Billing"): checks who may pay for whom again
 * (lib/billing-start.ts), then either charges the card already on file (a parent's household card: the subscription
 * is made on the server and the page comes back at once) or sends the browser to Stripe Checkout to collect one. The
 * subscription's metadata names the payer and the student; the webhook and the return route read it. The first charge
 * waits for the student's trial end when that is still ahead.
 */
export async function startCheckout(_prev: StartState, form: FormData): Promise<StartState> {
  const studentId = String(form.get("student_id") ?? "").trim() || null;
  const account = await getAccount();
  if (!account) return { status: "error", message: "Your session ended. Sign in again to continue." };
  const offer = await startOffer();
  const check = canStart(offer, studentId);
  if (!check.ok) return { status: "error", message: check.reason };
  const { student } = check;

  const service = billingService();
  if (await cardOnFile(service, account.user.id)) {
    try {
      const row = await subscribeWithCard(service, account.user, student.studentId);
      if (row) redirect(row.status === "trialing" ? "/advisor?trial=started" : "/advisor?subscribed=1");
    } catch (err) {
      console.error(`billing: subscribing with the saved card failed: ${err instanceof Error ? err.message : String(err)}`);
      return { status: "error", message: "We couldn't charge the card on file. Try again, or update the card from your account page." };
    }
  }

  const origin = requestOrigin(await headers());
  const customerId = await ensureCustomer(service, account.user);
  const url = await createSubscriptionCheckout({
    customerId,
    user: account.user,
    studentId: student.studentId,
    trialEnd: student.billing.trialEnd,
    sentence: checkoutSentence(student.billing.trialEnd),
    origin,
    successPath: "/advisor/start/return?session_id={CHECKOUT_SESSION_ID}",
    cancelPath: "/advisor/start?cancelled=1",
  });
  redirect(url);
}
