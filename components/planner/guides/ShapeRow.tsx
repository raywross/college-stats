/**
 * The list's shape as a row of slots (specs/planner/v3/guides/list-size.md "1. The shape"): for each of the five
 * levels, outlined boxes for this season's range (solid up to the minimum, dashed up to the maximum), the student's
 * colleges filled in the level's color, the Dream in the Dream's rose, and any college past the maximum in a muted
 * tint past the outline. The range and the count under each, the total at the right.
 *
 * On a phone the five levels stack as rows (label, boxes, count), so nothing scrolls sideways at 390 px; from `sm`
 * they sit side by side as five columns with the total as a sixth. Presentational; the numbers are the list's own
 * counts and the season's ranges (lib/planner/list-guide.ts `shapeRow`), never anything from the estimate.
 *
 * `links` (specs/planner/record/explore-levels.md): a "Show me more" link per level into Explore at that level for the
 * student, narrowed by the record's preferences (lib/planner/list-guide.ts showMoreLinks): filled in the primary color
 * on a level below the shape's minimum, quiet on the rest. On a phone it sits under the boxes, 44 px tall.
 */
import Link from "next/link";
import { STANDING_LEVEL_LABELS } from "@/lib/chances/levels";
import type { StandingLevel } from "@/lib/chances/types";
import type { ShapeRowView, ShapeSlot, ShowMoreLink } from "@/lib/planner/list-guide";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

/** A filled box per level: the chip's hue at full strength (the chips themselves are tints). */
const LEVEL_FILL: Record<StandingLevel, string> = {
  high_reach: "bg-pink-400 dark:bg-pink-400",
  reach: "bg-violet-500 dark:bg-violet-400",
  target: "bg-sky-500 dark:bg-sky-400",
  likely: "bg-emerald-500 dark:bg-emerald-400",
  safe: "bg-green-700 dark:bg-green-500",
};

function slotClass(slot: ShapeSlot, level: StandingLevel): string {
  switch (slot) {
    case "filled":
      return LEVEL_FILL[level];
    case "dream":
      return "bg-rose-500";
    case "overflow":
      return "bg-muted-foreground/35";
    case "need":
      return "border-2 border-foreground/45";
    case "room":
      return "border-2 border-dashed border-foreground/25";
  }
}

export function ShapeRow({
  row,
  links = null,
  onShowMore,
}: {
  row: ShapeRowView;
  links?: Readonly<Record<StandingLevel, ShowMoreLink>> | null;
  onShowMore?: (level: StandingLevel, emphasized: boolean) => void;
}) {
  return (
    <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-[repeat(5,minmax(0,1fr))_auto] sm:items-start">
      {row.levels.map((l) => (
        <div
          key={l.level}
          role="group"
          aria-label={`${STANDING_LEVEL_LABELS[l.level]}: ${l.range ? `aim for ${l.range[0]} to ${l.range[1]}, ` : ""}you have ${l.count}`}
          className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-x-3 sm:flex sm:flex-col sm:items-start sm:gap-1.5"
        >
          <span className={cn("inline-flex h-6 w-fit items-center rounded-full px-2.5 text-xs font-bold", GROUP_CLASS[l.level])}>{STANDING_LEVEL_LABELS[l.level]}</span>
          <span className="flex min-h-4 flex-wrap gap-1" aria-hidden>
            {l.slots.map((slot, i) => (
              <span key={i} className={cn("size-3.5 rounded-[3px] sm:size-4", slotClass(slot, l.level))} />
            ))}
          </span>
          <span className="text-right text-xs text-muted-foreground tabular-nums sm:text-left">{l.countText}</span>
          {links?.[l.level] && (
            <Link
              href={links[l.level].href}
              onClick={() => onShowMore?.(l.level, links[l.level].emphasized)}
              aria-label={`Show me more ${STANDING_LEVEL_LABELS[l.level]} colleges`}
              className={cn(
                "col-span-2 col-start-2 inline-flex min-h-11 w-fit items-center justify-center rounded-full px-3 text-center text-xs leading-tight font-semibold sm:mt-1 sm:w-full",
                links[l.level].emphasized ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-foreground ring-1 ring-border hover:bg-muted",
              )}
            >
              Show me more
            </Link>
          )}
        </div>
      ))}
      <p className="border-t pt-2 text-sm font-semibold tabular-nums sm:self-end sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3 sm:text-right">{row.total.text}</p>
    </div>
  );
}

/** The key under the row: what a filled, Dream, over, and outlined box mean. */
export function ShapeKey({ hasDream, hasOverflow }: { hasDream: boolean; hasOverflow: boolean }) {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-3 rounded-[3px]", cls)} aria-hidden />
      {label}
    </span>
  );
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item("bg-foreground/60", "on your list")}
      {hasDream && item("bg-rose-500", "your Dream")}
      {hasOverflow && item("bg-muted-foreground/35", "past the most")}
      {item("border-2 border-foreground/45", "to reach")}
      {item("border-2 border-dashed border-foreground/25", "room for more")}
    </p>
  );
}

export default ShapeRow;
