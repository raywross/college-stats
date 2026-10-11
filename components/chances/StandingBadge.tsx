import { CATEGORY_LABELS } from "@/lib/list-rules";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { noteText } from "@/lib/chances/notes";
import type { EstimateResult } from "@/lib/chances/types";
import { cn } from "@/lib/utils";

/** The chip's words: a label when the estimate has one ("Reach for everyone", "Guaranteed for you"), else the group. */
export function standingWords(result: Pick<EstimateResult, "group" | "label">): string | null {
  if (result.label === "guaranteed") return noteText({ key: "estimate.label.guaranteed", values: {} });
  if (result.label === "reach-for-everyone") return noteText({ key: "estimate.label.reach_for_everyone", values: {} });
  return result.group ? CATEGORY_LABELS[result.group] : null;
}

/**
 * Reach / Target / Likely in the planner's calm tints (lib/planner/colors.ts), never a warning color, with the
 * estimate's label in its place when it has one. Words always carry the meaning; the color is only a tint.
 */
export function StandingBadge({ result, className }: { result: Pick<EstimateResult, "group" | "label">; className?: string }) {
  const words = standingWords(result);
  if (!words || !result.group) return null;
  return <span className={cn("inline-flex h-7 shrink-0 items-center rounded-full px-3 text-xs font-bold", GROUP_CLASS[result.group], className)}>{words}</span>;
}
