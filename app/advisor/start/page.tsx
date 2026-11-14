import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { StartForm, type StartCard, type StartStudentOption } from "@/components/advisor/StartForm";
import { loginHref } from "@/lib/accounts";
import { authConfigured } from "@/lib/auth";
import { priceLabel, SELF_PAY_AGE, TRIAL_DAYS } from "@/lib/billing";
import { startOffer } from "@/lib/billing-start";
import { ADVISOR_NAME } from "@/lib/planner/advisor";

export const metadata: Metadata = { title: `Start ${ADVISOR_NAME}`, robots: { index: false } };

/**
 * /advisor/start, the upgrade sheet (specs/product/advisor.md "The button's path"; commercialization.md "Gating UX"):
 * the two prices, the student a plan covers, and the way to Stripe Checkout. Signed out: the sign-up form, back here
 * after. A student under 16: "Ask a parent" (the household's invitation). A student with no birth year: add it first.
 * While the Advisor is free (billing not live) there is nothing to start, and the page says so.
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

  if (offer.rule && !offer.rule.ok) {
    if (offer.rule.reason === "no-birth-year") {
      return shell(
        "One thing first",
        <p className="text-muted-foreground">
          Add your birth year on your account page, then come back: who can start a trial depends on it.{" "}
          <Link href="/account#profile" className="font-semibold text-primary hover:underline">
            Go to your account →
          </Link>
        </p>,
      );
    }
    return shell(
      "Ask a parent to start your trial",
      <div className="space-y-3 text-muted-foreground">
        <p>
          A parent or guardian starts the trial for a student under {SELF_PAY_AGE}. Invite one to your household and they can start it from their own account; your list and record stay yours either way.
        </p>
        <Link href="/household" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
          Invite a parent from Household →
        </Link>
      </div>,
    );
  }

  const students: StartStudentOption[] = offer.students
    .filter((s) => !forParam || s.studentId === forParam || offer.students.every((x) => x.studentId !== forParam))
    .map((s) => ({
      studentId: s.studentId,
      label: s.self ? "You" : (s.name ?? "A student"),
      covered: s.billing.whole && s.billing.because === "subscription",
      trialUsed: s.billing.trialUsed,
    }));

  const cards: StartCard[] = [
    { product: "student", title: "One student", price: priceLabel("student"), lines: ["The whole advisor for one student, through senior year", "Started by a parent, or by the student at 16 or older", `${TRIAL_DAYS} days free, card on file`] },
    ...(offer.familyOffered && !offer.familyHeld
      ? [{ product: "family" as const, title: "Family", price: priceLabel("family"), lines: ["Every student in your households, now and added later", "Parents see the same advisor the student does", `${TRIAL_DAYS} days free, card on file`] }]
      : []),
  ];

  return shell(
    `Start ${ADVISOR_NAME}`,
    <>
      {cancelled === "1" && (
        <p role="status" className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing was started. Whenever you&apos;re ready.
        </p>
      )}
      <p className="text-muted-foreground">
        Annual only, so the advisor runs on the school year&apos;s rhythm. Everything else on Quad stays free.{" "}
        <Link href="/pricing" className="font-semibold text-primary hover:underline">
          What&apos;s free and what&apos;s paid →
        </Link>
      </p>
      <StartForm cards={cards} students={students} confirmPermission={Boolean(offer.rule?.ok && offer.rule.confirmPermission)} trialDays={TRIAL_DAYS} />
    </>,
  );
}
