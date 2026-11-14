import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { StartForm, type StartStudentOption } from "@/components/advisor/StartForm";
import { loginHref } from "@/lib/accounts";
import { authConfigured, getUser } from "@/lib/auth";
import { MINOR_TERMS_SENTENCE, priceLabel, TRIAL_DAYS } from "@/lib/billing";
import { billingService, cardOnFile } from "@/lib/billing-server";
import { startOffer } from "@/lib/billing-start";
import { ADVISOR_NAME } from "@/lib/planner/advisor";

export const metadata: Metadata = { title: `Keep ${ADVISOR_NAME}`, robots: { index: false } };

/**
 * /advisor/start, the one sheet about money (specs/product/commercialization.md "Gating UX"): the price, the student the
 * subscription pays for (a choice when a parent has several), and the way to Stripe Checkout, or a one-tap charge to the
 * card already on file. Signed out: the sign-up form, back here after. While the Advisor is free (billing not live)
 * there is nothing to start, and the page says so. Any student may pay for their own advisor (owner, 2026-11-14).
 */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ for?: string; cancelled?: string }> }) {
  await connection();
  if (!authConfigured()) redirect("/advisor");
  const { for: forParam, cancelled } = await searchParams;
  const offer = await startOffer();
  if (!offer.signedIn) redirect(`${loginHref(`/advisor/start${forParam ? `?for=${encodeURIComponent(forParam)}` : ""}`)}&mode=signup`);

  const shell = (title: string, children: React.ReactNode) => (
    <div className="mx-auto max-w-3xl space-y-6 py-4 sm:py-8">
      <header>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">{ADVISOR_NAME}</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      </header>
      {children}
    </div>
  );

  if (!offer.live) {
    return shell(
      "The advisor is free right now",
      <p className="text-muted-foreground">
        Nothing to start: every account has the whole advisor while Quad is in preview.{" "}
        <Link href="/advisor" className="font-semibold text-primary hover:underline">
          Open your advisor →
        </Link>
      </p>,
    );
  }

  if (!offer.students.length) {
    return shell(
      "No student yet",
      <p className="text-muted-foreground">
        Add a student from{" "}
        <Link href="/household" className="font-semibold text-primary hover:underline">
          Household
        </Link>{" "}
        first; their {TRIAL_DAYS}-day trial starts the moment they&apos;re added.
      </p>,
    );
  }

  const user = await getUser();
  const card = user ? await cardOnFile(billingService(), user.id) : null;
  const named = offer.students.some((s) => s.studentId === forParam);
  const students: StartStudentOption[] = offer.students
    .filter((s) => !named || s.studentId === forParam)
    .map((s) => ({ studentId: s.studentId, label: s.self ? "You" : (s.name ?? "A student"), paid: s.billing.paid, trialEnd: s.billing.trialEnd }));

  return shell(
    `Keep ${ADVISOR_NAME}`,
    <>
      {cancelled === "1" && (
        <p role="status" className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing was started. Whenever you&apos;re ready.
        </p>
      )}
      <p className="text-muted-foreground">
        {priceLabel("student")} per student, annual only, so the advisor runs on the school year&apos;s rhythm. A trial still running stays free to its last
        day; the first charge comes when it ends. Everything else on Quad stays free.{" "}
        <Link href="/pricing" className="font-semibold text-primary hover:underline">
          What&apos;s free and what&apos;s paid →
        </Link>
      </p>
      <StartForm students={students} card={card ? { brand: card.brand, last4: card.last4 } : null} isGuardian={offer.isGuardian} />
      <p className="text-xs text-muted-foreground">{MINOR_TERMS_SENTENCE} Payment is handled by Stripe; Quad never sees your card.</p>
    </>,
  );
}
