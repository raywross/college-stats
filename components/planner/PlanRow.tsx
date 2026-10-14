"use client";

import { useState } from "react";
import { ChevronDown, Heart } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { RowDrawer } from "@/components/planner/RowDrawer";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { track } from "@/lib/analytics";
import { rowToDo } from "@/lib/planner/capture";
import type { SocialNetwork } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One college on the list (specs/planner/redesign/list.md "The row"): the Dream heart, the crest and name, and an
 * expand control ("Details" and a chevron, aria-expanded) that opens the row's capture panel (RowDrawer) inline under
 * the row. When there's something left to capture (rowToDo) the control takes the accent color and a small count. The level is the section heading above the row. Round, deadline, and status
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
  // What's left to capture here (lib/planner/capture.ts rowToDo): an accent and a count on the control, never a nag.
  const todo = rowToDo(item, ctx.visits, school?.social as Partial<Record<SocialNetwork, string>> | null | undefined);

  return (
    <li id={`row-${item.id}`}>
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
          <CollegeChip school={school ? { unit_id: school.unit_id, name: school.name, brand: school.brand } : null} size="sm" link className="max-w-full" />
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
          aria-label={`Details for ${name}${todo.length ? `, ${todo.length === 1 ? "one thing" : "two things"} to add` : ""}`}
          className={cn(
            "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors",
            todo.length ? "bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground hover:bg-muted",
            open && !todo.length && "bg-muted text-foreground",
          )}
        >
          {todo.length > 0 && (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground" aria-hidden>
              {todo.length}
            </span>
          )}
          <span className="hidden sm:inline">Details</span>
          <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-destructive sm:px-16">{error}</p>}
      {open && <RowDrawer row={row} ctx={ctx} name={name} onRemove={() => onRemove(row)} />}
    </li>
  );
}
