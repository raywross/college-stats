"use client";

import { useState } from "react";
import { GroupBars, type GroupBarsView } from "@/components/trends/GroupBars";
import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * Study 3's breakdowns: a window switch (ten years / five years, owner assumption) on top of GroupBars' own
 * Colleges/Students and grouping switches. Kept separate from GroupBars so that component stays reusable by a
 * future study with only one window.
 */
export function ShrinkingBreakdowns({ windows }: { windows: { key: string; label: string; views: GroupBarsView[] }[] }) {
  const [key, setKey] = useState(windows[0].key);
  const w = windows.find((x) => x.key === key) ?? windows[0];
  return (
    <div>
      <SegmentedControl label="Window" value={key} options={windows.map((x) => ({ value: x.key, label: x.label }))} onChange={setKey} className="mb-3" />
      <GroupBars views={w.views} windowLabel={w.label} />
    </div>
  );
}
