import Link from "next/link";
import { AccountSection } from "@/components/account/AccountSection";
import { CancelControl } from "@/components/account/CancelControl";
import { openBillingPortal } from "@/app/account/billing-actions";
import { priceLabel, PRODUCT_LABEL, shortDay, TRIAL_DAYS, type SubscriptionRow } from "@/lib/billing";
import { billingConfigured, priceLiveAt } from "@/lib/entitlements";
import { ADVISOR_NAME } from "@/lib/planner/advisor";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * The account page's Advisor row (specs/product/advisor.md "2. The trial": "Advisor · trial ends {date} · Cancel"):
 * the subscriptions this person holds, each with its state, its date, Cancel or Keep, and the billing portal for the
 * card and invoices. Nothing while billing isn't live, so the page is unchanged until then. A person covered by someone
 * else's plan (a student under a parent's family plan) sees the line on the Advisor tab, not here: the buyer manages it.
 */
export async function AdvisorSection({ userId }: { userId: string }) {
  if (!billingConfigured() || (await priceLiveAt()) === null) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("subscriptions").select("*").eq("user_id", userId).order("updated", { ascending: false });
  const rows = ((data ?? []) as SubscriptionRow[]).filter((r) => r.status !== "incomplete" && r.status !== "incomplete_expired");
  const now = new Date();

  return (
    <AccountSection id="advisor" title={ADVISOR_NAME} description={rows.length ? "Your subscription, its dates, and the billing portal for your card and invoices." : `The whole advisor, ${TRIAL_DAYS} days free with your card on file.`}>
      {rows.length === 0 ? (
        <Link href="/advisor/start" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Start your {TRIAL_DAYS}-day free trial
        </Link>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-semibold">
                  {PRODUCT_LABEL[r.product]} · {stateLine(r, now)}
                </p>
                <p className="text-xs text-muted-foreground">{priceLabel(r.product, r.price_variant)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(r.status === "trialing" || r.status === "active" || r.status === "past_due") && <CancelControl subscriptionId={r.id} cancelled={r.cancel_at_period_end} trialing={r.status === "trialing"} />}
                {(r.status === "canceled" || r.status === "unpaid") && (
                  <Link href="/advisor/start" className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
                    Subscribe again
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <form action={openBillingPortal} className="mt-3">
          <button type="submit" className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
            Card, invoices, and receipts
          </button>
        </form>
      )}
    </AccountSection>
  );
}

/** "trial ends Nov 28", "renews Nov 28, 2027", "ends Nov 28", "lapsed". */
function stateLine(r: SubscriptionRow, now: Date): string {
  if (r.status === "trialing" && r.trial_end) return r.cancel_at_period_end ? `trial ends ${shortDay(r.trial_end, now)}, then nothing is charged` : `trial ends ${shortDay(r.trial_end, now)}`;
  if ((r.status === "active" || r.status === "past_due") && r.current_period_end) return r.cancel_at_period_end ? `ends ${shortDay(r.current_period_end, now)}` : `renews ${shortDay(r.current_period_end, now)}`;
  if (r.status === "past_due") return "payment didn't go through; Stripe is retrying";
  if (r.status === "canceled" || r.status === "unpaid") return "lapsed, read-only";
  return r.status;
}
