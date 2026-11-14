import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { applySubscription, billingService } from "@/lib/billing-server";
import { billingConfigured, subscriptionOfSession } from "@/lib/stripe";

/**
 * Where Stripe Checkout comes back (specs/product/advisor.md "2. The trial"): the session's subscription is fetched
 * and stored right away, so the Advisor tab is whole on the very next page even when the webhook hasn't landed yet
 * (both write the same row; whichever is second finds it there). Then on to the advisor with a one-time flag for the
 * welcome line. A session that isn't the signed-in person's is ignored: the subscription's metadata names its buyer.
 */
export async function GET(request: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  const sessionId = request.nextUrl.searchParams.get("session_id");
  const user = await getUser();
  if (!user || !sessionId || !billingConfigured()) return to("/advisor");
  try {
    const sub = await subscriptionOfSession(sessionId);
    if (sub && sub.metadata?.user_id === user.id) {
      const result = await applySubscription(billingService(), sub);
      if (result) return to(result.next.status === "trialing" ? "/advisor?trial=started" : "/advisor?subscribed=1");
    }
  } catch (err) {
    console.error(`billing: storing the checkout's subscription failed (the webhook will): ${err instanceof Error ? err.message : String(err)}`);
  }
  return to("/advisor?trial=pending");
}
