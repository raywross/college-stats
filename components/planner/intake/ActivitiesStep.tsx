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
import { Chip } from "@/components/activities/chips";
import { reconcileStepNone, stepHasEntries, toggleStepNone, type ActivityStep } from "@/lib/planner/activity-steps";
import type { IntakeDraft } from "@/lib/planner/intake";

const COPY: Record<ActivityStep, { lead: string; pop: string; tail?: string; sub: string }> = {
  sports: { lead: "Your", pop: "sports", sub: "Teams you've played on in high school. Tap the years and your level each year." },
  clubs: { lead: "Clubs and", pop: "organizations", sub: "School clubs, national groups like DECA or HOSA, music and theater. Tap the years and your title each year." },
  work: { lead: "Work and", pop: "internships", sub: "Jobs, internships, research positions, and helping your family. Colleges count these like any activity." },
  other: { lead: "Anything", pop: "else?", sub: "Awards, volunteering, projects of your own. Add what you have; skip what you don't." },
};

/** What "None" means on each step, for screen readers. */
const NONE_LABEL: Record<ActivityStep, string> = {
  sports: "None: I don't play a sport",
  clubs: "None: I'm not in a club or organization",
  work: "None: no work or internships",
  other: "None: nothing else to add",
};

export function ActivitiesStep({ step, draft, setDraft }: { step: ActivityStep; draft: IntakeDraft; setDraft: (next: IntakeDraft) => void }) {
  const copy = COPY[step];
  const none = draft.activitiesNone[step] === true;
  // Adding an entry clears this step's "None" (owner, 2026-10-12).
  const withEntries = (next: Pick<IntakeDraft, "activities" | "awards">) => {
    const merged = { ...draft, ...next };
    setDraft({ ...merged, activitiesNone: reconcileStepNone(merged.activities, merged.awards, merged.activitiesNone) });
  };
  const chooseNone = () => {
    if (!none && stepHasEntries(step, draft.activities, draft.awards) && !window.confirm("Remove what you've added on this step?")) return;
    setDraft(toggleStepNone(draft, step));
  };
  const editor = (
    <ActivityStepEditor step={step} activities={draft.activities} onChange={(activities) => withEntries({ activities, awards: draft.awards })} classYear={draft.classYear} />
  );
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Headline lead={copy.lead} pop={copy.pop} tail={copy.tail} />
        <p className="text-sm text-muted-foreground">{copy.sub}</p>
      </div>
      {/* One-tap "None": the step is answered with nothing to add, which counts as done (not the same as skipping). */}
      <Chip role="checkbox" selected={none} onClick={chooseNone} ariaLabel={NONE_LABEL[step]} className="min-h-11 px-5">
        {none ? "✓ None" : "None"}
      </Chip>
      {step === "other" ? (
        <>
          <section className="space-y-3" aria-labelledby="intake-awards">
            <h2 id="intake-awards" className="text-sm font-semibold text-muted-foreground">
              Awards
            </h2>
            <AwardsEditor awards={draft.awards} onChange={(awards) => withEntries({ activities: draft.activities, awards })} classYear={draft.classYear} />
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
