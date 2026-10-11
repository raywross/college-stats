"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";

export type CalendarRange = "weeks" | "year";

/**
 * The Calendar tab's "8 weeks | Full year" toggle (specs/planner/redesign/calendar.md "Coming up"): 8 weeks is the
 * default dated list (`UpcomingList` variant "tab"); Full year reveals the existing `FamilyCalendar` chart,
 * unchanged. FamilyCalendar owns the state this switches and renders this beside its own "Coming up" heading.
 */
export function CalendarRangeToggle({ value, onChange }: { value: CalendarRange; onChange: (v: CalendarRange) => void }) {
  return (
    <SegmentedControl
      label="Calendar range"
      value={value}
      onChange={onChange}
      options={[
        { value: "weeks", label: "8 weeks" },
        { value: "year", label: "Full year" },
      ]}
    />
  );
}

export default CalendarRangeToggle;
