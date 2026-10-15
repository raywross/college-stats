"use client";

/**
 * The ED moves' card (specs/planner/next-steps/ed-opportunities.md "Moves and timing"):
 * - `ed_decide`: "Decide on ED (due {date})", listing every ED opportunity with its round and pill wording, each opening the
 *   row's ED sheet on the Colleges tab (`?row=<id>&panel=ed`, the `open_row` action).
 * - `ed2_decide`: the one college, with **Start it in ED II** for the student (a guardian reads "{First} picks the round").
 * The date carries its ⓘ (the college's field). Nothing here is a number from the estimate; the level is the only
 * thing from it.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MetricLabel } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import { STANDING_LEVEL_LABELS } from "@/lib/chances/levels";
import { edOpportunities, edPillText } from "@/lib/planner/ed-opportunities";
import { planHref } from "@/lib/planner/plan-tabs";
import { startEd } from "@/lib/planner/store-ed";
import { taskDateLabel } from "@/lib/planner/tasks";
import type { AnyCited } from "@/lib/lineage";
import type { MoveCardProps } from "./types";

/** The Colleges tab with a row's drawer open on its ED sheet. */
export function edRowHref(person: string | null | undefined, itemId: string): string {
  return `${planHref({ person: person ?? null, tab: "colleges" })}&row=${encodeURIComponent(itemId)}&panel=ed`;
}

export function EdDecideCard({ task, ctx, view, onSkip, pending }: MoveCardProps) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const date = taskDateLabel(task, ctx.today);
  const itemSchool = task.item_id ? ctx.schools[ctx.items.find((i) => i.id === task.item_id)?.unit_id ?? ""] : undefined;
  const cited = task.source_field ? ((itemSchool ?? firstSchool())?.cites[task.source_field] as AnyCited | undefined) : undefined;
  const person = ctx.student?.id ?? null;
  const isStudent = !ctx.viewer.isGuardian && ctx.viewer.canEdit;
  const first = ctx.student?.display_name?.trim().split(/\s+/)[0] || "Your student";

  function firstSchool() {
    const a = task.action;
    const itemId = a && a.kind === "open_row" ? a.itemId : null;
    const unit = ctx.items.find((i) => i.id === itemId)?.unit_id;
    return unit ? ctx.schools[unit] : undefined;
  }

  const candidates =
    task.kind === "ed_decide" ? edOpportunities(view.rows.map((r) => r.item), view.estimates, ctx.schools, { season: ctx.season, today: ctx.today }) : [];
  const nameOf = (itemId: string) => view.rows.find((r) => r.item.id === itemId)?.school?.name ?? "A college";

  const startEd2 = () => {
    if (!task.item_id) return;
    setError(null);
    start(async () => {
      const r = await startEd(task.item_id!, "ed2");
      if (!r.ok) return setError(r.message);
      track("plan_ed_started", { round: "ed2" });
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-semibold">{task.title}</p>
        {date && (
          <MetricLabel cited={cited} className="shrink-0 text-sm text-muted-foreground">
            <span>{date}</span>
          </MetricLabel>
        )}
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}

      {task.kind === "ed_decide" && candidates.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg ring-1 ring-border">
          {candidates.map((c) => (
            <li key={c.itemId}>
              <Link href={edRowHref(person, c.itemId)} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted">
                <span className="min-w-0 truncate font-semibold">{nameOf(c.itemId)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {edPillText(c.round, c.verdict).full} · {STANDING_LEVEL_LABELS[c.level]} for you
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {task.kind === "ed2_decide" && task.item_id && (
          <>
            {isStudent ? (
              <button type="button" disabled={busy || pending} onClick={startEd2} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
                Start it in ED II
              </button>
            ) : (
              <p className="self-center text-sm text-muted-foreground">{first} picks the round.</p>
            )}
            <Link href={edRowHref(person, task.item_id)} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary hover:underline">
              The facts
            </Link>
          </>
        )}
        {ctx.viewer.canEdit && (
          <button type="button" disabled={busy || pending} onClick={() => onSkip(task)} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border disabled:opacity-60">
            Not now
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default EdDecideCard;
