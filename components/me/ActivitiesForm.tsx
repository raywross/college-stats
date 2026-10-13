"use client";

import { useState } from "react";
import { ActivityStepEditor } from "@/components/activities/ActivityStepEditor";
import { ACTIVITIES_MAX } from "@/lib/chances/levels";
import type { ActivityEntry } from "@/lib/chances/types";
import { ACTIVITY_STEPS, type ActivityStep } from "@/lib/planner/activity-steps";
import { sanitizeActivities } from "@/lib/student-profile";

const SECTION: Record<ActivityStep, string> = {
  sports: "Sports",
  clubs: "Clubs & organizations",
  work: "Work & internships",
  other: "Volunteering, projects, anything else",
};

/**
 * The activities list on `/me` (depth.md "What the student enters"): the same four groups and cards as the intake's
 * activity steps (components/activities/ActivityStepEditor.tsx), at most ACTIVITIES_MAX entries in all. Controlled:
 * posts the whole list as a hidden "activities" JSON field, the same way `CoursePickerField` posts "courses".
 */
export function ActivitiesForm({ activities, classYear = null, disabled }: { activities: ActivityEntry[]; classYear?: number | null; disabled?: boolean }) {
  const [value, setValue] = useState<ActivityEntry[]>(() => sanitizeActivities(activities));

  return (
    <div className="space-y-5 sm:col-span-2">
      <div>
        <span className="block text-sm font-semibold">Activities (optional, up to {ACTIVITIES_MAX})</span>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Colleges that read activities look for a few things done for years, with a role. Tap the years and your title each year.
        </p>
      </div>
      {ACTIVITY_STEPS.map((step) => (
        <section key={step} className="space-y-2" aria-label={SECTION[step]}>
          <h3 className="text-sm font-semibold text-muted-foreground">{SECTION[step]}</h3>
          <ActivityStepEditor step={step} activities={value} onChange={setValue} classYear={classYear} layout="profile" disabled={disabled} />
        </section>
      ))}
      <input type="hidden" name="activities" value={JSON.stringify(value)} />
    </div>
  );
}
