"use client";

import { Sparkles } from "lucide-react";
import { CATEGORY_LABELS, type ListCategory } from "@/lib/list-rules";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

/**
 * The list row's group chip (specs/planner/redesign/list.md "The row"): Reach / Target / Likely, calm tints never a
 * warning, with a ✦ while it's the suggestion. A tap cycles it (lib/planner/list-row.ts nextGroup); "Add a number"
 * (no group from the model yet) isn't a button since there's nothing to cycle from without one.
 */
export function GroupChip({
  group,
  auto,
  canEdit,
  onCycle,
  className,
}: {
  group: ListCategory;
  /** True while this is the model's suggestion rather than the student's own pick. */
  auto: boolean;
  canEdit: boolean;
  onCycle: () => void;
  className?: string;
}) {
  if (group === "unsorted") {
    return <span className={cn("inline-flex h-8 shrink-0 items-center rounded-full bg-muted px-3 text-xs font-semibold text-muted-foreground", className)}>Add a number</span>;
  }
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onCycle}
      title={auto ? "Sorted for you; tap to change" : "You picked this group"}
      aria-label={`${CATEGORY_LABELS[group]}${auto ? ", sorted for you; tap to change" : ", your pick"}`}
      className={cn(
        "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-bold after:absolute after:-inset-1.5 after:content-[''] disabled:pointer-events-none disabled:opacity-80",
        GROUP_CLASS[group],
        className,
      )}
    >
      {auto && <Sparkles className="size-3" aria-hidden />}
      {CATEGORY_LABELS[group]}
    </button>
  );
}
