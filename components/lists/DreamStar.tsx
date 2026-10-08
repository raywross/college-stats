"use client";

import { useTransition } from "react";
import { Star } from "lucide-react";
import { setDream } from "@/lib/planner/store";
import { cn } from "@/lib/utils";

/**
 * The Dream toggle (specs/planner/list-building.md "The Dream"): a filled star once set, a 44px target so it works
 * on a phone (specs/mobile.md). One per list; the database moves the star when another is marked (`setDream`,
 * lib/planner/store.ts), so this component just confirms before taking it from whichever college already has it —
 * `currentDreamName` is the only thing it needs to know about that college.
 */
export function DreamStar({
  itemId,
  dream,
  schoolName,
  currentDreamName,
  canEdit,
  className,
}: {
  itemId: string;
  dream: boolean;
  schoolName: string;
  /** The name of the college that currently has the Dream, when it isn't this one (for the confirmation). */
  currentDreamName?: string | null;
  canEdit: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return dream ? (
      <span className={cn("inline-flex size-11 items-center justify-center text-amber-500", className)} title={`${schoolName} is the Dream`} aria-label={`${schoolName} is the Dream`}>
        <Star className="size-5 fill-current" aria-hidden />
      </span>
    ) : null;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!dream && currentDreamName && !window.confirm(`Make ${schoolName} your Dream? ${currentDreamName} loses the star.`)) return;
        startTransition(async () => {
          await setDream(itemId, !dream);
        });
      }}
      aria-pressed={dream}
      aria-label={dream ? `${schoolName} is your Dream; tap to remove the star` : `Mark ${schoolName} as your Dream`}
      title={dream ? "Your Dream school" : "Mark as Dream"}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-500 disabled:opacity-60",
        dream && "text-amber-500",
        className,
      )}
    >
      <Star className={cn("size-5", dream && "fill-current")} aria-hidden />
    </button>
  );
}
