import { refresh } from "next/cache";
import { AccountSection } from "@/components/account/AccountSection";
import { TextConsent } from "@/components/planner/TextConsent";
import { Term } from "@/components/ui/info-tip";
import type { StudentRecord } from "@/lib/accounts";
import { gradeOf } from "@/lib/planner/cycle";
import { todayIso } from "@/lib/planner/context";
import { consentView, myYourWeek, setYourWeek } from "@/lib/planner/store-timeline";
import { yourWeekDefault, yourWeekOn } from "@/lib/planner/timeline";

async function toggleYourWeek(on: boolean) {
  "use server";
  await setYourWeek(on);
  refresh();
}

/**
 * /account's "Plan reminders" (specs/planner/timeline.md "Reminders", "Texts"): the Your week switch beside the
 * update emails (a student's; on by default for seniors in season, off for juniors before spring), and the texts
 * switch: the person's own for an adult, a student's own at 18 or older; a student under 18 sees whether a guardian
 * turned texts on, and who. Server component.
 */
export async function RemindersSection({ student }: { student: StudentRecord | null }) {
  const today = todayIso();
  const grade = gradeOf(student?.grad_year ?? null, today);
  const [stored, consent] = await Promise.all([
    student ? myYourWeek() : Promise.resolve(null),
    consentView(student ? { kind: "student", studentId: student.id } : { kind: "self" }),
  ]);
  const on = yourWeekOn(stored, grade);
  return (
    <AccountSection id="reminders" title="Plan reminders" description="Short reminders of the plan's next steps. Everything in them is also on the plan.">
      <div className="space-y-5">
        {student && (
          <div>
            <form action={toggleYourWeek.bind(null, !on)}>
              <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:h-10">
                {on ? "Turn off Your week" : "Turn on Your week"}
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              <Term term="your-week">Your week</Term> is <strong>{on ? "on" : "off"}</strong>
              {stored === null ? ` (the default for this point in the year: ${yourWeekDefault(grade) ? "on" : "off"})` : ""}. One email on Sunday
              evening with the steps due in the next seven days.
            </p>
          </div>
        )}
        {consent && <TextConsent view={consent} target={student ? { kind: "student", studentId: student.id } : { kind: "self" }} />}
      </div>
    </AccountSection>
  );
}
