"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Heart } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { RowDrawer, type RowPanel } from "@/components/planner/RowDrawer";
import type { EdCandidate } from "@/lib/planner/ed-opportunities";
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
 *
 * Next steps (ed-opportunities.md "The pill"; build-plan.md U2): at most one pill per row, right-aligned before the
 * Details control. `pill` is a render prop (RowPill) given the function that opens the drawer on a panel, so the
 * pill's tap opens the details with its sheet on top: the Good ED opportunity pill first, else (U3) the interest pill.
 * `openPanel` opens the drawer on that panel at first render (a move's `open_row` link: `?row=<id>&panel=ed`).
 */
/** The row's one pill, rendered with the function that opens the drawer on a panel (ED sheet, capture). */
export type RowPill = (open: (panel: RowPanel) => void) => ReactNode;

export function PlanRow({
  row,
  ctx,
  dreamName,
  error,
  status,
  onToggleDream,
  onRemove,
  pill,
  openPanel,
  edCandidate,
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
   * any pill (U2 owns that slot in this same file). Null before senior fall.
   */
  status?: string | null;
  onToggleDream: (row: PlanRowView) => void;
  /** Takes the college off the list (after the panel's own confirmation). */
  onRemove: (row: PlanRowView) => void;
  /** The row's one pill (at most one per row; the ED pill first). */
  pill?: RowPill;
  /** Open the drawer on this panel at first render. */
  openPanel?: RowPanel | null;
  /** The row's Good ED opportunity, when it has one (the drawer's ED sheet reads it). */
  edCandidate?: EdCandidate | null;
}) {
  const [open, setOpen] = useState(!!openPanel);
  const [panel, setPanel] = useState<RowPanel | null>(openPanel ?? null);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (openPanel) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [openPanel]);
  const openOn = (p: RowPanel) => {
    setPanel(p);
    if (!open) track("plan_drawer_opened", { in_season: row.seasonStatus !== null });
    setOpen(true);
  };
  const { item, school } = row;
  const name = school?.name ?? item.unit_id;
  const canEdit = ctx.viewer.canEdit;
  // What's left to capture here (lib/planner/capture.ts rowToDo): an accent and a count on the control, never a nag.
  const todo = rowToDo(item, ctx.visits, school?.social as Partial<Record<SocialNetwork, string>> | null | undefined);

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

        {pill?.(openOn)}
        {/* After any pill (U2's slot, same file): the row's muted, read-only status word, senior fall on. */}
        {status && <span className="shrink-0 text-xs font-medium text-muted-foreground">{status}</span>}

        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) {
              setPanel(null);
              track("plan_drawer_opened", { in_season: row.seasonStatus !== null });
            }
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
      {open && <RowDrawer row={row} ctx={ctx} name={name} onRemove={() => onRemove(row)} panel={panel} edCandidate={edCandidate ?? null} onPanel={setPanel} />}
    </li>
  );
}
