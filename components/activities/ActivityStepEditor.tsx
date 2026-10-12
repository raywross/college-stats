"use client";
/**
 * One activity step's list and its adder (specs/planner/redesign/intake.md "Activities, four steps"): the cards for
 * the step's entries (`activitiesIn`), then a search like the AP step's for Sports and Clubs (popular chips before
 * anything is typed, catalog matches with acronyms, and "+ Add “…”" for anything else), or a name box with quick
 * chips for Work and Other. Adding opens the new card and folds the finished ones, so several can be added without
 * leaving the list. Controlled over the whole activities list (every step's entries), so the intake and `/me` share it.
 */
import { useState } from "react";
import { ActivityCard } from "@/components/activities/ActivityCard";
import { ACTIVITIES_MAX } from "@/lib/chances/levels";
import type { CatalogActivity } from "@/lib/chances/activity-catalog";
import {
  activitiesIn,
  activityFromCatalog,
  catalogEntryName,
  enterPick,
  searchStep,
  typedActivity,
  typedCandidate,
  type ActivityStep,
} from "@/lib/planner/activity-steps";
import type { ActivityEntry } from "@/lib/chances/types";
import { cn } from "@/lib/utils";

const PLACEHOLDER: Record<ActivityStep, string> = {
  sports: 'Add a sport — try "xc" or "lax"',
  clubs: 'Add a club — try "DECA" or "MUN"',
  work: "Add a job or internship",
  other: "Add something else",
};

/** Quick adds for steps without a catalog: one tap adds an entry with this name, open for editing. */
const QUICK: Partial<Record<ActivityStep, string[]>> = {
  work: ["Part-time job", "Internship", "Research position", "Family responsibilities"],
  other: ["Volunteering", "Independent project"],
};

export function ActivityStepEditor({
  step,
  activities,
  onChange,
  classYear,
  layout = "intake",
  disabled,
}: {
  step: ActivityStep;
  /** Every activity (all steps); only this step's are shown, and changes keep the others in place. */
  activities: ActivityEntry[];
  onChange: (next: ActivityEntry[]) => void;
  classYear: number | null;
  /** "intake": on desktop the adder sits in a side panel beside the list, like the AP step. "profile": stacked. */
  layout?: "intake" | "profile";
  disabled?: boolean;
}) {
  const mine = activitiesIn(activities, step);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(mine.filter((a) => a.years.length === 0).map((a) => a.id)));
  const room = ACTIVITIES_MAX - activities.length;

  const update = (id: string, next: ActivityEntry) => onChange(activities.map((a) => (a.id === id ? next : a)));
  const remove = (id: string) => onChange(activities.filter((a) => a.id !== id));
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const add = (entry: ActivityEntry) => {
    if (room <= 0) return;
    onChange([...activities, entry]);
    // The new card opens; finished ones fold so the list stays short while adding several.
    setOpenIds(new Set([...mine.filter((a) => a.years.length === 0).map((a) => a.id), entry.id]));
  };

  const adder = (
    <Adder step={step} existing={mine} room={room} disabled={disabled} onAdd={add} />
  );

  return (
    <div className={cn(layout === "intake" && "lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-8")}>
      <div className="space-y-3">
        {mine.map((a) => (
          <ActivityCard
            key={a.id}
            value={a}
            step={step}
            classYear={classYear}
            open={openIds.has(a.id)}
            onToggleOpen={() => toggle(a.id)}
            onChange={(next) => update(a.id, next)}
            onRemove={() => remove(a.id)}
            disabled={disabled}
          />
        ))}
        <div className={cn(layout === "intake" && "lg:hidden")}>{adder}</div>
      </div>
      {layout === "intake" && <div className="hidden rounded-3xl border bg-card p-4 lg:block">{adder}</div>}
    </div>
  );
}

function Adder({
  step,
  existing,
  room,
  disabled,
  onAdd,
}: {
  step: ActivityStep;
  existing: ActivityEntry[];
  room: number;
  disabled?: boolean;
  onAdd: (entry: ActivityEntry) => void;
}) {
  const [query, setQuery] = useState("");
  if (room <= 0) return <p className="text-sm text-muted-foreground">That&apos;s the most activities a profile holds ({ACTIVITIES_MAX}). Remove one to add another.</p>;

  const searchable = step === "sports" || step === "clubs";
  const exclude = existing.flatMap((a) => (a.catalogKey ? [a.catalogKey] : []));
  const matches: CatalogActivity[] = searchable ? searchStep(step, query, exclude) : [];
  const typed = typedCandidate(query, matches);
  const hasQuery = query.trim() !== "";

  const addCatalog = (c: CatalogActivity) => {
    onAdd(activityFromCatalog(c));
    setQuery("");
  };
  const addTyped = (name: string) => {
    if (!name.trim()) return;
    onAdd(typedActivity(step, name));
    setQuery("");
  };
  const onEnter = () => {
    if (!searchable) return addTyped(query);
    const pick = enterPick(query, matches);
    if (pick === null) return;
    if (typeof pick === "string") addTyped(pick);
    else addCatalog(pick);
  };

  return (
    <div className="space-y-3">
      <div className={cn(!searchable && "flex gap-2")}>
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Inside /me's form, Enter would submit the whole profile: it adds here instead.
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter();
              }
            }}
            placeholder={PLACEHOLDER[step]}
            aria-label={PLACEHOLDER[step]}
            enterKeyHint="done"
            className="h-12 w-full rounded-full border bg-background pl-9 pr-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 lg:text-sm"
          />
          <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">+</span>
        </div>
        {!searchable && (
          <button
            type="button"
            disabled={disabled || !hasQuery}
            onClick={() => addTyped(query)}
            className="h-12 shrink-0 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Add
          </button>
        )}
      </div>

      {searchable ? (
        <>
          <p className="text-xs font-semibold text-muted-foreground">{hasQuery ? "Matches" : "Popular"}</p>
          <div className="flex flex-wrap gap-2">
            {matches.map((m) => (
              <AddChip key={m.key} disabled={disabled} onClick={() => addCatalog(m)}>
                {catalogEntryName(m)}
              </AddChip>
            ))}
            {typed && (
              <AddChip disabled={disabled} onClick={() => addTyped(typed)} strong>
                Add &ldquo;{typed}&rdquo;
              </AddChip>
            )}
          </div>
          {hasQuery && matches.length === 0 && <p className="text-xs text-muted-foreground">Not in our list? Add it as typed{step === "clubs" ? ", then pick what it's about." : "."}</p>}
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(QUICK[step] ?? []).map((name) => (
            <AddChip key={name} disabled={disabled} onClick={() => addTyped(name)}>
              {name}
            </AddChip>
          ))}
        </div>
      )}
    </div>
  );
}

function AddChip({ children, onClick, disabled, strong }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; strong?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-10 max-w-full truncate rounded-full border border-dashed px-3.5 text-left text-sm font-semibold hover:border-foreground hover:text-foreground disabled:opacity-50",
        strong ? "border-foreground text-foreground" : "text-muted-foreground",
      )}
    >
      + {children}
    </button>
  );
}
