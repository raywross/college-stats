"use client";

import { useState, useTransition } from "react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { LIST_OUTCOMES, LIST_STATUSES, OUTCOME_LABELS, STATUS_LABELS, type ListOutcome, type ListStatus } from "@/lib/list-rules";
import { setItemStatus, setOutcome } from "@/lib/lists";
import { markApplied } from "@/lib/planner/store-apply";

/**
 * The status (and outcome) picker for an Apply-stage card (specs/planner/applications.md "Display": "the status is
 * a bottom-sheet picker" on phones). An inline select from `sm`; a button opening a bottom sheet of big rows below
 * it, so the same fact — the list row's status — stays one control everywhere. Picking "Applied" records today as
 * `applied_on` (the same tick as the timeline's Apply task, lib/planner/store-apply.ts markApplied); picking
 * "Decided" asks for the outcome right away.
 */
export function ApplyStatusControl({ itemId, status, outcome, canEdit }: { itemId: string; status: ListStatus; outcome: ListOutcome | null; canEdit: boolean }) {
  const [current, setCurrent] = useState(status);
  const [currentOutcome, setCurrentOutcome] = useState(outcome);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const changeStatus = (next: ListStatus) => {
    setOpen(false);
    const before = current;
    setCurrent(next);
    if (next !== "decided") setCurrentOutcome(null);
    startTransition(async () => {
      const result = next === "applied" ? await markApplied(itemId) : await setItemStatus(itemId, next);
      if (!result.ok) setCurrent(before);
    });
  };

  const changeOutcome = (next: ListOutcome) => {
    const before = currentOutcome;
    setCurrentOutcome(next);
    startTransition(async () => {
      const result = await setOutcome(itemId, next, null);
      if (!result.ok) setCurrentOutcome(before);
    });
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <select
        value={current}
        disabled={!canEdit || pending}
        onChange={(e) => changeStatus(e.target.value as ListStatus)}
        className="hidden h-9 rounded-full border bg-background px-2.5 text-xs font-semibold disabled:opacity-70 sm:inline-flex"
        aria-label="Status"
      >
        {LIST_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!canEdit || pending}
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-full border bg-background px-2.5 text-xs font-semibold disabled:opacity-70 sm:hidden"
      >
        {STATUS_LABELS[current]}
      </button>
      {current === "decided" && (
        <select
          value={currentOutcome ?? ""}
          disabled={!canEdit || pending}
          onChange={(e) => e.target.value && changeOutcome(e.target.value as ListOutcome)}
          className="hidden h-9 rounded-full border bg-background px-2.5 text-xs font-semibold disabled:opacity-70 sm:inline-flex"
          aria-label="Outcome"
        >
          <option value="">Outcome</option>
          {LIST_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
      )}

      <SheetDialog open={open} onOpenChange={setOpen} title="Status">
        <ul className="space-y-1.5">
          {LIST_STATUSES.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => changeStatus(s)}
                className="flex h-11 w-full items-center rounded-xl border px-3 text-left text-sm font-semibold data-[current=true]:border-primary data-[current=true]:bg-primary/10"
                data-current={s === current}
              >
                {STATUS_LABELS[s]}
              </button>
            </li>
          ))}
        </ul>
        {current === "decided" && (
          <>
            <p className="mt-4 text-xs font-semibold text-muted-foreground">Outcome</p>
            <ul className="mt-1.5 space-y-1.5">
              {LIST_OUTCOMES.map((o) => (
                <li key={o}>
                  <button
                    type="button"
                    onClick={() => {
                      changeOutcome(o);
                      setOpen(false);
                    }}
                    className="flex h-11 w-full items-center rounded-xl border px-3 text-left text-sm font-semibold data-[current=true]:border-primary data-[current=true]:bg-primary/10"
                    data-current={o === currentOutcome}
                  >
                    {OUTCOME_LABELS[o]}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </SheetDialog>
    </div>
  );
}
