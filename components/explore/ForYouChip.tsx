import { STANDING_LEVEL_LABELS } from "@/lib/chances/levels";
import type { StandingLevel } from "@/lib/chances/types";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

/**
 * "Reach for you" beside a college's name on Explore's cards, rows, and table while the "For you" filter is on
 * (specs/planner/record/explore-levels.md). The level word in the level's calm tint (lib/planner/colors.ts): the only
 * thing from the estimate that shows, never a number. Takes a level key and nothing else.
 */
export function ForYouChip({ level, className }: { level: StandingLevel; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 w-fit shrink-0 items-center rounded-full px-2.5 text-xs font-bold whitespace-nowrap", GROUP_CLASS[level], className)}>
      {STANDING_LEVEL_LABELS[level]} for you
    </span>
  );
}
