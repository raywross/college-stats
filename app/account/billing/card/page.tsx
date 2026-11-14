import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CreditCard } from "lucide-react";
import { startCardSetup } from "@/app/account/billing-actions";
import { safeNextPath } from "@/lib/accounts";
import { authConfigured, requireUser } from "@/lib/auth";
import { priceLabel, TRIAL_DAYS } from "@/lib/billing";
import { billingService, cardOnFile } from "@/lib/billing-server";
import { priceLive } from "@/lib/entitlements";
import { ADVISOR_NAME } from "@/lib/planner/advisor";

export const metadata: Metadata = { title: "Your card", robots: { index: false } };

/**
 * /account/billing/card (specs/product/commercialization.md "Billing"): the household's card, saved once. A parent lands
 * here from Household when they add a student with no card on file, and from the account page to add or change it.
 * `?next=` says where to go after Stripe; `?cancelled=1` is the way back from a Checkout left unfinished.
 */
export default async function CardPage({ searchParams }: { searchParams: Promise<{ next?: string; cancelled?: string }> }) {
  await connection();
  if (!authConfigured()) redirect("/account");
  const user = await requireUser("/account/billing/card");
  const { next: nextParam, cancelled } = await searchParams;
  const next = safeNextPath(nextParam, "/account#advisor");
  if (!(await priceLive())) redirect(next);
  const card = await cardOnFile(billingService(), user.id);
  const fromHousehold = next.startsWith("/household");

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">{ADVISOR_NAME}</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{card ? "Change the card on file" : fromHousehold ? "A card before the first student" : "Add a card"}</h1>
      </header>
      {cancelled === "1" && (
        <p role="status" className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing was saved. Whenever you&apos;re ready.
        </p>
      )}
      <p className="text-muted-foreground">
        One card for the household, entered once. Each student you add gets {ADVISOR_NAME} for {TRIAL_DAYS} days free, then {priceLabel("student")} charged to it; cancel any
        student&apos;s subscription from your account page. Nothing is charged for saving the card.
      </p>
      {card && (
        <p className="text-sm">
          On file: {card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : "a card"} ending {card.last4 ?? "····"}.
        </p>
      )}
      <form action={startCardSetup} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground">
          <CreditCard className="size-4" aria-hidden />
          {card ? "Use a different card" : "Add a card"}
        </button>
        <Link href={next} className="text-sm font-semibold text-primary hover:underline">
          {fromHousehold ? "Back to Household" : "Back"}
        </Link>
      </form>
      <p className="text-xs text-muted-foreground">Payment is handled by Stripe; Quad never sees your card, only its brand and last four digits.</p>
    </div>
  );
}
