"use client";
/**
 * Awards on the intake's Other step and `/me` (inputs-beyond-academics.md "Awards"): a type-ahead over the reviewed
 * awards catalog (popular chips before anything is typed; "nmsf", "eagle", "aime" work), "+ Add “…”" for one that
 * isn't listed, and one compact card per award: its tier (the catalog's, or a pick for a typed one) and a one-tap year.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { AWARDS_MAX } from "@/lib/chances/levels";
import type { AwardEntry, HsYear } from "@/lib/chances/types";
import { AWARD_TIER_CHOICES, awardFromCatalog, awardSummary, searchAwards, tierLabel, typedAward, yearChips } from "@/lib/planner/activity-steps";
import { cn } from "@/lib/utils";

export function AwardsEditor({
  awards,
  onChange,
  classYear,
  layout = "intake",
  disabled,
}: {
  awards: AwardEntry[];
  onChange: (next: AwardEntry[]) => void;
  classYear: number | null;
  layout?: "intake" | "profile";
  disabled?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const room = AWARDS_MAX - awards.length;
  const update = (id: string, next: AwardEntry) => onChange(awards.map((a) => (a.id === id ? next : a)));
  const add = (a: AwardEntry) => {
    if (room <= 0) return;
    onChange([...awards, a]);
    setOpenId(a.id);
  };
  const adder = <AwardAdder awards={awards} room={room} disabled={disabled} onAdd={add} />;

  return (
    <div className={cn(layout === "intake" && "lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-8")}>
      <div className="space-y-3">
        {awards.map((a) => (
          <AwardCard
            key={a.id}
            value={a}
            classYear={classYear}
            open={openId === a.id}
            onToggleOpen={() => setOpenId((cur) => (cur === a.id ? null : a.id))}
            onChange={(next) => update(a.id, next)}
            onRemove={() => onChange(awards.filter((x) => x.id !== a.id))}
            disabled={disabled}
          />
        ))}
        <div className={cn(layout === "intake" && "lg:hidden")}>{adder}</div>
      </div>
      {layout === "intake" && <div className="hidden rounded-3xl border bg-card p-4 lg:block">{adder}</div>}
    </div>
  );
}

function AwardCard({
  value,
  classYear,
  open,
  onToggleOpen,
  onChange,
  onRemove,
  disabled,
}: {
  value: AwardEntry;
  classYear: number | null;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: AwardEntry) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const name = value.name.trim() || "Untitled award";
  return (
    <div className={cn("rounded-2xl border bg-card p-3.5 sm:p-4", open && "border-primary")}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onToggleOpen} aria-expanded={open} className="min-h-11 min-w-0 flex-1 rounded-xl py-1 text-left font-semibold">
          <span className="line-clamp-2">{name}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onToggleOpen} className="inline-flex h-9 items-center rounded-full bg-muted px-3 text-sm font-semibold">
            {awardSummary(value)}
          </button>
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
      </div>
      {open && (
        <div className="mt-3 space-y-4 border-t pt-3">
          {value.key === null ? (
            <>
              <label className="block space-y-1.5">
                <FieldLabel>Award name</FieldLabel>
                <input
                  type="text"
                  value={value.name}
                  maxLength={60}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...value, name: e.currentTarget.value })}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                />
              </label>
              <div className="space-y-1.5">
                <FieldLabel>Level</FieldLabel>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Level">
                  {AWARD_TIER_CHOICES.map((t) => (
                    <Chip key={t.tier} selected={value.tier === t.tier} disabled={disabled} onClick={() => onChange({ ...value, tier: t.tier })}>
                      {t.label}
                    </Chip>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{tierLabel(value.tier)} recognition.</p>
          )}
          <div className="space-y-1.5">
            <FieldLabel>Which year? (optional)</FieldLabel>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Which year">
              {yearChips(classYear).map((c) => (
                <Chip
                  key={c.year}
                  selected={value.year === c.year}
                  disabled={disabled}
                  className="rounded-xl px-1"
                  onClick={() => onChange({ ...value, year: value.year === c.year ? null : (c.year as HsYear) })}
                >
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onToggleOpen} className="min-h-10 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AwardAdder({ awards, room, disabled, onAdd }: { awards: AwardEntry[]; room: number; disabled?: boolean; onAdd: (a: AwardEntry) => void }) {
  const [query, setQuery] = useState("");
  if (room <= 0) return <p className="text-sm text-muted-foreground">That&apos;s the most awards a profile holds ({AWARDS_MAX}).</p>;
  const matches = searchAwards(query, awards.flatMap((a) => (a.key ? [a.key] : [])));
  const q = query.trim();
  const typed = q && !matches.some((m) => m.name.toLowerCase() === q.toLowerCase()) ? q.slice(0, 60) : null;
  const done = () => setQuery("");
  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches[0] && q) onAdd(awardFromCatalog(matches[0]));
              else if (typed) onAdd(typedAward(typed));
              done();
            }
          }}
          placeholder='Add an award — try "AP Scholar"'
          aria-label="Add an award"
          enterKeyHint="done"
          className="h-12 w-full rounded-full border bg-background pl-9 pr-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 lg:text-sm"
        />
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">+</span>
      </div>
      <p className="text-xs font-semibold text-muted-foreground">{q ? "Matches" : "Popular"}</p>
      <div className="flex flex-wrap gap-2">
        {matches.map((m) => (
          <button
            key={m.key}
            type="button"
            disabled={disabled}
            onClick={() => {
              onAdd(awardFromCatalog(m));
              done();
            }}
            className="min-h-10 max-w-full truncate rounded-full border border-dashed px-3.5 text-left text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            + {m.name}
          </button>
        ))}
        {typed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onAdd(typedAward(typed));
              done();
            }}
            className="min-h-10 max-w-full truncate rounded-full border border-dashed border-foreground px-3.5 text-left text-sm font-semibold"
          >
            + Add &ldquo;{typed}&rdquo;
          </button>
        )}
      </div>
    </div>
  );
}
