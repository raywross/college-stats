"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Heart, Trash2 } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

/**
 * One college on the list (specs/planner/v3/connections.md "The row"): the Dream heart, the crest and name, at most
 * one pill, the senior status word, and a trash icon that removes the college (after a confirmation). No expand
 * control any more — the row's old capture panel is gone; visits, information requests, and follows live in the Show
 * interest guide, and legacy/sibling/recruiting live in the profile's Connections step (U2a). The
 * ED pill opens the ED sheet as a dialog (PlanList.tsx `?row=&panel=ed`); the interest pill links to the Show
 * interest guide. Every tap is optimistic (the parent, PlanList, patches its own state and rolls back on a refused
 * write). `openEdDialog` scrolls this row into view and opens its ED dialog when the plan loaded with `?row=<id>`.
 */
/** The row's one pill: a plain node now (not a render prop — there's no drawer left for it to open). */
export type RowPill = ReactNode;

export function PlanRow({
  row,
  ctx,
  dreamName,
  error,
  status,
  onToggleDream,
  onRemove,
  pill,
  openEdDialog,
}: {
  row: PlanRowView;
  ctx: PlanContext;
  /** The current Dream's name, when it's a different college (for the swap confirmation). */
  dreamName: string | null;
  /** A refused write's message, shown under the row until the next tap. */
  error?: string | null;
  /**
   * Next steps (applying.md "On the list row"): the row's muted status word from senior fall (Not started · Working
   * on it · Submitted · Decision), read-only here — the Submit/Decision move cards are where it changes. Shown after
   * the pill. Null before senior fall.
   */
  status?: string | null;
  onToggleDream: (row: PlanRowView) => void;
  /** Takes the college off the list, after `window.confirm`. */
  onRemove: (row: PlanRowView) => void;
  /** The row's one pill (at most one per row; the ED pill first). */
  pill?: RowPill;
  /** True when the plan loaded with this row's id in `?row=` (the ED dialog opens on mount; the row scrolls into view). */
  openEdDialog?: boolean;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (openEdDialog) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [openEdDialog]);
  const { item, school } = row;
  const name = school?.name ?? item.unit_id;
  const canEdit = ctx.viewer.canEdit;

  return (
    <li ref={ref} id={`row-${item.id}`} className="scroll-mt-24">
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

        {pill}
        {status && <span className="shrink-0 text-xs font-medium text-muted-foreground">{status}</span>}

        {canEdit && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove ${name} from the list? Its notes, visits, and any offer go with it.`)) onRemove(row);
            }}
            aria-label={`Remove ${name} from the list`}
            title="Remove from the list"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {error && <p className="px-4 pb-2 text-xs text-destructive sm:px-16">{error}</p>}
    </li>
  );
}
