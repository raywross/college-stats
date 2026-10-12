"use client";
/**
 * The intake's four optional activity steps (intake.md "Activities, four steps"; depth.md "What the student enters"),
 * after AP courses: Sports, Clubs & organizations, Work & internships, and Other (awards first, then volunteering,
 * projects, anything else). Each is skippable and never blocks Continue; the cards and search are the shared ones in
 * components/activities/, which `/me` uses too.
 */
import { ActivityStepEditor } from "@/components/activities/ActivityStepEditor";
import { AwardsEditor } from "@/components/activities/AwardsEditor";
import { Headline } from "@/components/planner/intake/Headline";
import type { ActivityStep } from "@/lib/planner/activity-steps";
import type { IntakeDraft } from "@/lib/planner/intake";

const COPY: Record<ActivityStep, { lead: string; pop: string; tail?: string; sub: string }> = {
  sports: { lead: "Your", pop: "sports", sub: "Teams you've played on in high school. Tap the years and your level each year." },
  clubs: { lead: "Clubs and", pop: "organizations", sub: "School clubs, national groups like DECA or HOSA, music and theater. Tap the years and your title each year." },
  work: { lead: "Work and", pop: "internships", sub: "Jobs, internships, research positions, and helping your family. Colleges count these like any activity." },
  other: { lead: "Anything", pop: "else?", sub: "Awards, volunteering, projects of your own. Add what you have; skip what you don't." },
};

export function ActivitiesStep({ step, draft, setDraft }: { step: ActivityStep; draft: IntakeDraft; setDraft: (next: IntakeDraft) => void }) {
  const copy = COPY[step];
  const editor = (
    <ActivityStepEditor step={step} activities={draft.activities} onChange={(activities) => setDraft({ ...draft, activities })} classYear={draft.classYear} />
  );
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Headline lead={copy.lead} pop={copy.pop} tail={copy.tail} />
        <p className="text-sm text-muted-foreground">{copy.sub}</p>
      </div>
      {step === "other" ? (
        <>
          <section className="space-y-3" aria-labelledby="intake-awards">
            <h2 id="intake-awards" className="text-sm font-semibold text-muted-foreground">
              Awards
            </h2>
            <AwardsEditor awards={draft.awards} onChange={(awards) => setDraft({ ...draft, awards })} classYear={draft.classYear} />
          </section>
          <section className="space-y-3" aria-labelledby="intake-other">
            <h2 id="intake-other" className="text-sm font-semibold text-muted-foreground">
              Volunteering, projects, anything else
            </h2>
            {editor}
          </section>
        </>
      ) : (
        editor
      )}
    </div>
  );
}
