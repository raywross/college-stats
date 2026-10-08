"use client";

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";

type View = "month" | "college";

/**
 * The timeline's toggle (specs/planner/timeline.md "Display"): By month (default) | By college. Both views are
 * rendered on the server and kept in the page; the toggle only shows one, and printing always shows the college view.
 */
export function TimelineViews({ month, college }: { month: ReactNode; college: ReactNode }) {
  const [view, setView] = useState<View>("month");
  const change = (v: View) => setView(v);
  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <SegmentedControl
          label="Show the timeline"
          value={view}
          onChange={change}
          options={[
            { value: "month", label: "By month" },
            { value: "college", label: "By college" },
          ]}
          className="[&>button]:min-h-11 sm:[&>button]:min-h-0"
        />
      </div>
      <div className={view === "month" ? "print:hidden" : "hidden"}>{month}</div>
      <div className={view === "college" ? "" : "hidden print:block"}>{college}</div>
    </div>
  );
}
