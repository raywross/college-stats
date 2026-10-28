import Link from "next/link";
import type { ReactNode } from "react";
import { SplashSection } from "@/components/advisor/Frame";

/**
 * Questions (advisor.md "3. The page", Questions), as a `<details>` list. The trial, card, cancel, and lapse questions
 * wait for the trial (build order step 3); these four hold today.
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

export function Questions() {
  return (
    <SplashSection id="questions" title="Questions" line="The short answers.">
      <div className="divide-y overflow-hidden rounded-3xl border bg-card">
        {QUESTIONS.map(({ q, a }) => (
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
