"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { Crest } from "@/components/school/Crest";
import { banFor, sectorOf } from "@/lib/chances/legacy-bans";
import { RECRUITED_PICKS } from "@/lib/chances/levels";
import { noteText } from "@/lib/chances/notes";
import type { RecruitedPick } from "@/lib/chances/types";
import type { SchoolIndexEntry } from "@/lib/dataset";
import { CONNECTION_FAMILIES, connectionSentence, type ConnectionEntry, type ConnectionFamily } from "@/lib/student-profile";
import { stateName } from "@/lib/states";
import { cn } from "@/lib/utils";

const FAMILY_LABEL: Readonly<Record<ConnectionFamily, string>> = { parent: "Parent", grandparent: "Grandparent", sibling: "Sibling" };
const FAMILY_ARIA: Readonly<Record<ConnectionFamily, string>> = {
  parent: "A parent went here",
  grandparent: "A grandparent went here",
  sibling: "A sibling went here",
};
const RECRUITED_SHORT: Readonly<Record<RecruitedPick, string>> = { none: "No", contact: "Coach contact", pre_read: "Pre-read", likely_letter: "Likely letter" };
const RECRUITED_LABELS: Readonly<Record<RecruitedPick, string>> = {
  none: "None",
  contact: "A coach has contacted me",
  pre_read: "I've had a positive pre-read",
  likely_letter: "I have a likely letter",
};

/**
 * One college on the Connections step (specs/planner/v3/connections.md "Adding one"): name and crest, ✕ to remove,
 * three family chips toggling independently, "Coach is recruiting me" opening the built picks, the summary line,
 * and the state-ban sentence under a marked family chip where one applies. `school` is the search index entry
 * (carries both state and type, so the ban line can show here rather than only on the Numbers form).
 */
export function ConnectionCard({
  entry,
  school,
  onChange,
  onRemove,
  disabled,
}: {
  entry: ConnectionEntry;
  school: SchoolIndexEntry | null;
  onChange: (next: ConnectionEntry) => void;
  onRemove: () => void;
  /** A guardian without edit access, or a save in flight. */
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const ban = school?.state && school.type ? banFor(school.state, sectorOf(school.type)) : null;
  const name = school?.name ?? entry.unitId;

  const toggleFamily = (f: ConnectionFamily) => {
    const family = entry.family.includes(f) ? entry.family.filter((x) => x !== f) : [...entry.family, f];
    onChange({ ...entry, family });
  };

  const pickRecruited = (pick: RecruitedPick) => {
    setPicking(false);
    onChange({ ...entry, recruited: pick === entry.recruited ? "none" : pick });
  };

  const recruitedChip = entry.recruited === "none" ? "Coach is recruiting me" : `Recruited · ${RECRUITED_SHORT[entry.recruited]}`;
  const summary = connectionSentence(entry);

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {school && <Crest id={school.id} name={school.name} size="sm" brand={school.brand} />}
          <span className="min-w-0 truncate font-semibold">{name}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${name}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-2">
        <FieldLabel>Who went here?</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {CONNECTION_FAMILIES.map((f) => (
            <Chip
              key={f}
              role="checkbox"
              selected={entry.family.includes(f)}
              onClick={() => toggleFamily(f)}
              disabled={disabled}
              ariaLabel={FAMILY_ARIA[f]}
              className="min-h-11"
            >
              {entry.family.includes(f) ? "✓ " : ""}
              {FAMILY_LABEL[f]}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            disabled={disabled}
            aria-expanded={picking}
            aria-label={`Coach recruiting at ${name}: ${RECRUITED_LABELS[entry.recruited]}`}
            className={cn(
              "inline-flex min-h-11 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-50",
              entry.recruited !== "none" ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {recruitedChip}
            <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", picking && "rotate-180")} aria-hidden />
          </button>
        </div>
        {picking && (
          <div className="flex flex-wrap gap-2 rounded-2xl bg-muted/60 p-2" role="radiogroup" aria-label={`Recruited by a coach at ${name}`}>
            {RECRUITED_PICKS.map((pick) => (
              <Chip key={pick} selected={entry.recruited === pick} onClick={() => pickRecruited(pick)} disabled={disabled} ariaLabel={RECRUITED_LABELS[pick]} className="min-h-11">
                {RECRUITED_SHORT[pick]}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      {entry.family.length > 0 && ban && (
        <p className="text-xs text-muted-foreground">
          {noteText({
            key: "hooks.legacy_banned",
            values: { state: stateName(ban.state), scope: ban.sectors.includes("public") && ban.sectors.includes("private") ? "all" : ban.sectors[0], law: ban.law },
          })}
        </p>
      )}
    </div>
  );
}
