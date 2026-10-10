import type { PlanTabProps } from "@/components/planner/tabs/types";

/**
 * The Colleges tab: the list as the plan (specs/planner/redesign/list.md). A placeholder from the foundation unit
 * (U1); unit U3 (List & rounds UI) owns this file and replaces it.
 */
export default function PlanList({ view }: PlanTabProps) {
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
      Colleges: coming soon ({view.rows.length} on the list).
    </section>
  );
}
