"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";
import { TRACKING_LABELS, trackingChips, trackingWrite, type ListItem, type TrackingKey, type TrackingWrite } from "@/lib/list-rules";
import { setFollowsSocial, setItemStatus, setOutcome, setUpdates, setVisited, type ListActionResult } from "@/lib/lists";
import { cn } from "@/lib/utils";

/** Chips whose label opens a glossary entry (the others are plain words). */
const CHIP_TERM: Partial<Record<TrackingKey, TermKey>> = { updates: "updates" };

type Tracked = Pick<ListItem, "id" | "updates" | "status" | "outcome" | "visited_on" | "follows_social">;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function visitedTitle(date: string | null): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date}T00:00:00`);
  return `Visited ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function runWrite(itemId: string, w: TrackingWrite): Promise<ListActionResult> {
  switch (w.action) {
    case "setUpdates":
      return setUpdates(itemId, w.value);
    case "setItemStatus":
      return setItemStatus(itemId, w.status);
    case "setVisited":
      return setVisited(itemId, w.date);
    case "setFollowsSocial":
      return setFollowsSocial(itemId, w.value);
    case "setOutcome":
      return setOutcome(itemId, w.outcome, w.date);
  }
}

/** The item as it would read after a write, so the chip flips at once (the server's refresh confirms it). */
function applyLocally(item: Tracked, w: TrackingWrite): Tracked {
  switch (w.action) {
    case "setUpdates":
      return { ...item, updates: w.value };
    case "setItemStatus":
      return { ...item, status: w.status, outcome: w.status === "decided" ? item.outcome : null };
    case "setVisited":
      return { ...item, visited_on: w.date };
    case "setFollowsSocial":
      return { ...item, follows_social: w.value };
    case "setOutcome":
      return { ...item, status: "decided", outcome: w.outcome };
  }
}

/**
 * The tracking row for a college on a list, inside the row's "More" since the redesign (specs/product/household-hub.md
 * "Display", "Redesign (2026-10-06)"): Updates · Applying ·
 * Visited · Following on social · Accepted, filled when on and outlined when off, wrapping to two lines on a phone.
 * Applying and Accepted write `status`/`outcome` through the list's own actions (lib/list-rules.ts trackingWrite);
 * Applying stays on, and can't be switched off here, once the status is Applied or Decided. Read-only without edit
 * access. Each chip is a label around a visually hidden checkbox, so a glossary <Term> inside it opens its tip
 * without toggling the chip.
 *
 * Visited and Following on social move to the planner's own controls (components/planner/row/actions.tsx:
 * the follow row and "Log a visit", specs/planner/actions.md "Display": "the tracking row's Visited and Following
 * switches become these, so there is one place"), so this row drops those two chips and keeps Updates, Applying,
 * and Accepted.
 */
export function TrackingRow({ item, canEdit, className }: { item: Tracked; canEdit: boolean; className?: string }) {
  const router = useRouter();
  const [local, setLocal] = useState<Tracked>(item);
  const [synced, setSynced] = useState<Tracked>(item);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Take the server's values when they change (after a refresh), without an effect.
  if (item !== synced) {
    setSynced(item);
    setLocal(item);
  }

  const toggle = (key: TrackingKey, turnOn: boolean) => {
    if (!canEdit) return;
    const w = trackingWrite(key, turnOn, todayIso());
    const before = local;
    setLocal(applyLocally(local, w));
    setError(null);
    startTransition(async () => {
      const result = await runWrite(item.id, w);
      if (!result.ok) {
        setLocal(before);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className={cn("mt-2", className)}>
      <ul className={cn("flex flex-wrap items-center gap-1.5", pending && "opacity-70")} aria-label="Tracking">
        {trackingChips(local)
          .filter((chip) => chip.key !== "visited" && chip.key !== "social")
          .map((chip) => {
          const term = CHIP_TERM[chip.key];
          const label = TRACKING_LABELS[chip.key];
          const disabled = !canEdit || chip.locked || pending;
          return (
            <li key={chip.key}>
              <label
                title={chip.key === "visited" ? visitedTitle(local.visited_on) : chip.locked ? "Change the status to switch this off" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors select-none",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  chip.on ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground",
                  disabled ? "cursor-default" : "cursor-pointer",
                  !disabled && !chip.on && "hover:border-primary/40 hover:text-foreground",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={chip.on}
                  disabled={disabled}
                  onChange={(e) => toggle(chip.key, e.target.checked)}
                />
                {chip.on && <Check className="size-3" aria-hidden />}
                {term ? (
                  <Term term={term} className={chip.on ? "decoration-primary-foreground/60" : undefined}>
                    {label}
                  </Term>
                ) : (
                  <span>{label}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
