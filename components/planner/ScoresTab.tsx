import type { PlanTabProps } from "@/components/planner/tabs/types";

/**
 * The Scores tab: where the score stands and when another test would help (specs/planner/redesign/scores.md). A
 * placeholder from the foundation unit (U1); unit U4 (Scores) owns this file and replaces it.
 */
export default function ScoresTab({ view }: PlanTabProps) {
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
      Scores: coming soon{view.retake ? " (another test could help)" : ""}.
    </section>
  );
}
