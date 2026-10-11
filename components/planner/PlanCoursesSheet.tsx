"use client";

import { useState, useTransition } from "react";
import { HighSchoolPicker } from "@/components/high-schools/HighSchoolPicker";
import { CoursePicker, type CoursePickerValue } from "@/components/profile/CoursePicker";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { saveCourses } from "@/lib/chances/courses-store";
import type { PlanContext } from "@/lib/planner/types";
import { emptyProfile } from "@/lib/student-profile";

/**
 * "Add your courses (optional)" (rigor-in-context.md "In the planner"): the course picker in a sheet, opened from the
 * numbers card. Saves the list, the core-subject answers, and the AP-exam privacy switch to the student's profile and
 * the plan re-renders with the reading. A parent with edit access can use it too; a parent never sees exam scores
 * while the student keeps them private (the context's profile is already stripped, lib/planner/load.ts), and the saved
 * scores stay on the rows that remain (mergeCoursesForSave).
 */
export function PlanCoursesSheet({ ctx, open, onOpenChange, name }: { ctx: PlanContext; open: boolean; onOpenChange: (open: boolean) => void; name: string | null }) {
  return (
    <SheetDialog open={open} onOpenChange={onOpenChange} title={name ? `${name}'s courses` : "Your courses"} description="Optional. It helps at colleges where most students have top GPAs.">
      <Body ctx={ctx} onDone={() => onOpenChange(false)} />
    </SheetDialog>
  );
}

function Body({ ctx, onDone }: { ctx: PlanContext; onDone: () => void }) {
  const profile = ctx.profile ?? emptyProfile();
  const own = ctx.viewer.relation === "self";
  const [value, setValue] = useState<CoursePickerValue>({
    courses: profile.academics.courses,
    coreAtTopLevel: profile.academics.coreAtTopLevel,
    apExamsPrivate: profile.academics.apExamsPrivate,
  });
  const [school, setSchool] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const studentId = ctx.student?.id ?? null;

  const save = () => {
    if (!studentId) return;
    setError(null);
    startTransition(async () => {
      const result = await saveCourses(studentId, { ...value, highSchool: school });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone();
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="sheet-highSchool" className="block text-sm font-semibold">
          High school
        </label>
        <p className="mb-1.5 text-xs text-muted-foreground">Pick it from the list so the courses can be read against what the school offers.</p>
        <HighSchoolPicker
          idName="sheet-highSchoolId"
          nameName="sheet-highSchool"
          defaultId={profile.basics.highSchoolId}
          defaultName={profile.basics.highSchool}
          onSelect={(hit) => setSchool({ id: hit.id, name: hit.name })}
        />
      </div>
      <CoursePicker
        value={value}
        onChange={setValue}
        highSchoolId={school?.id ?? profile.basics.highSchoolId}
        gradYear={ctx.student?.grad_year ?? profile.basics.gradYear}
        majors={profile.plans.intendedMajors}
        showExams={own || !profile.academics.apExamsPrivate}
        canSetPrivacy={own}
        disabled={pending}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="h-11 rounded-full border px-5 text-sm font-semibold hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}
