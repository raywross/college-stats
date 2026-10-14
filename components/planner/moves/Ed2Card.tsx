"use client";

/**
 * "ED II at {College}, if you want it" (specs/planner/next-steps/applying.md "The moves"; the built `ed2_conditional`
 * row, generators/college.ts): the college's own title and detail (already says whether ED I said yes), with
 * "Start it in ED II" setting the round (setPlanRound, built). U2's `ed_decide` is the earlier, unconditional move;
 * this is the one on a recorded deferral or denial.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MetricLabel } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { track } from "@/lib/analytics";
import { setPlanRound } from "@/lib/planner/store-plan";
import { taskDateLabel } from "@/lib/planner/tasks";
import type { MoveCardProps } from "./types";

export function Ed2Card({ task, ctx, onSkip, pending: skipPending }: MoveCardProps) {
  const item = ctx.items.find((i) => i.id === task.item_id) ?? null;
  const school = item ? ctx.schools[item.unit_id] : null;
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!item || !school) return null;
  const date = taskDateLabel(task, ctx.today);
  const cited = (task.source_field ? school.cites[task.source_field] : undefined) as AnyCited | undefined;
  const already = started || item.round === "ed2";

  const start = () =>
    startTransition(async () => {
      const r = await setPlanRound(item.id, "ed2");
      if (!r.ok) return;
      setStarted(true);
      track("plan_ed_started", { round: "ed2" });
      router.refresh();
    });

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">
          <MetricLabel cited={cited}>{task.title}</MetricLabel>
        </p>
        {date && <span className="shrink-0 text-sm text-muted-foreground">{date}</span>}
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}
      {ctx.viewer.canEdit && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending || already}
            onClick={start}
            className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60"
          >
            {already ? "Started in ED II" : "Start it in ED II"}
          </button>
          <button type="button" disabled={pending || skipPending} onClick={() => onSkip(task)} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border">
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

export default Ed2Card;
