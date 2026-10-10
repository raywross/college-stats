"use client";

import { useSearchParams } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/list-rules";
import type { PlanView } from "@/lib/planner/plan-view";
import { dayLabel } from "@/lib/planner/list-row";
import { TEST_LABEL } from "@/lib/planner/standing";
import { Term } from "@/components/ui/info-tip";

/**
 * The list's notices (specs/planner/redesign/list.md "Around the list"): a conflict box, the ED II offer, the
 * balance line, and the retake card, in `view.notices`' order — already capped at three
 * (lib/planner/plan-view.ts MAX_NOTICES), so this component only renders what it's given.
 */
export function ListNotices({ view, onUseEdTwo, edTwoPending }: { view: PlanView; onUseEdTwo: (itemId: string) => void; edTwoPending: boolean }) {
  const searchParams = useSearchParams();
  if (view.notices.length === 0) return null;

  const scoresHref = (() => {
    const p = new URLSearchParams(searchParams);
    p.set("tab", "scores");
    return `?${p.toString()}`;
  })();

  return (
    <div className="space-y-2">
      {view.notices.map((kind) => {
        if (kind === "problems" && view.problems.length > 0) {
          return (
            <div key="problems" role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              {view.problems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          );
        }
        if (kind === "edTwo" && view.edTwo) {
          const { edTwo } = view;
          return (
            <p key="edTwo" className="rounded-2xl bg-muted/60 px-4 py-3 text-sm">
              <span className="font-semibold">A second early shot, if you want one:</span> {edTwo.name} has an{" "}
              <Term term="early-decision-ii">ED II</Term> round{edTwo.due ? ` (due ${dayLabel(edTwo.due)})` : ""}, after your Dream answers. It&apos;s binding too.{" "}
              <button
                type="button"
                disabled={edTwoPending}
                onClick={() => onUseEdTwo(edTwo.itemId)}
                className="font-semibold text-primary hover:underline disabled:opacity-60"
              >
                Use ED II there
              </button>
            </p>
          );
        }
        if (kind === "balance" && view.balanceLine) {
          return (
            <p key="balance" className="text-sm text-muted-foreground">
              {view.balanceLine}
            </p>
          );
        }
        if (kind === "retake" && view.retake) {
          const { retake } = view;
          const single = retake.moves.length === 1 ? retake.moves[0] : null;
          const name = single ? (view.rows.find((r) => r.item.id === single.id)?.school?.name ?? "A college") : null;
          return (
            <a key="retake" href={scoresHref} className="flex items-start gap-3 rounded-3xl border bg-card p-4 text-left hover:bg-muted/50">
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
      })}
    </div>
  );
}
