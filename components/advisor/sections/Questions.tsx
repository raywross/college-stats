import Link from "next/link";
import type { ReactNode } from "react";
import { SplashSection } from "@/components/advisor/Frame";
import { priceLabel, SELF_PAY_AGE, TRIAL_DAYS } from "@/lib/billing";

/**
 * Questions (advisor.md "3. The page", Questions), as a `<details>` list. Four hold while Quad is in preview; once the
 * price is live (build order step 3) the trial, card, cancel, family-price, and lapse questions join them.
 */
export const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "What stays free?",
    a: (
      <>
        Every college&apos;s page, Explore, Compare, the data, and the glossary, for everyone, signed out. While Quad is in preview, your advisor is free too.
      </>
    ),
  },
  {
    q: "I'm under 16. Can I use it?",
    a: <>Yes. Anyone 13 or older can make an account, and a parent can set one up from Household and invite you to it.</>,
  },
  {
    q: "How does it work for a family?",
    a: <>One household holds every child. Parents see the same advisor the student does, and a parent with edit access can mark a move done or skip it.</>,
  },
  {
    q: "What happens to my data?",
    a: (
      <>
        It&apos;s yours: download or delete everything from your account any time. Nothing about a student is sold or shared.{" "}
        <Link href="/privacy" className="font-semibold text-primary hover:underline">
          Privacy policy
        </Link>
      </>
    ),
  },
];

/** The questions once the trial is live (advisor.md "Questions": trial, card, cancel, what stays free, under 16, the family price, lapsing). */
export const TRIAL_QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "How does the free trial work?",
    a: <>{TRIAL_DAYS} days, the whole advisor, with your card on file. Cancel before it ends and nothing is charged. After that it&apos;s {priceLabel("student")} for one student or {priceLabel("family")} for the whole family, annual only.</>,
  },
  {
    q: "Why a card up front?",
    a: <>So the advisor carries on without a gap when the trial ends. Payment is handled by Stripe; Quad never sees your card. One trial per student.</>,
  },
  {
    q: "How do I cancel?",
    a: <>From your account page, any time, in one tap; a trial cancelled early still runs to its end. Everything you entered stays.</>,
  },
  {
    q: "What stays free?",
    a: <>Every college&apos;s page, Explore, Compare, the data, the glossary, your account, your record, and Quad&apos;s estimate on every college page. The advisor is what&apos;s built on them.</>,
  },
  {
    q: `I'm under ${SELF_PAY_AGE}. Can I use it?`,
    a: <>Yes. Anyone 13 or older can make an account. A parent starts the trial for a student under {SELF_PAY_AGE}; at {SELF_PAY_AGE} or older you can start it yourself, with a parent&apos;s okay.</>,
  },
  {
    q: "What does the family price cover?",
    a: <>Every student in your households, now and added later, for {priceLabel("family")}. Parents see the same advisor the student does.</>,
  },
  {
    q: "What happens if I stop paying?",
    a: <>The advisor turns read-only: the list, its levels, the calendar, and the offers stay; the guides, the changes, the texts, and the alerts stop. Nothing is deleted, and subscribing again restores everything.</>,
  },
  QUESTIONS[3],
];

export function Questions({ live = false }: { live?: boolean }) {
  const list = live ? TRIAL_QUESTIONS : QUESTIONS;
  return (
    <SplashSection id="questions" title="Questions" line="The short answers.">
      <div className="divide-y overflow-hidden rounded-3xl border bg-card">
        {list.map(({ q, a }) => (
          <details key={q} className="group px-4 sm:px-5">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
              {q}
              <span aria-hidden className="text-muted-foreground transition group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-4 text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </SplashSection>
  );
}
