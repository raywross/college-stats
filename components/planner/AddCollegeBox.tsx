"use client";

import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Crest } from "@/components/school/Crest";
import { addToList } from "@/lib/lists";
import { searchSchoolsApi } from "@/lib/school-api";
import type { SchoolIndexEntry } from "@/lib/dataset";
import { cn } from "@/lib/utils";

/** list.md "Around the list": a collapsed pill that expands into the search box; a new college arrives with its
 * group and round already filled (planView computes them live, and the next plan open stores them). Shared by the
 * Colleges tab (components/planner/PlanList.tsx) and the Build your list guide's "Search any college"
 * (components/planner/guides/ListGuide.tsx), which opens it already expanded. */
export function AddCollegeBox({
  listId,
  excludeIds,
  label,
  onAdded,
  startExpanded = false,
}: {
  listId: string;
  excludeIds: string[];
  label: string;
  onAdded: (unitId: string) => void;
  startExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchoolIndexEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [addedId, setAddedId] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    searchSchoolsApi(q, { limit: 6, exclude: excludeIds, signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setResults(rows);
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const visibleResults = query.trim() ? results : [];

  const add = (unitId: string) => {
    startTransition(async () => {
      const result = await addToList(listId, unitId);
      if (result.ok) {
        setAddedId(unitId);
        setQuery("");
        setResults([]);
        setOpen(false);
        onAdded(unitId);
      }
    });
  };

  if (!expanded) {
    return (
      <button
        id="add-college"
        type="button"
        onClick={() => setExpanded(true)}
        className="flex h-11 w-full items-center justify-center rounded-full border border-dashed bg-card text-sm font-semibold text-primary hover:bg-muted/60"
      >
        + {label}
      </button>
    );
  }

  return (
    <div id="add-college" className="relative">
      <label className="flex h-11 items-center gap-2 rounded-full border bg-card px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Add a college…"
          className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm placeholder:text-muted-foreground"
          aria-label={label}
        />
        {pending && <span className="text-xs text-muted-foreground">Adding…</span>}
      </label>
      {open && visibleResults.length > 0 && (
        <div className="absolute inset-x-0 z-20 mt-1.5 overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-xl">
          {visibleResults.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={pending}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s.id)}
              className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-muted disabled:opacity-60", addedId === s.id && "opacity-60")}
            >
              <Crest id={s.id} name={s.name} size="sm" brand={s.brand} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.name}</span>
              <span className="text-xs text-muted-foreground">
                {s.city}, {s.state}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
