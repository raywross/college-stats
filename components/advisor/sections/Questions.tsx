import Link from "next/link";
import type { ReactNode } from "react";
import { SplashSection } from "@/components/advisor/Frame";
import { priceLabel, TRIAL_DAYS } from "@/lib/billing";

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

/** The questions once the price is live (advisor.md "Questions": the trial, the card, cancelling, what stays free, students and parents, lapsing). */
export const TRIAL_QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "How does the free trial work?",
    a: <>Create an account and the whole advisor is yours for {TRIAL_DAYS} days, no card needed. After that it&apos;s {priceLabel("student")} per student, annual only. Do nothing and nothing is charged.</>,
  },
  {
    q: "When do I pay?",
    a: <>Add a card any time during the trial and the year starts when the trial ends, without a gap. Payment is handled by Stripe; Quad never sees your card.</>,
  },
  {
    q: "How do I cancel?",
    a: <>From your account page, any time, in one tap. A subscription cancelled runs to the end of what&apos;s paid. Everything you entered stays.</>,
  },
  {
    q: "What stays free?",
    a: <>Every college&apos;s page, Explore, Compare, the data, the glossary, your account, your record, and Quad&apos;s estimate on every college page. The advisor is what&apos;s built on them.</>,
  },
  {
    q: "Who pays, the student or the parent?",
    a: <>Either. A student can start their own trial and pay for their own advisor. A parent keeps one card for the household and pays for each student they add, {priceLabel("student")} each. Parents and counselors never pay for their own accounts.</>,
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
