"use client";

import { useLocalProfile } from "@/components/me/useLocalProfile";
import { HighSchoolPicker } from "@/components/high-schools/HighSchoolPicker";
import { CoursePicker } from "@/components/profile/CoursePicker";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { courseRigorCountOf } from "@/lib/student-profile";

/**
 * The course picker for a visitor who isn't signed in (rigor-in-context.md "Where it shows"): the same picker and the
 * high school, kept in the browser with the signed-out profile (components/me/useLocalProfile.ts) and moved onto the
 * account by the one-time import after sign-up. Every change is saved at once; there is no Save button. Opens from the
 * college profile's "Check your courses" and the signed-out plan's "Add your courses".
 */
export function LocalCoursesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, save } = useLocalProfile();
  return (
    <SheetDialog open={open} onOpenChange={onOpenChange} title="Your courses" description="Kept in this browser. Sign up to keep them across devices.">
      <div className="space-y-5">
        <div>
          <label htmlFor="local-highSchool" className="block text-sm font-semibold">
            Your high school
          </label>
          <p className="mb-1.5 text-xs text-muted-foreground">Pick it from the list so your courses can be read against what it offers.</p>
          <HighSchoolPicker
            idName="local-highSchoolId"
            nameName="local-highSchool"
            defaultId={data.basics.highSchoolId}
            defaultName={data.basics.highSchool}
            onSelect={(hit) => save({ ...data, basics: { ...data.basics, highSchoolId: hit.id, highSchool: hit.name } })}
          />
        </div>
        <CoursePicker
          value={{ courses: data.academics.courses, coreAtTopLevel: data.academics.coreAtTopLevel, apExamsPrivate: data.academics.apExamsPrivate }}
          onChange={(next) =>
            save({ ...data, academics: { ...data.academics, courses: next.courses, courseRigorCount: courseRigorCountOf(next.courses), coreAtTopLevel: next.coreAtTopLevel } })
          }
          highSchoolId={data.basics.highSchoolId}
          gradYear={data.basics.gradYear}
          majors={data.plans.intendedMajors}
          showExams
          canSetPrivacy={false}
        />
        <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
          Done
        </button>
      </div>
    </SheetDialog>
  );
}
