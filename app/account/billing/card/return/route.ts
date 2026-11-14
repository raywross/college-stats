import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/accounts";
import { getUser } from "@/lib/auth";
import { billingService, saveCardFromSession } from "@/lib/billing-server";
import { billingConfigured } from "@/lib/stripe";

/**
 * Where Stripe's setup Checkout comes back (specs/product/commercialization.md "Billing", the household card): the
 * saved card is recorded right away (the webhook does the same; whichever is second finds it there), then on to `next`,
 * usually Household, where adding the student now goes through. A session that isn't the signed-in person's is ignored.
 */
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/account#advisor");
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  const sessionId = request.nextUrl.searchParams.get("session_id");
  const user = await getUser();
  if (!user || !sessionId || !billingConfigured()) return to(next);
  try {
    await saveCardFromSession(billingService(), sessionId, user.id);
  } catch (err) {
    console.error(`billing: recording the saved card failed (the webhook will): ${err instanceof Error ? err.message : String(err)}`);
  }
  return to(`${next}${next.includes("?") ? "&" : "?"}card=saved`);
}
