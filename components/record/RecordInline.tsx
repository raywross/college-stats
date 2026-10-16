import Link from "next/link";
import { RecordOverview } from "@/components/record/RecordOverview";
import type { PlanLoad } from "@/lib/planner/load";
import { planHref } from "@/lib/planner/plan-tabs";
import type { ProfileAccess } from "@/lib/student-profile-store";

/**
 * The record, expanded on the plan page (owner, 2026-10-16: "I like having it on the plan page when you hit edit. Make
 * it so that when you hit edit on the plan page it expands to show your record, then have a save or cancel button to
 * close it"). `/plan?record=1` renders this under the people line in place of the tabs: the same overview the
 * household's Record tab shows (RecordOverview), with each section's Edit opening the tour at that step and returning
 * here (`back: "inline"`), and a footer that closes it. Every step saves on its own when its tour saves, so Save and
 * Cancel both return to the plan's tabs; Save is the primary button because that is what a student reaches for.
 */
export function RecordInline({ profile, plan, person }: { profile: ProfileAccess; plan: PlanLoad; person: string | null }) {
  const back = planHref({ person, tab: null });
  return (
    <section aria-label="Your record" className="space-y-6">
      <RecordOverview profile={profile} plan={plan} back="inline" />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Link href={back} className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold ring-1 ring-border hover:bg-muted">
          Cancel
        </Link>
        <Link href={back} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Save
        </Link>
      </div>
    </section>
  );
}
