"use client";

import { useSearchParams } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/list-rules";
import type { PlanNotice, PlanView } from "@/lib/planner/plan-view";
import { dayLabel } from "@/lib/planner/list-row";
import { TEST_LABEL } from "@/lib/planner/standing";
import { Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * One notice's content and action (specs/planner/redesign/list.md "Around the list"): a conflict box, the ED II
 * offer, the balance line, or the retake card — one sentence, one button, per the rules kept in README.md. Used by
 * `PlanNotice` (components/planner/PlanNotice.tsx) for `view.notices[0]`, the plan's only notice now; `kind` must be
 * one `view.notices` actually carries (the caller checks that), so this only renders, it never decides what shows.
 */
export function ListNotices({
  view,
  kind,
  onUseEdTwo,
  edTwoPending,
  className,
}: {
  view: PlanView;
  kind: PlanNotice;
  onUseEdTwo: (itemId: string) => void;
  edTwoPending: boolean;
  className?: string;
}) {
  const searchParams = useSearchParams();

  const scoresHref = (() => {
    const p = new URLSearchParams(searchParams);
    p.set("tab", "scores");
    return `?${p.toString()}`;
  })();

  if (kind === "problems" && view.problems.length > 0) {
    return (
      <div role="status" className={cn("rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40", className)}>
        <p>{view.problems[0]}</p>
      </div>
    );
  }
  if (kind === "edTwo" && view.edTwo) {
    const { edTwo } = view;
    return (
      <p className={cn("rounded-2xl bg-muted/60 px-4 py-3 text-sm", className)}>
        <span className="font-semibold">A second early shot, if you want one:</span> {edTwo.name} has an{" "}
        <Term term="early-decision-ii">ED II</Term> round{edTwo.due ? ` (due ${dayLabel(edTwo.due)})` : ""}, after your Dream answers. It&apos;s binding too.{" "}
        <button type="button" disabled={edTwoPending} onClick={() => onUseEdTwo(edTwo.itemId)} className="font-semibold text-primary hover:underline disabled:opacity-60">
          Use ED II there
        </button>
      </p>
    );
  }
  if (kind === "balance" && view.balanceLine) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{view.balanceLine}</p>;
  }
  if (kind === "retake" && view.retake) {
    const { retake } = view;
    const single = retake.moves.length === 1 ? retake.moves[0] : null;
    const name = single ? (view.rows.find((r) => r.item.id === single.id)?.school?.name ?? "A college") : null;
    return (
      <a href={scoresHref} className={cn("flex items-start gap-3 rounded-3xl border bg-card p-4 text-left hover:bg-muted/50", className)}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pop text-pop-foreground">
          <TrendingUp className="size-5" aria-hidden />
        </span>
        <span className="text-sm">
          <span className="block font-semibold">
            {retake.delta} more {TEST_LABEL[retake.kind]} points would move{" "}
            {single ? `${name} up to ${CATEGORY_LABELS[single.to]}.` : `${retake.moves.length} colleges up a group.`}
          </span>
          <span className="text-muted-foreground">See which ones and the next test dates →</span>
        </span>
      </a>
    );
  }
  return null;
}
