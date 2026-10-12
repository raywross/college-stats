"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { banFor, sectorOf } from "@/lib/chances/legacy-bans";
import { RECRUITED_PICKS } from "@/lib/chances/levels";
import { noteText } from "@/lib/chances/notes";
import type { RecruitedPick } from "@/lib/chances/types";
import { setItemLegacy, setItemRecruited, setItemSibling } from "@/lib/planner/store-list";
import type { PlanItem, PlanSchool } from "@/lib/planner/types";
import { stateName } from "@/lib/states";
import { cn } from "@/lib/utils";

/** The picks' short words, for the chips (the full sentence is each chip's accessible name). */
const RECRUITED_SHORT: Record<RecruitedPick, string> = { none: "No", contact: "Coach contact", pre_read: "Pre-read", likely_letter: "Likely letter" };

const RECRUITED_LABELS: Record<RecruitedPick, string> = {
  none: "None",
  contact: "A coach has contacted me",
  pre_read: "I've had a positive pre-read",
  likely_letter: "I have a likely letter",
};

/**
 * The row's Connections line in the capture panel (components/planner/RowDrawer.tsx; owner, 2026-10-12: "not take up
 * a ton of space"): three one-tap chips on one line, [Parent or grandparent went here] [Sibling went here]
 * [Recruited ▾], the last opening its four picks (No · Coach contact · Pre-read · Likely letter) only when tapped. In the
 * intake's chip style (components/activities/chips.tsx), 44px tall, writing through the per-item columns
 * (`setItemLegacy`/`setItemSibling`/`setItemRecruited`, lib/planner/store-list.ts), attributed like other list edits. A saved change
 * refreshes the page so the college's level reads it. Shows the state-ban sentence where one applies, so a legacy
 * toggle a state bars never reads as if it would help.
 */
export function AboutYouAndCollege({ item, school, canEdit }: { item: Pick<PlanItem, "id" | "legacy" | "recruited" | "legacy_sibling">; school: PlanSchool; canEdit: boolean }) {
  const router = useRouter();
  const [legacy, setLegacy] = useState(item.legacy ?? false);
  const [sibling, setSibling] = useState(item.legacy_sibling ?? false);
  const [recruited, setRecruited] = useState<RecruitedPick>(item.recruited ?? "none");
  const [picking, setPicking] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ban = school.state ? banFor(school.state, sectorOf(school.type ?? "public")) : null;

  /** One optimistic write: set, save, roll back with the message on a refusal, refresh on success. */
  const write = <T,>(set: (v: T) => void, before: T, next: T, save: () => Promise<{ ok: boolean; message?: string }>) => {
    if (!canEdit) return;
    set(next);
    setError(null);
    startTransition(async () => {
      const result = await save();
      if (!result.ok) {
        set(before);
        setError(result.message ?? "That didn't work. Try again in a moment.");
        return;
      }
      router.refresh();
    });
  };

  const pickRecruited = (pick: RecruitedPick) => {
    setPicking(false);
    if (pick === recruited) return;
    write(setRecruited, recruited, pick, () => setItemRecruited(item.id, pick));
  };

  const recruitedChip = recruited === "none" ? "Recruited" : `Recruited · ${RECRUITED_SHORT[recruited]}`;

  return (
    <div className="space-y-2">
      <FieldLabel>Connections</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Chip
          role="checkbox"
          selected={legacy}
          disabled={!canEdit || pending}
          onClick={() => write(setLegacy, legacy, !legacy, () => setItemLegacy(item.id, !legacy))}
          ariaLabel="A parent or grandparent graduated from here"
          className="min-h-11"
        >
          {legacy ? "✓ " : ""}Parent or grandparent went here
        </Chip>
        <Chip
          role="checkbox"
          selected={sibling}
          disabled={!canEdit || pending}
          onClick={() => write(setSibling, sibling, !sibling, () => setItemSibling(item.id, !sibling))}
          ariaLabel="A brother or sister went here"
          className="min-h-11"
        >
          {sibling ? "✓ " : ""}Sibling went here
        </Chip>
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          disabled={!canEdit && recruited === "none"}
          aria-expanded={picking}
          aria-label={`Recruited by a coach at ${school.name}: ${RECRUITED_LABELS[recruited]}`}
          className={cn(
            "inline-flex min-h-11 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-50",
            recruited !== "none" ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {recruitedChip}
          <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", picking && "rotate-180")} aria-hidden />
        </button>
      </div>
      {picking && (
        <div className="flex flex-wrap gap-2 rounded-2xl bg-card/70 p-2" role="radiogroup" aria-label={`Recruited by a coach at ${school.name}`}>
          {RECRUITED_PICKS.map((pick) => (
            <Chip key={pick} selected={recruited === pick} disabled={!canEdit || pending} onClick={() => pickRecruited(pick)} ariaLabel={RECRUITED_LABELS[pick]} className="min-h-11">
              {RECRUITED_SHORT[pick]}
            </Chip>
          ))}
        </div>
      )}
      {(legacy || sibling) && ban && (
        <p className="text-xs text-muted-foreground">
          {noteText({
            key: "hooks.legacy_banned",
            values: { state: stateName(ban.state), scope: ban.sectors.includes("public") && ban.sectors.includes("private") ? "all" : ban.sectors[0], law: ban.law },
          })}
        </p>
      )}
      {recruited !== "none" && <p className="text-xs text-muted-foreground">{noteText({ key: "hooks.recruited", values: {} })}</p>}
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
