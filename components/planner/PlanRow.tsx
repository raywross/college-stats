"use client";

import { useState } from "react";
import { Heart, Info } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { RoundChip } from "@/components/planner/RoundChip";
import { RowDrawer } from "@/components/planner/RowDrawer";
import { SourceTip } from "@/components/ui/info-tip";
import { dayLabel, isPastDeadline, isUrgentDeadline, roundsPicked, SEASON_STATUS_LABEL } from "@/lib/planner/list-row";
import { roundDates } from "@/lib/planner/rounds";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import type { ListRound } from "@/lib/list-rules";
import type { AnyCited } from "@/lib/lineage";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * One college on the list (specs/planner/redesign/list.md "The row"): the Dream heart, the crest and name, the
 * round chip (no group chip — groups are Quad's only, shown by the section heading above), the deadline (bold
 * within a week) with its citation, the status column once the season starts (desktop), (i) for the drawer. The ×
 * to remove a college lives in the drawer now, not the row. An underclassman's row (decision 12, no round picked
 * yet) shows "Round picked senior year" instead of the round chip, deadline, and status. Every tap is optimistic
 * (the parent, PlanList, patches its own state and rolls back on a refused write).
 */
export function PlanRow({
  row,
  ctx,
  dreamName,
  error,
  onToggleDream,
  onRound,
  onRemove,
}: {
  row: PlanRowView;
  ctx: PlanContext;
  /** The current Dream's name, when it's a different college (for the swap confirmation). */
  dreamName: string | null;
  /** A refused write's message, shown under the row until the next tap. */
  error?: string | null;
  onToggleDream: (row: PlanRowView) => void;
  /** A round the student picks, or null for "Use the starting round". */
  onRound: (row: PlanRowView, round: ListRound | null) => void;
  /** Takes the college off the list (after the drawer's own confirmation). */
  onRemove: (row: PlanRowView) => void;
}) {
  const [open, setOpen] = useState(false);
  const { item, school, deadline } = row;
  const name = school?.name ?? item.unit_id;
  const past = isPastDeadline(deadline?.iso ?? null, ctx.today);
  const urgent = isUrgentDeadline(deadline?.iso ?? null, ctx.today);
  const canEdit = ctx.viewer.canEdit;
  const picked = roundsPicked(ctx.grade);

  const dates: Record<ListRound, string | null> = Object.fromEntries(
    row.pickable.map((r) => [r, school ? roundDates(school, r).closing?.iso ?? null : null]),
  ) as Record<ListRound, string | null>;
  const deadlineCite = deadline ? ((school?.cites[deadline.field] as AnyCited | undefined) ?? undefined) : undefined;

  return (
    <li>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] sm:px-4">
        <button
          type="button"
          onClick={() => {
            if (!row.dream && dreamName && !window.confirm(`Make ${name} your Dream? ${dreamName} loses the star.`)) return;
            onToggleDream(row);
          }}
          disabled={!canEdit}
          aria-pressed={row.dream}
          aria-label={row.dream ? `${name} is your Dream; tap to remove the heart` : `Mark ${name} as your Dream`}
          title={row.dream ? "Your Dream" : "Mark as Dream"}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
        >
          <Heart className={cn("size-5", row.dream && "fill-rose-500 text-rose-500")} aria-hidden />
        </button>

        <div className="min-w-0">
          <CollegeChip school={school ? { unit_id: school.unit_id, name: school.name, brand: school.brand } : null} size="sm" link />
          {row.dream && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">Dream</p>}
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:contents">
          {!picked ? (
            <span className="text-sm text-muted-foreground sm:col-span-3 sm:text-right">Round picked senior year</span>
          ) : (
            <>
              <RoundChip round={row.round} auto={row.roundAuto} pickable={row.pickable} dates={dates} canEdit={canEdit} onChange={(round) => onRound(row, round)} />
              <span className={cn("inline-flex items-center gap-1 text-sm tabular-nums", urgent ? "font-bold" : "font-semibold", past && "text-muted-foreground line-through")}>
                {deadline ? (
                  <>
                    {dayLabel(deadline.iso)}
                    {deadlineCite && <SourceTip cited={deadlineCite} />}
                  </>
                ) : (
                  <span className="text-xs font-normal text-muted-foreground">no date on record</span>
                )}
              </span>
              <span className="hidden text-sm text-muted-foreground lg:inline-flex lg:w-28">{row.seasonStatus !== null ? SEASON_STATUS_LABEL[row.seasonStatus] : null}</span>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next) track("plan_drawer_opened", { in_season: row.seasonStatus !== null });
            }}
            aria-expanded={open}
            aria-label={`Details for ${name}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <Info className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-destructive sm:px-16">{error}</p>}
      {open && <RowDrawer row={row} ctx={ctx} name={name} onUseStartingRound={() => onRound(row, null)} onRemove={() => onRemove(row)} />}
    </li>
  );
}
