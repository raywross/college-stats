"use client";

import { useState, useTransition } from "react";
import { banFor, sectorOf } from "@/lib/chances/legacy-bans";
import { RECRUITED_PICKS } from "@/lib/chances/levels";
import { noteText } from "@/lib/chances/notes";
import type { RecruitedPick } from "@/lib/chances/types";
import { setItemLegacy, setItemRecruited } from "@/lib/planner/store-list";
import type { PlanItem, PlanSchool } from "@/lib/planner/types";
import { stateName } from "@/lib/states";
import { cn } from "@/lib/utils";

const RECRUITED_LABELS: Record<RecruitedPick, string> = {
  none: "None",
  contact: "A coach has contacted me",
  pre_read: "I've had a pre-read (and it came back positive)",
  likely_letter: "I have a likely letter",
};

/**
 * The drawer's "About you and {College}" line (specs/chances/inputs-beyond-academics.md "Legacy", "Recruited
 * athlete"): the legacy toggle ("A parent or grandparent graduated from here") and the recruited pick, writing
 * through U7's per-item columns (`setItemLegacy`/`setItemRecruited`, lib/planner/store-list.ts), attributed like
 * other list edits. Shows the state-ban sentence where one applies, so a legacy toggle a state bars never reads as
 * if it would help. Nothing here lowers a level; the method applies legacy and recruited status as the method says
 * (specs/chances/method/standing.md).
 */
export function AboutYouAndCollege({ item, school, canEdit }: { item: Pick<PlanItem, "id" | "legacy" | "recruited">; school: PlanSchool; canEdit: boolean }) {
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
      }
    });
  };

  const pickRecruited = (pick: RecruitedPick) => {
    if (!canEdit) return;
    const before = recruited;
    setRecruited(pick);
    setError(null);
    startTransition(async () => {
      const result = await setItemRecruited(item.id, pick);
      if (!result.ok) {
        setRecruited(before);
        setError(result.message);
      }
    });
  };

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">About you and {school.name}</p>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={legacy} disabled={!canEdit || pending} onChange={toggleLegacy} className="mt-0.5 size-4 accent-primary" />
        <span>A parent or grandparent graduated from here</span>
      </label>
      {legacy && ban && (
        <p className="pl-6 text-xs text-muted-foreground">
          {noteText({
            key: "hooks.legacy_banned",
            values: { state: stateName(ban.state), scope: ban.sectors.includes("public") && ban.sectors.includes("private") ? "all" : ban.sectors[0], law: ban.law },
          })}
        </p>
      )}
      <div className="space-y-1">
        <p>A coach here is recruiting me</p>
        <div className="flex flex-wrap gap-1.5">
          {RECRUITED_PICKS.map((pick) => (
            <button
              key={pick}
              type="button"
              disabled={!canEdit || pending}
              onClick={() => pickRecruited(pick)}
              aria-pressed={recruited === pick}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-60",
                recruited === pick ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              {RECRUITED_LABELS[pick]}
            </button>
          ))}
        </div>
        {recruited !== "none" && <p className="text-xs text-muted-foreground">{noteText({ key: "hooks.recruited", values: {} })}</p>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
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
