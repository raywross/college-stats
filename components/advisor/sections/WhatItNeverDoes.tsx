import Link from "next/link";
import { Ban } from "lucide-react";
import { SplashSection } from "@/components/advisor/Frame";

/** The five refusals (advisor.md "What it never does"; telemetry.md "Privacy"; commercialization.md "What stays free"). */
export const REFUSALS = ["No ads", "No leads sold to colleges", "No featured listings", "No percentage chances", "Nothing about a minor sold or shared"] as const;

export function WhatItNeverDoes() {
  return (
    <SplashSection
      id="what-it-never-does"
      title="What it never does"
      line={
        <>
          The rules Quad keeps, in its{" "}
          <Link href="/privacy" className="font-semibold text-primary hover:underline">
            privacy policy
          </Link>{" "}
          too.
        </>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {REFUSALS.map((r, i) => (
          <li key={r} className="splash-pop flex min-h-12 animate-pop-in items-center gap-3 rounded-2xl border bg-card px-4 py-2 font-semibold" style={{ animationDelay: `${i * 70}ms` }}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-pop text-pop-foreground" aria-hidden>
              <Ban className="size-4" />
            </span>
            {r}
          </li>
        ))}
      </ul>
    </SplashSection>
  );
}
