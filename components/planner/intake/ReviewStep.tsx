"use client";

import { Headline } from "@/components/planner/intake/Headline";
import { reviewLines, type IntakeDraft, type IntakeStep } from "@/lib/planner/intake";

/** Step 3 (intake.md "Review and saving"): one row per answer, each with an Edit link back to its step. */
export function ReviewStep({ draft, today, onEdit }: { draft: IntakeDraft; today: string; onEdit: (step: IntakeStep) => void }) {
  const lines = reviewLines(draft, today);
  return (
    <div className="space-y-6">
      <Headline lead="Look" pop="right?" />
      <div className="divide-y rounded-2xl border">
        {lines.map((line) => (
          <div key={line.label} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
            <div>
              <p className="text-xs text-muted-foreground">{line.label}</p>
              <p className="font-semibold">{line.value}</p>
            </div>
            <button type="button" onClick={() => onEdit(line.step)} className="min-h-9 shrink-0 px-2 text-sm font-semibold text-primary hover:underline">
              Edit
            </button>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">You can change any of this later from the top of your plan.</p>
    </div>
  );
}
