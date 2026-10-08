"use client";

import { useState, useTransition } from "react";
import { ArrowUpDown, Check } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { setSort } from "@/lib/planner/store-list";
import { SORT_OPTIONS } from "@/lib/planner/suggest";
import type { ListSort } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

/**
 * The per-list sort (specs/planner/list-building.md "Sorting"): a button naming the current sort that opens the
 * option list in `SheetDialog` — a bottom sheet on phones, a centered dialog from `sm` (specs/mobile.md "sheets for
 * pickers"). The same menu on the List tab and the Stage 1 panel (`ListStage`), since both read `lists.sort`
 * (`setSort`, lib/planner/store-list.ts) and re-render from the same value. `unavailable` lists which options to
 * grey out with their "needs" hint (distance without a home address, Where I stand without the student's numbers).
 */
export function SortMenu({
  listId,
  value,
  canEdit,
  unavailable = [],
}: {
  listId: string;
  value: ListSort | null;
  canEdit: boolean;
  /** Sort values the list can't use yet (no home address, no numbers); shown disabled with their "needs" hint. */
  unavailable?: readonly ListSort[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = value ?? "category";
  const label = SORT_OPTIONS.find((o) => o.value === current)?.label ?? "Category";

  if (!canEdit) {
    return <p className="text-sm text-muted-foreground">Sorted by {label.toLowerCase()}.</p>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold hover:bg-muted"
      >
        <ArrowUpDown className="size-3.5" aria-hidden />
        Sort: {label}
      </button>
      <SheetDialog open={open} onOpenChange={setOpen} title="Sort this list">
        <ul className="space-y-0.5" role="radiogroup" aria-label="Sort this list">
          {SORT_OPTIONS.map((o) => {
            const disabled = unavailable.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={current === o.value}
                  disabled={disabled || pending}
                  onClick={() => {
                    setOpen(false);
                    startTransition(async () => {
                      await setSort(listId, o.value);
                    });
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm",
                    disabled ? "text-muted-foreground/60" : "hover:bg-muted",
                  )}
                >
                  <span>
                    <span className="font-semibold">{o.label}</span>
                    {disabled && o.needs && <span className="block text-xs text-muted-foreground">Needs {o.needs}</span>}
                  </span>
                  {current === o.value && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">&quot;Where I stand&quot; is by your numbers, not by quality.</p>
      </SheetDialog>
    </>
  );
}
