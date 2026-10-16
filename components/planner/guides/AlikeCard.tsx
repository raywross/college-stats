"use client";

/**
 * One college the Build your list guide offers (specs/planner/v3/guides/list-size.md "Card"): the crest, the name and
 * state linked to the college's profile in a new tab (so the guide isn't lost), the level chip ("Likely for you"; none
 * on the freshman view, which says nothing about levels), the likeness sentence ("Like Wake Forest: also private,
 * similar size, also Southeast"), the distance from home when known, and **Add** (the built `addToList`, then a
 * refresh so the shape row and the gaps update). A view-only guardian **Suggests** (the built `suggestCollege`).
 * Never a number from the estimate: the card's data has none (`AlikeCard` in lib/planner/list-guide.ts).
 */
import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { Crest } from "@/components/school/Crest";
import { STANDING_LEVEL_LABELS } from "@/lib/chances/levels";
import { addToList } from "@/lib/lists";
import { distanceText, type AlikeCard as AlikeCardData } from "@/lib/planner/list-guide";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { suggestCollege } from "@/lib/planner/store-list";
import { cn } from "@/lib/utils";

export function AlikeCard({
  card,
  listId,
  canEdit,
  onAdded,
}: {
  card: AlikeCardData;
  listId: string;
  /** Whether the viewer can edit the list (Add) or only suggest (Suggest). */
  canEdit: boolean;
  onAdded: (card: AlikeCardData) => void;
}) {
  const [state, setState] = useState<"idle" | "done" | { error: string }>("idle");
  const [pending, startTransition] = useTransition();

  function act() {
    startTransition(async () => {
      const result = canEdit ? await addToList(listId, card.unitId) : await suggestCollege(listId, card.unitId);
      if (!result.ok) {
        setState({ error: result.message });
        return;
      }
      setState("done");
      onAdded(card);
    });
  }

  const done = state === "done";
  return (
    <div className="flex w-[17rem] shrink-0 snap-start flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-border md:w-auto">
      <div className="flex items-start gap-3">
        <Crest id={card.unitId} name={card.name} size="sm" brand={card.brand as Parameters<typeof Crest>[0]["brand"]} />
        <a
          href={`/college/${card.unitId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group min-w-0 flex-1 text-sm font-semibold leading-snug hover:underline"
        >
          {card.name}
          {card.state && <span className="font-normal text-muted-foreground"> · {card.state}</span>}
          <ExternalLink className="ml-1 inline size-3 text-muted-foreground" aria-label="(opens in a new tab)" />
        </a>
      </div>
      {card.level && (
        <span className={cn("inline-flex h-6 w-fit items-center rounded-full px-2.5 text-xs font-bold", GROUP_CLASS[card.level])}>{STANDING_LEVEL_LABELS[card.level]} for you</span>
      )}
      {card.sentence && <p className="text-sm text-muted-foreground">{card.sentence}</p>}
      {card.distanceMiles !== null && <p className="text-xs text-muted-foreground">{distanceText(card.distanceMiles)}</p>}
      <div className="mt-auto flex items-center justify-end gap-2 pt-1">
        {typeof state === "object" && (
          <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
            {state.error}
          </p>
        )}
        <button
          type="button"
          disabled={pending || done}
          onClick={act}
          className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-60"
        >
          {done ? (canEdit ? "Added" : "Suggested") : pending ? (canEdit ? "Adding…" : "Sending…") : canEdit ? "+ Add" : "Suggest"}
        </button>
      </div>
    </div>
  );
}

export default AlikeCard;
