import { refresh } from "next/cache";
import { AccountSection } from "@/components/account/AccountSection";
import { TextConsent } from "@/components/planner/TextConsent";
import { Term } from "@/components/ui/info-tip";
import type { StudentRecord } from "@/lib/accounts";
import { todayIso } from "@/lib/planner/context";
import { seasonOf } from "@/lib/planner/seasons";
import { consentView, mySeasonBrief, myYourWeek, setSeasonBrief, setYourWeek } from "@/lib/planner/store-timeline";
import { seasonBriefOn, yourWeekDefault, yourWeekOn } from "@/lib/planner/timeline";

async function toggleYourWeek(on: boolean) {
  "use server";
  await setYourWeek(on);
  refresh();
}

async function toggleSeasonBrief(on: boolean) {
  "use server";
  await setSeasonBrief(on);
  refresh();
}

const SWITCH = "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:h-10";

/**
 * /account's "Plan reminders" (specs/planner/timeline.md "Reminders", "Texts"; next-steps notifications.md): the Your
 * week switch (a student's; its default by season: off before junior spring, on from it), the season brief switch
 * (everyone's; on by default), and the texts switch: the person's own for an adult, a student's own at 18 or older; a
 * student under 18 sees whether a guardian turned texts on, and who. Server component.
 */
export async function RemindersSection({ student }: { student: StudentRecord | null }) {
  const today = todayIso();
  const season = seasonOf(student?.grad_year ?? null, today);
  const [stored, storedBrief, consent] = await Promise.all([
    student ? myYourWeek() : Promise.resolve(null),
    mySeasonBrief(),
    consentView(student ? { kind: "student", studentId: student.id } : { kind: "self" }),
  ]);
  const on = yourWeekOn(stored, season);
  const briefOn = seasonBriefOn(storedBrief);
  return (
    <AccountSection id="reminders" title="Plan reminders" description="Short reminders of the plan's next steps. Everything in them is also on the plan.">
      <div className="space-y-5">
        {student && (
          <div>
            <form action={toggleYourWeek.bind(null, !on)}>
              <button type="submit" className={SWITCH}>
                {on ? "Turn off Your week" : "Turn on Your week"}
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              <Term term="your-week">Your week</Term> is <strong>{on ? "on" : "off"}</strong>
              {stored === null ? ` (the default for this point in the year: ${yourWeekDefault(season) ? "on" : "off"})` : ""}. One email on Sunday
              evening with this season&apos;s next steps and what&apos;s due in the next seven days.
            </p>
          </div>
        )}
        <div>
          <form action={toggleSeasonBrief.bind(null, !briefOn)}>
            <button type="submit" className={SWITCH}>
              {briefOn ? "Turn off the season brief" : "Turn on the season brief"}
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            The <Term term="season-brief">season brief</Term> is <strong>{briefOn ? "on" : "off"}</strong>
            {storedBrief === null ? " (the default)" : ""}. One email when a season of high school turns, with its first few
            moves.
          </p>
        </div>
        {consent && <TextConsent view={consent} target={student ? { kind: "student", studentId: student.id } : { kind: "self" }} />}
      </div>
    </AccountSection>
  );
}
