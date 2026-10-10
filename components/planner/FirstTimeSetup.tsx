import type { NumbersFormProps } from "@/components/planner/tabs/types";

/**
 * First-time setup: the numbers, then the Dream (specs/planner/redesign/standing.md "First-time setup"). A placeholder
 * from the foundation unit (U1); unit U3 (List & rounds UI) owns this file and replaces it.
 */
export default function FirstTimeSetup({ view }: NumbersFormProps) {
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
      Setting up your plan: coming soon ({view.rows.length} on the list).
    </section>
  );
}
