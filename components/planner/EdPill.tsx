"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { EdSheetDialog } from "@/components/planner/EdSheet";
import { edPillText, type EdCandidate, type EdVerdict } from "@/lib/planner/ed-opportunities";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

/**
 * The row's ED opportunity pill (specs/planner/v3/connections.md "The row"): accent background, worded by the ED
 * verdict: "Good ED opportunity" / "Good ED II opportunity" where early decision moves the college up a level
 * (`helps`), "ED opportunity" / "ED II opportunity" otherwise ("ED" / "ED II" on a phone, the full text as its
 * accessible label). At most three across the list (owner, 2026-10-15). Tapping opens the ED sheet as a dialog
 * (`EdSheetDialog`, `components/planner/EdSheet.tsx`); `openInitially` opens it on mount (a move's `open_row` link,
 * `?row=<id>&panel=ed`, read once by `PlanList.tsx`). Never a number: the verdict, level, and closeness only decide
 * which rows get one and in what order.
 */
export function EdPill({
  row,
  ctx,
  candidate,
  verdict = candidate.verdict,
  openInitially = false,
  className,
}: {
  row: PlanRowView;
  ctx: PlanContext;
  candidate: EdCandidate;
  verdict?: EdVerdict | undefined;
  /** Opens the dialog on mount, once (a move's `open_row?panel=ed` link). */
  openInitially?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(openInitially);
  const text = edPillText(candidate.round, verdict);
  const { round, level, rank } = candidate;
  useEffect(() => {
    track("plan_ed_pill_shown", { round, level, rank });
  }, [round, level, rank]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
      <EdSheetDialog row={row} ctx={ctx} candidate={candidate} open={open} onOpenChange={setOpen} />
    </>
  );
}
