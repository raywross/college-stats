"use client";

/**
 * Step 9, Basics (specs/planner/record/steps.md): state of residence (a combobox over the state list, "Outside the
 * US"), fee-waiver eligible and first generation as Yes/No/Not sure chips (true/false/null).
 */
import { useId, useRef, useState } from "react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { Headline } from "@/components/planner/intake/Headline";
import { WhyFold } from "@/components/ui/why-fold";
import type { IntakeDraft } from "@/lib/planner/intake";
import { placeLabel } from "@/lib/planner/intake";
import { RECORD_STEPS } from "@/lib/planner/record";
import { OUTSIDE_US } from "@/lib/student-profile";
import { STATES } from "@/lib/states";
import { cn } from "@/lib/utils";

const ALL_STATES = [...STATES.values()];

/** A plain-text combobox over the 50 states, DC, the territories, and "Outside the US" — no network, filtered locally. */
function StateField({ value, onChange }: { value: string | null; onChange: (next: string | null) => void }) {
  const listId = useId();
  const [query, setQuery] = useState(value ? placeLabel(value) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const matchesState = (s: (typeof ALL_STATES)[number]) => s.name.toLowerCase().includes(q) || s.postal.toLowerCase().startsWith(q);
  const results: { code: string; label: string }[] = [
    ...(q === "" || "outside the us".includes(q) ? [{ code: OUTSIDE_US, label: "Outside the US" }] : []),
    ...ALL_STATES.filter(matchesState).map((s) => ({ code: s.postal, label: s.name })),
  ].slice(0, 8);

  const pick = (code: string, label: string) => {
    onChange(code);
    setQuery(label);
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
          if (value !== null) onChange(null);
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
            pick(results[active].code, results[active].label);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Start typing your state"
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
              onClick={() => pick(r.code, r.label)}
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

const YES_NO_NOT_SURE: { key: boolean | null; label: string }[] = [
  { key: true, label: "Yes" },
  { key: false, label: "No" },
  { key: null, label: "Not sure" },
];

export function BasicsStep({ draft, setDraft }: { draft: IntakeDraft; setDraft: (next: IntakeDraft) => void }) {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Headline lead="A few" pop="basics" />
          <WhyFold compact title="Why we ask" screen="record_tour" section="basics">
            {RECORD_STEPS[9].why}
          </WhyFold>
        </div>
        <p className="text-sm text-muted-foreground">{RECORD_STEPS[9].line}</p>
      </div>

      <div className="space-y-2.5">
        <FieldLabel>State of residence</FieldLabel>
        <StateField value={draft.stateOfResidence} onChange={(v) => setDraft({ ...draft, stateOfResidence: v })} />
        {!draft.stateOfResidence && draft.homeState && (
          // The estimate reads the household's address when no state is entered (owner, 2026-10-16); say so.
          <p className="text-sm text-muted-foreground">Using your household&apos;s address: {placeLabel(draft.homeState)}. Pick a state only if yours is different.</p>
        )}
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-1.5">
          <FieldLabel>Fee-waiver eligible?</FieldLabel>
          <WhyFold compact title="What counts as fee-waiver eligible" screen="record_tour" section="fee_waiver">
            The Common App/NACAC criteria: income near the federal poverty guideline, a federal program like free or reduced lunch, foster care or
            homelessness, or a counselor-signed waiver, among others.
          </WhyFold>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fee-waiver eligible">
          {YES_NO_NOT_SURE.map((o) => (
            <Chip key={String(o.key)} selected={draft.feeWaiverEligible === o.key} onClick={() => setDraft({ ...draft, feeWaiverEligible: o.key })} className="min-h-11 px-5">
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        <FieldLabel>First generation?</FieldLabel>
        <p className="text-sm text-muted-foreground">Neither of my parents finished a four-year degree.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="First generation">
          {YES_NO_NOT_SURE.map((o) => (
            <Chip key={String(o.key)} selected={draft.firstGeneration === o.key} onClick={() => setDraft({ ...draft, firstGeneration: o.key })} className="min-h-11 px-5">
              {o.label}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BasicsStep;
