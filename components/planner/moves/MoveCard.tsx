"use client";

/**
 * The default move card (specs/planner/next-steps/seasons.md "The Next steps tab"). STUB written by U1 Foundation:
 * the title, the why, the date or "this season", and the two buttons as plain controls. U1b replaces it with the full
 * card (the action button, the assignee chip, Done folding with undo, citations).
 */
import { taskDateLabel } from "@/lib/planner/tasks";
import type { MoveCardProps } from "./types";

export function MoveCard({ task, ctx, onDone, onSkip, pending }: MoveCardProps) {
  const date = taskDateLabel(task, ctx.today);
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{task.title}</p>
        <span className="shrink-0 text-sm text-muted-foreground">{date ?? "this season"}</span>
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}
      {ctx.viewer.canEdit && (
        <div className="mt-3 flex gap-2">
          <button type="button" className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background" disabled={pending} onClick={() => onDone(task)}>
            Done
          </button>
          <button type="button" className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border" disabled={pending} onClick={() => onSkip(task)}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

export default MoveCard;
