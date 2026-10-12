"use client";

import { useState } from "react";
import { Heart, Info } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { RowDrawer } from "@/components/planner/RowDrawer";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * One college on the list (specs/planner/redesign/list.md "The row"): the Dream heart, the crest and name, and (i)
 * for the row's capture panel (RowDrawer). The level is the section heading above the row. Round, deadline, and status
 * left the row on 2026-10-12 (owner: "there for seniors; remove for now", to return with recommendations); the data
 * and the calendar's use of it are unchanged. The ×  to remove a college lives in the panel. Every tap is optimistic
 * (the parent, PlanList, patches its own state and rolls back on a refused write).
 */
export function PlanRow({
  row,
  ctx,
  dreamName,
  error,
  onToggleDream,
  onRemove,
}: {
  row: PlanRowView;
  ctx: PlanContext;
  /** The current Dream's name, when it's a different college (for the swap confirmation). */
  dreamName: string | null;
  /** A refused write's message, shown under the row until the next tap. */
  error?: string | null;
  onToggleDream: (row: PlanRowView) => void;
  /** Takes the college off the list (after the panel's own confirmation). */
  onRemove: (row: PlanRowView) => void;
}) {
  const [open, setOpen] = useState(false);
  const { item, school } = row;
  const name = school?.name ?? item.unit_id;
  const canEdit = ctx.viewer.canEdit;

  return (
    <li>
      <div className="flex items-center gap-2 p-3 sm:px-4">
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

        <div className="min-w-0 flex-1">
          <CollegeChip school={school ? { unit_id: school.unit_id, name: school.name, brand: school.brand } : null} size="sm" link />
          {row.dream && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">Dream</p>}
        </div>

        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) track("plan_drawer_opened", { in_season: row.seasonStatus !== null });
          }}
          aria-expanded={open}
          aria-label={`Details for ${name}`}
          title="Legacy, recruiting, visits, and follows"
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted", open && "bg-muted text-foreground")}
        >
          <Info className="size-4" aria-hidden />
        </button>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-destructive sm:px-16">{error}</p>}
      {open && <RowDrawer row={row} ctx={ctx} name={name} onRemove={() => onRemove(row)} />}
    </li>
  );
}
