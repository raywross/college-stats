"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { ED_PILL_TEXT, type EdCandidate } from "@/lib/planner/ed-opportunities";
import { cn } from "@/lib/utils";

/**
 * The row's Good ED opportunity pill (specs/planner/next-steps/ed-opportunities.md "The pill"): accent background,
 * "Good ED opportunity" or "Good ED II opportunity" ("ED" / "ED II" on a phone, the full text as its accessible
 * label). At most three on a list (edOpportunities caps them). Tapping opens the row's details with the ED sheet on
 * top. Never a number: the level and closeness only decide which rows get one.
 */
export function EdPill({ candidate, onOpen, className }: { candidate: EdCandidate; onOpen: () => void; className?: string }) {
  const text = ED_PILL_TEXT[candidate.round];
  const { round, level, rank } = candidate;
  useEffect(() => {
    track("plan_ed_pill_shown", { round, level, rank });
  }, [round, level, rank]);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={text.full}
      title={text.full}
      className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}
    >
      <span className="inline-flex h-7 items-center rounded-full bg-accent px-2.5 text-xs font-bold whitespace-nowrap text-accent-foreground">
        <span className="sm:hidden" aria-hidden>
          {text.short}
        </span>
        <span className="hidden sm:inline" aria-hidden>
          {text.full}
        </span>
      </span>
    </button>
  );
}
