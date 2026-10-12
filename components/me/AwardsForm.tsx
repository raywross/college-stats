"use client";

import { useState } from "react";
import { AwardsEditor } from "@/components/activities/AwardsEditor";
import { AWARDS_MAX } from "@/lib/chances/levels";
import type { AwardEntry } from "@/lib/chances/types";
import { sanitizeAwards } from "@/lib/student-profile";

/**
 * The awards list on `/me` (inputs-beyond-academics.md "Awards"): the same search and cards as the intake's Other step
 * (components/activities/AwardsEditor.tsx). Pick from the reviewed catalog (its tier comes along), or add one that
 * isn't listed with a typed name and a tier pick. At most AWARDS_MAX entries. Controlled: posts the whole list as a
 * hidden "awards" JSON field, like `ActivitiesForm` posts "activities".
 */
export function AwardsForm({ awards, classYear = null, disabled }: { awards: AwardEntry[]; classYear?: number | null; disabled?: boolean }) {
  const [value, setValue] = useState<AwardEntry[]>(() => sanitizeAwards(awards));

  return (
    <div className="space-y-2 sm:col-span-2">
      <span className="block text-sm font-semibold">Awards (optional, up to {AWARDS_MAX})</span>
      <p className="text-xs text-muted-foreground">Pick it from the list so its level is consistent; not listed? Add it as you&apos;d write it.</p>
      <AwardsEditor awards={value} onChange={setValue} classYear={classYear} layout="profile" disabled={disabled} />
      <input type="hidden" name="awards" value={JSON.stringify(value)} />
    </div>
  );
}
