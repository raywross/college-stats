"use client";

import { useState, useTransition } from "react";
import { addToList } from "@/lib/lists";
import { acceptAllSuggestions, suggestCollege } from "@/lib/planner/store-list";

/**
 * Stage 1's two small mutations that don't belong to a single row (specs/planner/list-building.md): filling every
 * unsorted row with its suggestion at once, and the finding rail's Add (or, for a view-only guardian, Suggest)
 * button. Split out from `ListStage.tsx` only because they need client interactivity; the panel itself stays a
 * server component so it can read the dataset and compute the suggestions.
 */
export function AcceptAllButton({ listId }: { listId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await acceptAllSuggestions(listId);
        })
      }
      className="inline-flex h-9 items-center rounded-full border border-primary px-3.5 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
    >
      {pending ? "Sorting…" : "Accept all suggestions"}
    </button>
  );
}

/**
 * "Like this one" and "Fits my numbers/preferences" rail (list-building.md "Finding colleges to add"): a canEdit
 * viewer adds the college straight to the list; a view-only guardian's button suggests it instead ("Suggested by
 * {name}", added unsorted) — the same row either way once it lands, so there's no separate inbox to check.
 */
export function AddOrSuggestButton({ listId, unitId, canSuggestOnly }: { listId: string; unitId: string; canSuggestOnly: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<"idle" | "done" | "error">("idle");

  return (
    <button
      type="button"
      disabled={pending || result === "done"}
      onClick={() =>
        startTransition(async () => {
          const r = canSuggestOnly ? await suggestCollege(listId, unitId) : await addToList(listId, unitId);
          setResult(r.ok ? "done" : "error");
        })
      }
      className="inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60"
    >
      {result === "done" ? "Added" : canSuggestOnly ? "Suggest" : "Add"}
    </button>
  );
}
