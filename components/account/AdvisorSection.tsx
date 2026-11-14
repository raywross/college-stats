import Link from "next/link";
import { AccountSection } from "@/components/account/AccountSection";
import { CancelControl } from "@/components/account/CancelControl";
import { openBillingPortal } from "@/app/account/billing-actions";
import { priceLabel, shortDay, TRIAL_DAYS, type SubscriptionRow } from "@/lib/billing";
import { billingService, cardOnFile } from "@/lib/billing-server";
import { billingConfigured, priceLiveAt } from "@/lib/entitlements";
import { ADVISOR_NAME } from "@/lib/planner/advisor";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * The account page's Advisor row (specs/product/advisor.md "2. The trial"; commercialization.md "Billing"): the card
 * on file (a parent's household card, or a student's own), each subscription this person pays for with its state, its
 * date, Cancel or Keep, and the billing portal for invoices and receipts. Nothing while billing isn't live, so the page
 * is unchanged until then. A student paid for by a parent sees the line on the Advisor tab, not here: the payer manages it.
 */
export async function AdvisorSection({ userId, isGuardian }: { userId: string; isGuardian: boolean }) {
  if (!billingConfigured() || (await priceLiveAt()) === null) return null;
  const supabase = await createServerSupabase();
  const [{ data }, card, names] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", userId).order("updated", { ascending: false }),
    cardOnFile(billingService(), userId),
    supabase.from("students").select("id, display_name, user_id").is("deleted_at", null),
  ]);
  const rows = ((data ?? []) as SubscriptionRow[]).filter((r) => r.status !== "incomplete" && r.status !== "incomplete_expired");
  const nameOf = new Map(((names.data ?? []) as { id: string; display_name: string | null; user_id: string | null }[]).map((s) => [s.id, s.user_id === userId ? "You" : (s.display_name?.trim() || "A student")]));
  const now = new Date();
  const cardWords = card ? `${card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : "A card"} ending ${card.last4 ?? "····"}` : null;

  return (
    <AccountSection
      id="advisor"
      title={ADVISOR_NAME}
      description={isGuardian ? `One card for the household; each student you add is ${priceLabel("student")} after ${TRIAL_DAYS} days free.` : `${priceLabel("student")} after your ${TRIAL_DAYS}-day trial.`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm">
          <p>
            <span className="font-semibold">Card on file:</span> {cardWords ?? "none yet"}
          </p>
          <Link href="/account/billing/card" className="inline-flex h-9 items-center rounded-full border px-4 text-xs font-semibold hover:bg-muted">
            {card ? "Change" : "Add a card"}
          </Link>
        </div>

        {rows.length === 0 ? (
          <Link href="/advisor/start" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Keep the advisor past the trial
          </Link>
        ) : (
          <ul className="divide-y rounded-2xl border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-semibold">
                    {r.covers_student_id ? nameOf.get(r.covers_student_id) ?? "A student" : "Advisor"} · {stateLine(r, now)}
                  </p>
                  <p className="text-xs text-muted-foreground">{priceLabel("student", r.price_variant)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(r.status === "trialing" || r.status === "active" || r.status === "past_due") && <CancelControl subscriptionId={r.id} cancelled={r.cancel_at_period_end} trialing={r.status === "trialing"} />}
                  {(r.status === "canceled" || r.status === "unpaid") && r.covers_student_id && (
                    <Link href={`/advisor/start?for=${encodeURIComponent(r.covers_student_id)}`} className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
                      Subscribe again
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {(rows.length > 0 || card) && (
          <form action={openBillingPortal}>
            <button type="submit" className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
              Invoices and receipts
            </button>
          </form>
        )}
      </div>
    </AccountSection>
  );
}

/** "trial ends Nov 28", "renews Nov 28, 2027", "ends Nov 28", "lapsed". */
function stateLine(r: SubscriptionRow, now: Date): string {
  if (r.status === "trialing" && r.trial_end) return r.cancel_at_period_end ? `trial ends ${shortDay(r.trial_end, now)}, then nothing is charged` : `trial ends ${shortDay(r.trial_end, now)}, then charged`;
  if ((r.status === "active" || r.status === "past_due") && r.current_period_end) return r.cancel_at_period_end ? `ends ${shortDay(r.current_period_end, now)}` : `renews ${shortDay(r.current_period_end, now)}`;
  if (r.status === "past_due") return "payment didn't go through; Stripe is retrying";
  if (r.status === "canceled" || r.status === "unpaid") return "lapsed, read-only";
  return r.status;
}
