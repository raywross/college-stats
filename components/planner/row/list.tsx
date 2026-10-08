"use client";

import { SourceTip, Term } from "@/components/ui/info-tip";
import { DreamStar } from "@/components/lists/DreamStar";
import { suggestCategory, suggestionLabel } from "@/lib/planner/suggest";
import type { RowControlProps } from "@/components/planner/row/props";

/**
 * Stage 1's row controls (specs/planner/list-building.md "Display": "the Dream star + suggestion line inside the
 * list row's More"): the Dream toggle and, when the row isn't already the Dream's own college, the suggested
 * category with its reason (`suggestCategory`, lib/planner/suggest.ts), cited the same way the profile pages cite a
 * number. A guardian's own list has no `profile` (no numbers), so it shows the Dream star only, no suggestion.
 */
export default function ListRowControls({ item, school, canEdit, profile }: RowControlProps) {
  const suggestion = suggestCategory(school, profile ?? null);
  const showSuggestion = suggestion.category !== "none" && suggestion.category !== item.category;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DreamStar itemId={item.id} dream={Boolean(item.dream)} schoolName={school.name} canEdit={canEdit} className="-ml-2" />
      {item.dream && <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Dream</span>}
      {showSuggestion && (
        <p className="text-xs text-muted-foreground">
          <Term term="suggested-category">Suggested</Term>: <span className="font-semibold text-foreground">{suggestionLabel(suggestion.category)}</span>
          {suggestion.reason && <> — {suggestion.reason}</>}
          {suggestion.cite && <SourceTip cited={suggestion.cite} className="ml-1" />}
        </p>
      )}
    </div>
  );
}
