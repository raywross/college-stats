"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { edPillText, type EdCandidate, type EdVerdict } from "@/lib/planner/ed-opportunities";
import { cn } from "@/lib/utils";

/**
 * The row's ED opportunity pill (specs/planner/next-steps/ed-opportunities.md "The pill"): accent background, worded
 * by the ED verdict: "Good ED opportunity" / "Good ED II opportunity" where early decision moves the college up a
 * level (`helps`), "ED opportunity" / "ED II opportunity" otherwise ("ED" / "ED II" on a phone, the full text as its
 * accessible label). At most three across the list (owner, 2026-10-15). Tapping opens the row's details with the ED sheet on top.
 * Never a number: the verdict, level, and closeness only decide which rows get one and in what order.
 */
export function EdPill({ candidate, verdict = candidate.verdict, onOpen, className }: { candidate: EdCandidate; verdict?: EdVerdict | undefined; onOpen: () => void; className?: string }) {
  const text = edPillText(candidate.round, verdict);
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
