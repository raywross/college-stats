"use client";

import { cn } from "@/lib/utils";

/**
 * The row's "Interest counts here" pill (specs/planner/next-steps/interest-and-visits.md "The pill"): muted accent
 * (softer than the ED pill's solid one, EdPill.tsx), shown on a row with an open interest move and no ED pill
 * (PlanList.tsx's "else the interest pill" branch owns the one-pill-per-row rule). Tapping opens the row's details
 * at the capture panel, with the move's why above the chips (RowDrawer.tsx, `openPanel="capture"`). Never a number:
 * the rule that gave the row a move already decided that, from the level and the college's own C7 answer.
 */
export function InterestPill({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const full = "Interest counts here";
  const short = "Interest";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={full}
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
    </button>
  );
}
