"use client";

import { ActivityRow, blankActivity } from "@/components/me/ActivitiesForm";
import { Headline } from "@/components/planner/intake/Headline";
import { ACTIVITIES_MAX } from "@/lib/chances/levels";
import type { IntakeDraft } from "@/lib/planner/intake";

/**
 * The optional step after the numbers (depth.md "What the student enters", intake.md "Steps"): the activities the
 * estimate reads, never in the first two steps and never blocking Continue. The form invites two or three; the
 * profile's own ACTIVITIES_MAX (8) is the only hard cap. Reuses `ActivityRow` from `components/me/ActivitiesForm.tsx`
 * so the two forms behave identically.
 */
export function MoreAboutYouStep({ draft, setDraft }: { draft: IntakeDraft; setDraft: (next: IntakeDraft) => void }) {
  const update = (id: string, next: IntakeDraft["activities"][number]) => setDraft({ ...draft, activities: draft.activities.map((a) => (a.id === id ? next : a)) });
  const remove = (id: string) => setDraft({ ...draft, activities: draft.activities.filter((a) => a.id !== id) });
  const add = () => setDraft({ ...draft, activities: draft.activities.length >= ACTIVITIES_MAX ? draft.activities : [...draft.activities, blankActivity()] });

  return (
    <div className="space-y-6">
      <Headline lead="More about" pop="you" />
      <p className="text-sm text-muted-foreground">
        Colleges that read activities look for a few things done for years, with a role. Add your two or three biggest — or skip this and add them later from your profile.
      </p>
      <div className="space-y-3">
        {draft.activities.map((a) => (
          <ActivityRow key={a.id} value={a} onChange={(next) => update(a.id, next)} onRemove={() => remove(a.id)} />
        ))}
      </div>
      {draft.activities.length < ACTIVITIES_MAX && (
        <button type="button" onClick={add} className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium hover:bg-muted">
          + Add an activity
        </button>
      )}
    </div>
  );
}
