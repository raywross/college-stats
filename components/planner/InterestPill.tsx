"use client";

import Link from "next/link";
import { guideHref } from "@/lib/planner/guides";
import { cn } from "@/lib/utils";

/**
 * The row's "Interest counts here" pill (specs/planner/v3/connections.md "The row"): muted accent (softer than the
 * ED pill's solid one, EdPill.tsx), shown on a row with an open interest move and no ED pill (PlanList.tsx's "else
 * the interest pill" branch owns the one-pill-per-row rule). A link to the Show interest guide for this college
 * (`guideHref("interest", …)`), not a drawer any more. Never a number: the rule that gave the row a move already
 * decided that, from the level and the college's own C7 answer.
 */
export function InterestPill({ collegeUnitId, name, person, className }: { collegeUnitId: string; name: string; person: string | null; className?: string }) {
  const full = "Interest counts here";
  const short = "Interest";
  const label = `Interest counts here: show ${name} you're interested`;
  return (
    <Link
      href={guideHref("interest", { college: collegeUnitId, person, from: "pill" })}
      aria-label={label}
      title={full}
      className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}
    >
      <span className="inline-flex h-7 items-center rounded-full bg-accent/20 px-2.5 text-xs font-bold whitespace-nowrap text-foreground">
        <span className="sm:hidden" aria-hidden>
          {short}
        </span>
        <span className="hidden sm:inline" aria-hidden>
          {full}
        </span>
      </span>
    </Link>
  );
}
