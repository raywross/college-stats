import type { NumbersFormProps } from "@/components/planner/tabs/types";

/**
 * The numbers form: GPA, which test, the score, practice (specs/planner/redesign/standing.md "The numbers"). A
 * placeholder from the foundation unit (U1); unit U3 (List & rounds UI) owns this file and replaces it.
 */
export default function NumbersForm({ view }: NumbersFormProps) {
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
      Your numbers: coming soon{view.student.test ? "" : " (no test score yet)"}.
    </section>
  );
}
