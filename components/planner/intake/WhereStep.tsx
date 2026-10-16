"use client";

/**
 * Step 10, Where you'd go (specs/planner/record/steps.md): size, setting, and type chips, a states-or-regions
 * type-ahead that produces chips, the cost limit (one number, a parent's field), and early-round interest chips.
 */
import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { Headline } from "@/components/planner/intake/Headline";
import { maxCostCheck, placeLabel, type IntakeDraft } from "@/lib/planner/intake";
import { SETTING_CHIPS, SIZE_CHIPS } from "@/lib/planner/list-guide";
import { OUTSIDE_US, type EarlyRoundInterest } from "@/lib/student-profile";
import { STATES } from "@/lib/states";
import type { SchoolType } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The region names colleges are grouped into (lib/trend-groups.ts's own list); the territories read as a region here too. */
const REGIONS: readonly string[] = ["Northeast", "Southeast", "Midwest", "Southwest", "West", "Territories"];

const TYPE_OPTIONS: readonly { key: SchoolType; label: string }[] = [
  { key: "public", label: "Public" },
  { key: "private-nonprofit", label: "Private" },
  { key: "private-forprofit", label: "For-profit" },
];

const EARLY_OPTIONS: readonly { key: EarlyRoundInterest; label: string }[] = [
  { key: "ed", label: "ED" },
  { key: "ea", label: "EA" },
  { key: "none", label: "None yet" },
];

const ALL_STATES = [...STATES.values()];
const PLACE_CHOICES: readonly { code: string; label: string }[] = [
  { code: OUTSIDE_US, label: "Outside the US" },
  ...ALL_STATES.map((s) => ({ code: s.postal, label: s.name })),
  ...REGIONS.map((r) => ({ code: r, label: r })),
];

/** The states-or-regions type-ahead: typing filters states, DC, the territories, and the region names; picking adds a chip. */
function PlaceField({ picked, onAdd }: { picked: readonly string[]; onAdd: (code: string) => void }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const results = (q === "" ? PLACE_CHOICES : PLACE_CHOICES.filter((p) => p.label.toLowerCase().includes(q) || p.code.toLowerCase().startsWith(q)))
    .filter((p) => !picked.includes(p.code))
    .slice(0, 8);

  const pick = (code: string) => {
    onAdd(code);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const showList = open && results.length > 0;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && showList && results[active]) {
            e.preventDefault();
            pick(results[active].code);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="A state or a region (Northeast, Southeast, Midwest…)"
        className="h-12 w-full rounded-full border px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {showList && (
        <div id={listId} role="listbox" className="absolute inset-x-0 z-50 mt-1.5 max-h-64 overflow-auto rounded-2xl border bg-popover p-1.5 shadow-2xl shadow-black/10">
          {results.map((r, i) => (
            <button
              key={r.code}
              role="option"
              aria-selected={i === active}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r.code)}
              className={cn("block min-h-10 w-full rounded-xl px-2.5 py-2 text-left text-sm font-semibold", i === active ? "bg-accent" : "hover:bg-muted")}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WhereStep({ draft, setDraft }: { draft: IntakeDraft; setDraft: (next: IntakeDraft) => void }) {
  const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const cost = maxCostCheck(draft.maxAverageCost);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Headline lead="Where would you" pop="go?" />
        <p className="text-sm text-muted-foreground">Size, setting, places, and type; pick any that matter.</p>
      </div>

      <div className="space-y-2.5">
        <FieldLabel>Size</FieldLabel>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Size">
          {SIZE_CHIPS.map((c) => (
            <Chip key={c.key} role="checkbox" selected={draft.sizes.includes(c.key)} onClick={() => setDraft({ ...draft, sizes: toggle(draft.sizes, c.key) })} className="min-h-11 px-4">
              {c.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        <FieldLabel>Setting</FieldLabel>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Setting">
          {SETTING_CHIPS.map((c) => (
            <Chip
              key={c.key}
              role="checkbox"
              selected={draft.settings.includes(c.key)}
              onClick={() => setDraft({ ...draft, settings: toggle(draft.settings, c.key) })}
              className="min-h-11 px-4"
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        <FieldLabel>States or regions</FieldLabel>
        {draft.statesOrRegions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draft.statesOrRegions.map((p) => (
              <span key={p} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card px-3.5 text-sm font-semibold">
                {placeLabel(p)}
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, statesOrRegions: draft.statesOrRegions.filter((x) => x !== p) })}
                  aria-label={`Remove ${placeLabel(p)}`}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        <PlaceField picked={draft.statesOrRegions} onAdd={(code) => setDraft({ ...draft, statesOrRegions: [...draft.statesOrRegions, code] })} />
      </div>

      <div className="space-y-2.5">
        <FieldLabel>Public or private</FieldLabel>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Public or private">
          {TYPE_OPTIONS.map((o) => (
            <Chip key={o.key} role="checkbox" selected={draft.types.includes(o.key)} onClick={() => setDraft({ ...draft, types: toggle(draft.types, o.key) })} className="min-h-11 px-4">
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        <label htmlFor="intake-maxAverageCost" className="text-sm font-semibold">
          The most your family would pay in a year
        </label>
        <div className="relative w-full sm:w-56">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground">$</span>
          <input
            id="intake-maxAverageCost"
            type="text"
            inputMode="decimal"
            placeholder="35,000"
            value={draft.maxAverageCost}
            onChange={(e) => setDraft({ ...draft, maxAverageCost: e.target.value })}
            className="h-12 w-full rounded-full border pl-8 pr-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <p className={cn("text-sm", !cost.ok ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {cost.hint ?? "A parent can fill this in; compared with a college's average paid price."}
        </p>
      </div>

      <div className="space-y-2.5">
        <FieldLabel>Early-round interest</FieldLabel>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Early-round interest">
          {EARLY_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              selected={draft.earlyRoundInterest === o.key}
              onClick={() => setDraft({ ...draft, earlyRoundInterest: draft.earlyRoundInterest === o.key ? null : o.key })}
              className="min-h-11 px-4"
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

export default WhereStep;
