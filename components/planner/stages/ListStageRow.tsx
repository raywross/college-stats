"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crest } from "@/components/school/Crest";
import { DreamStar } from "@/components/lists/DreamStar";
import { SourceTip, Term } from "@/components/ui/info-tip";
import { setCategory } from "@/lib/lists";
import { CATEGORY_LABELS, LIST_CATEGORIES, type ListCategory } from "@/lib/list-rules";
import { suggestionLabel, type SuggestResult } from "@/lib/planner/suggest";
import { pctSmart, moneyCompact } from "@/lib/format";
import { distanceLine } from "@/lib/home";
import { cn } from "@/lib/utils";

/**
 * One college on Stage 1's panel (specs/planner/list-building.md "Display": "rows grouped by category ... with
 * suggestion, Dream star, and the category chips"). Deliberately its own row, not `ListBoard`'s (which this
 * stage's rows are too compact for and which keeps its own "More"-first design): the facts, the suggestion with its
 * reason, the Dream star, and a quick category picker, so sorting the list is a few taps without opening anything.
 */
export function ListStageRow({
  itemId,
  unitId,
  name,
  brand,
  category,
  dream,
  dreamName,
  admitRate,
  avgCost,
  distanceMiles,
  suggestion,
  canEdit,
}: {
  itemId: string;
  unitId: string;
  name: string;
  brand?: Parameters<typeof Crest>[0]["brand"];
  category: ListCategory;
  dream: boolean;
  /** The current Dream's name, when it's a different college (for DreamStar's confirmation). */
  dreamName: string | null;
  admitRate: number | null;
  avgCost: number | null;
  distanceMiles: number | null;
  suggestion: SuggestResult;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Optimistic: the chip flips at once and the write follows; a refused write flips it back. The buttons stay
  // enabled while a write is in flight so sorting a list is a run of quick taps, not a wait per college.
  const [shown, setShown] = useState<ListCategory>(category);
  const [error, setError] = useState<string | null>(null);
  const pick = (c: ListCategory) => {
    const before = shown;
    setShown(c);
    setError(null);
    startTransition(async () => {
      const result = await setCategory(itemId, c);
      if (!result.ok) {
        setShown(before);
        setError(result.message);
        return;
      }
      router.refresh(); // the balance line and stage counts are server-rendered
    });
  };
  const facts = [admitRate !== null && `${pctSmart(admitRate)} admit`, avgCost !== null && `${moneyCompact(avgCost)}/yr`, distanceMiles !== null && distanceLine(distanceMiles)].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-2 p-3 sm:px-4">
      <Crest id={unitId} name={name} size="sm" brand={brand} />
      {/* basis-48: on phones the name block keeps a readable width and the chips wrap under it instead of squeezing it */}
      <div className="min-w-0 flex-1 basis-48">
        <Link href={`/schools/${unitId}`} className="font-display font-bold break-words hover:text-primary">
          {name}
        </Link>
        {facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>}
        {suggestion.category !== "none" && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Term term="suggested-category">Suggested</Term>: <span className="font-semibold text-foreground">{suggestionLabel(suggestion.category)}</span>
            {suggestion.reason && <> — {suggestion.reason}</>}
            {suggestion.cite && <SourceTip cited={suggestion.cite} className="ml-1" />}
          </p>
        )}
      </div>
      <DreamStar itemId={itemId} dream={dream} schoolName={name} currentDreamName={dreamName} canEdit={canEdit} />
      <div role="radiogroup" aria-label={`Category for ${name}`} className="flex shrink-0 flex-wrap gap-1">
        {LIST_CATEGORIES.filter((c) => c !== "unsorted").map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={shown === c}
            disabled={!canEdit}
            onClick={() => pick(c)}
            className={cn(
              "h-8 rounded-full border px-2.5 text-xs font-semibold disabled:opacity-60",
              shown === c ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      {error && <p className="basis-full text-xs text-destructive">{error}</p>}
    </li>
  );
}
