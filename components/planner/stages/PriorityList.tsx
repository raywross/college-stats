"use client";

import { useState, useTransition, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Star } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { Term } from "@/components/ui/info-tip";
import { restorePriorityOrder, setPriorityOrder } from "@/lib/planner/store-rounds";
import type { PlanSchool } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

export interface PriorityRow {
  id: string;
  dream: boolean;
  school: Pick<PlanSchool, "unit_id" | "name" | "brand">;
}

/**
 * The ranking (specs/planner/early-rounds.md "Ranking"): the list in "where I'd go if admitted everywhere" order, the
 * Dream pinned first. Drag a row (mouse), or focus its handle and press the up and down arrows (keyboard), or use the
 * move buttons (touch); every move saves. A parent with edit access can reorder; the line under it says who did, and
 * "Put it back" restores the order before.
 */
export function PriorityList({
  listId,
  rows,
  canEdit,
  attribution,
}: {
  listId: string;
  rows: PriorityRow[];
  canEdit: boolean;
  attribution: { byName: string | null; canRestore: boolean } | null;
}) {
  const [order, setOrder] = useState(rows);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const pinned = order.filter((r) => r.dream);
  const movable = order.filter((r) => !r.dream);

  const save = (next: PriorityRow[], said: string) => {
    const before = order;
    setOrder(next);
    setError(null);
    setStatus(said);
    startTransition(async () => {
      const result = await setPriorityOrder(
        listId,
        next.map((r) => r.id),
      );
      if (!result.ok) {
        setOrder(before);
        setError(result.message);
      }
    });
  };

  const move = (id: string, to: number) => {
    const from = movable.findIndex((r) => r.id === id);
    if (from < 0 || to < 0 || to >= movable.length || to === from) return;
    const next = [...movable];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    save([...pinned, ...next], `${row.school.name} moved to ${to + 1 + pinned.length} of ${order.length}`);
  };

  const onKey = (e: KeyboardEvent, id: string, index: number) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(id, index - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(id, index + 1);
    }
  };

  const onDrop = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (dragging) move(dragging, index);
    setDragging(null);
  };

  const restore = () =>
    startTransition(async () => {
      setError(null);
      const result = await restorePriorityOrder(listId);
      if (!result.ok) setError(result.message);
    });

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Where you&apos;d go if every college said yes: your <Term term="dream-school">Dream</Term> first, then the rest.
        {canEdit && " Drag a college, or focus its handle and use the arrow keys."}
      </p>
      <ol className="divide-y rounded-2xl border" aria-label="Your colleges in priority order">
        {pinned.map((r) => (
          <li key={r.id} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
            <span className="w-6 text-right text-sm font-semibold tabular-nums text-muted-foreground">1</span>
            <Star className="size-4 shrink-0 fill-current text-primary" aria-label="Dream" />
            <CollegeChip school={r.school} />
          </li>
        ))}
        {movable.map((r, i) => (
          <li
            key={r.id}
            draggable={canEdit && !pending}
            onDragStart={() => setDragging(r.id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={(e) => onDrop(e, i)}
            className={cn("flex min-h-11 items-center gap-2 px-3 py-1.5", dragging === r.id && "opacity-50")}
          >
            <span className="w-6 text-right text-sm font-semibold tabular-nums text-muted-foreground">{i + 1 + pinned.length}</span>
            {canEdit ? (
              <button
                type="button"
                onKeyDown={(e) => onKey(e, r.id, i)}
                aria-label={`Reorder ${r.school.name}: use the up and down arrow keys`}
                className="inline-flex size-9 shrink-0 cursor-grab items-center justify-center rounded-full text-muted-foreground hover:bg-muted max-sm:hidden"
              >
                <GripVertical className="size-4" aria-hidden />
              </button>
            ) : null}
            <CollegeChip school={r.school} className="flex-1" />
            {canEdit && (
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={i === 0 || pending}
                  onClick={() => move(r.id, i - 1)}
                  aria-label={`Move ${r.school.name} up`}
                  className="inline-flex size-11 items-center justify-center rounded-full border disabled:opacity-30 sm:size-9"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={i === movable.length - 1 || pending}
                  onClick={() => move(r.id, i + 1)}
                  aria-label={`Move ${r.school.name} down`}
                  className="inline-flex size-11 items-center justify-center rounded-full border disabled:opacity-30 sm:size-9"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      {attribution?.byName && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Reordered by {attribution.byName}
          {canEdit && attribution.canRestore && (
            <button type="button" onClick={restore} disabled={pending} className="h-9 rounded-full border px-3 text-xs font-semibold text-foreground hover:bg-muted">
              Put it back
            </button>
          )}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
