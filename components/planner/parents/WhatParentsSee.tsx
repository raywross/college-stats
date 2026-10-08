"use client";

import { useState } from "react";
import { SheetDialog } from "@/components/ui/sheet-dialog";

/**
 * "What your parents see" (specs/planner/parents.md "Rules": "readable by the student about themselves … the email
 * their parent receives"): a link on the student's own Plan tab that renders the weekly parent-summary email's
 * content about them — the summary line, the stuck signals, and what they ticked this week. "Your part" is each
 * guardian's own open tasks, so it isn't shown here (a guardian sees their own; this is what every guardian who has
 * the weekly summary on would read about this student, not any one guardian's inbox).
 */
export function WhatParentsSee({ summary, stuckSignals, tickedThisWeek }: { summary: string; stuckSignals: string[]; tickedThisWeek: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title="What your parents see"
      description="The weekly email a guardian who's turned it on gets about you, if either household member can see this plan."
      trigger={{
        className: "text-sm font-semibold text-primary underline-offset-2 hover:underline",
        label: "What your parents see",
        content: "What your parents see",
      }}
    >
      <div className="space-y-3 text-sm">
        <p className="font-semibold">{summary}</p>
        {stuckSignals.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {stuckSignals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
        {tickedThisWeek.length > 0 && <p className="text-muted-foreground">Ticked this week: {tickedThisWeek.join(", ")}</p>}
        <p className="text-xs text-muted-foreground">
          Plus their own &ldquo;Your part&rdquo;: whatever is assigned to them or either of you. Never a score, a note, or a comparison with
          anyone else in the household.
        </p>
      </div>
    </SheetDialog>
  );
}
