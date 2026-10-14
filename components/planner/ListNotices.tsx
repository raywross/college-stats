"use client";

import { TrendingUp } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/list-rules";
import type { PlanNotice, PlanView } from "@/lib/planner/plan-view";
import { TEST_LABEL } from "@/lib/planner/standing";
import { cn } from "@/lib/utils";

/**
 * One notice's content (specs/planner/redesign/list.md "Around the list"): a conflict box, the balance line, or the
 * retake card — one sentence each, per the rules kept in README.md. The ED II offer and "ED would help most" lines
 * became the Good ED opportunity pills (specs/planner/next-steps/ed-opportunities.md). Used by
 * `PlanNotice` (components/planner/PlanNotice.tsx) for `view.notices[0]`, the plan's only notice now; `kind` must be
 * one `view.notices` actually carries (the caller checks that), so this only renders, it never decides what shows.
 */
export function ListNotices({
  view,
  kind,
  className,
}: {
  view: PlanView;
  kind: PlanNotice;
  className?: string;
}) {
  if (kind === "problems" && view.problems.length > 0) {
    return (
      <div role="status" className={cn("rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40", className)}>
        <p>{view.problems[0]}</p>
      </div>
    );
  }
  if (kind === "balance" && view.balanceLine) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{view.balanceLine}</p>;
  }
  if (kind === "retake" && view.retake) {
    const { retake } = view;
    const single = retake.moves.length === 1 ? retake.moves[0] : null;
    const name = single ? (view.rows.find((r) => r.item.id === single.id)?.school?.name ?? "A college") : null;
    const others = retake.moves.map((m) => view.rows.find((r) => r.item.id === m.id)?.school?.name ?? "A college").join(", ");
    return (
      // A notice, not a link: the Scores tab it opened is gone (owner, 2026-10-12), so it names the colleges itself.
      <div className={cn("flex items-start gap-3 rounded-3xl border bg-card p-4 text-left", className)}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pop text-pop-foreground">
          <TrendingUp className="size-5" aria-hidden />
        </span>
        <span className="text-sm">
          <span className="block font-semibold">
            {retake.delta} more {TEST_LABEL[retake.kind]} points would move{" "}
            {single ? `${name} up to ${CATEGORY_LABELS[single.to]}.` : `${retake.moves.length} colleges up a group.`}
          </span>
          {!single && <span className="text-muted-foreground">{others}</span>}
        </span>
      </div>
    );
  }
  return null;
}
