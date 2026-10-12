"use client";

import { useState } from "react";
import { GroupBars, type GroupBarsView } from "@/components/trends/GroupBars";
import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * Study 3's breakdowns: a window switch (ten years / five years, owner assumption) and a colleges-shown switch
 * ("All colleges" / "Campus-based only", specs/trends/shrinking-colleges.md "Data work needed") on top of GroupBars'
 * own Colleges/Students and grouping switches. Kept separate from GroupBars so that component stays reusable by a
 * future study with only one window or no campus-based cut.
 */
export function ShrinkingBreakdowns({
  windows,
  campusCaption,
}: {
  windows: { key: string; label: string; views: GroupBarsView[]; campusViews: GroupBarsView[] }[];
  /** One line saying what "Campus-based only" leaves out and the counts, shown only in that scope. */
  campusCaption: string;
}) {
  const [key, setKey] = useState(windows[0].key);
  const [scope, setScope] = useState<"all" | "campus">("all");
  const w = windows.find((x) => x.key === key) ?? windows[0];
  const views = scope === "campus" ? w.campusViews : w.views;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SegmentedControl label="Window" value={key} options={windows.map((x) => ({ value: x.key, label: x.label }))} onChange={setKey} />
        <SegmentedControl
          label="Colleges shown"
          value={scope}
          options={[
            { value: "all", label: "All colleges" },
            { value: "campus", label: "Campus-based only" },
          ]}
          onChange={setScope}
        />
      </div>
      {scope === "campus" && <p className="mb-3 text-xs text-muted-foreground">{campusCaption}</p>}
      <GroupBars views={views} windowLabel={w.label} />
    </div>
  );
}
