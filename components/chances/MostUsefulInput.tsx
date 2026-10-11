import { noteText } from "@/lib/chances/notes";
import { mostUsefulMissing } from "@/lib/chances/what-went-in";
import type { EstimateResult } from "@/lib/chances/types";
import { cn } from "@/lib/utils";

/**
 * "Adding your class rank would sort 2 more colleges" under the plan's numbers (specs/chances/estimate.md "In the
 * planner"): the one input that would change the most colleges' groups, from what the estimates say they're missing.
 * Nothing when no input would change a group.
 */
export function MostUsefulInput({ estimates, className }: { estimates: Record<string, EstimateResult>; className?: string }) {
  const note = mostUsefulMissing(Object.values(estimates));
  if (!note) return null;
  return <p className={cn("text-xs text-muted-foreground", className)}>{noteText(note)}</p>;
}
