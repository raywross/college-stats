"use client";

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * Switches between server-rendered alternatives of one chart with a segmented control. Every view stays in the
 * HTML (the inactive ones are `hidden`), so nothing shifts on load and citations stay in the page; charts re-measure
 * when shown (useWidth ignores 0).
 */
export function ViewSwitch({ label, views }: { label: string; views: { key: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(views[0]?.key ?? "");
  return (
    <div>
      <SegmentedControl label={label} value={active} options={views.map((v) => ({ value: v.key, label: v.label }))} onChange={setActive} />
      {views.map((v) => (
        <div key={v.key} hidden={v.key !== active} className="mt-4">
          {v.content}
        </div>
      ))}
    </div>
  );
}

/**
 * Hub rule 2's control: *Colleges* (each college counts once: "how common is this?") or *Students* (weighted by size:
 * "how many people does this affect?"). Each view should say which it is in its own caption.
 */
export function CollegesStudents({ colleges, students }: { colleges: ReactNode; students: ReactNode }) {
  return (
    <ViewSwitch
      label="Count colleges or students"
      views={[
        { key: "colleges", label: "Colleges", content: colleges },
        { key: "students", label: "Students", content: students },
      ]}
    />
  );
}
