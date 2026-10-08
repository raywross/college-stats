"use client";

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";

type View = "deadline" | "platform";

/**
 * The Apply stage's toggle (specs/planner/applications.md "Display"): the same cards, grouped by deadline (the
 * default) or "By platform" ("Common App: 6 colleges"). Both groupings render on the server; the toggle shows one.
 */
export function ApplyPlatformToggle({ byDeadline, byPlatform }: { byDeadline: ReactNode; byPlatform: ReactNode }) {
  const [view, setView] = useState<View>("deadline");
  return (
    <div className="space-y-4">
      <SegmentedControl
        label="Group colleges"
        value={view}
        onChange={setView}
        options={[
          { value: "deadline", label: "By deadline" },
          { value: "platform", label: "By platform" },
        ]}
        className="[&>button]:min-h-11 sm:[&>button]:min-h-0"
      />
      {view === "deadline" ? byDeadline : byPlatform}
    </div>
  );
}
