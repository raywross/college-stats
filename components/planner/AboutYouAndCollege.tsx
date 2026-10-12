"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { banFor, sectorOf } from "@/lib/chances/legacy-bans";
import { RECRUITED_PICKS } from "@/lib/chances/levels";
import { noteText } from "@/lib/chances/notes";
import type { RecruitedPick } from "@/lib/chances/types";
import { setItemLegacy, setItemRecruited } from "@/lib/planner/store-list";
import type { PlanItem, PlanSchool } from "@/lib/planner/types";
import { stateName } from "@/lib/states";

const RECRUITED_LABELS: Record<RecruitedPick, string> = {
  none: "None",
  contact: "A coach has contacted me",
  pre_read: "I've had a positive pre-read",
  likely_letter: "I have a likely letter",
};

/**
 * Legacy and Recruited in the row's capture panel (components/planner/RowDrawer.tsx; specs/chances/
 * inputs-beyond-academics.md "Legacy", "Recruited athlete"): a one-tap legacy toggle and a recruited pick, in the
 * intake's chip style (components/activities/chips.tsx), writing through the per-item columns
 * (`setItemLegacy`/`setItemRecruited`, lib/planner/store-list.ts), attributed like other list edits. A saved change
 * refreshes the page so the college's level reads it. Shows the state-ban sentence where one applies, so a legacy
 * toggle a state bars never reads as if it would help.
 */
export function AboutYouAndCollege({ item, school, canEdit }: { item: Pick<PlanItem, "id" | "legacy" | "recruited">; school: PlanSchool; canEdit: boolean }) {
  const router = useRouter();
  const [legacy, setLegacy] = useState(item.legacy ?? false);
  const [recruited, setRecruited] = useState<RecruitedPick>(item.recruited ?? "none");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ban = school.state ? banFor(school.state, sectorOf(school.type ?? "public")) : null;

  const toggleLegacy = () => {
    if (!canEdit) return;
    const next = !legacy;
    setLegacy(next);
    setError(null);
    startTransition(async () => {
      const result = await setItemLegacy(item.id, next);
      if (!result.ok) {
        setLegacy(!next);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  const pickRecruited = (pick: RecruitedPick) => {
    if (!canEdit || pick === recruited) return;
    const before = recruited;
    setRecruited(pick);
    setError(null);
    startTransition(async () => {
      const result = await setItemRecruited(item.id, pick);
      if (!result.ok) {
        setRecruited(before);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <div className="space-y-2">
        <FieldLabel>Legacy</FieldLabel>
        <Chip role="checkbox" selected={legacy} disabled={!canEdit || pending} onClick={toggleLegacy} className="min-h-11 py-2 text-left">
          {legacy ? "✓ " : ""}A parent or grandparent graduated from here
        </Chip>
        {legacy && ban && (
          <p className="text-xs text-muted-foreground">
            {noteText({
              key: "hooks.legacy_banned",
              values: { state: stateName(ban.state), scope: ban.sectors.includes("public") && ban.sectors.includes("private") ? "all" : ban.sectors[0], law: ban.law },
            })}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <FieldLabel>Recruited by a coach here</FieldLabel>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Recruited by a coach at ${school.name}`}>
          {RECRUITED_PICKS.map((pick) => (
            <Chip key={pick} selected={recruited === pick} disabled={!canEdit || pending} onClick={() => pickRecruited(pick)} className="min-h-11">
              {RECRUITED_LABELS[pick]}
            </Chip>
          ))}
        </div>
        {recruited !== "none" && <p className="text-xs text-muted-foreground">{noteText({ key: "hooks.recruited", values: {} })}</p>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}

/** The profile's standing card, which has no list row (inputs-beyond-academics.md "Legacy"): shown when neither is set. */
export function AddToListForHooks({ college, href }: { college: string; href: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      <a href={href} className="font-semibold text-primary hover:underline">
        Add {college} to your list
      </a>{" "}
      to mark a legacy or recruiting connection.
    </p>
  );
}
