"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Crest } from "@/components/school/Crest";
import { track } from "@/lib/analytics";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { GROUP_HEADING } from "@/lib/planner/list-row";
import { recordPageHref } from "@/lib/planner/record";
import { addToList } from "@/lib/lists";
import { searchSchoolsApi } from "@/lib/school-api";
import type { StandingLevel } from "@/lib/chances/types";
import type { SchoolIndexEntry } from "@/lib/dataset";
import { cn } from "@/lib/utils";

/** POST /api/plan/levels (specs/planner/record/reading.md "Beside a college you might add"): the level a live
 * estimate would give each result, once per result set (the same request the search already debounces, not a
 * separate timer). Swallows its own errors — a chip is a nice-to-have, never a reason the search itself fails. */
function fetchLevels(studentId: string, unitIds: string[], signal: AbortSignal): Promise<{ levels: Record<string, StandingLevel | null>; sorted: boolean } | null> {
  return fetch("/api/plan/levels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, unitIds: unitIds.slice(0, 12) }),
    signal,
  })
    .then((res) => (res.ok ? (res.json() as Promise<{ levels: Record<string, StandingLevel | null>; sorted: boolean }>) : null))
    .catch(() => null);
}

/** list.md "Around the list": a collapsed pill that expands into the search box; a new college arrives with its
 * group and round already filled (planView computes them live, and the next plan open stores them). Shared by the
 * Colleges tab (components/planner/PlanList.tsx) and the Build your list guide's "Search any college"
 * (components/planner/guides/ListGuide.tsx), which opens it already expanded.
 *
 * `studentId` (reading.md "Beside a college you might add"): with it, each result also carries a live level chip
 * ("Target for you"), fetched once per result set; without it (a guardian without the student's id yet, or a
 * context that hasn't wired it through) the box works exactly as before, with no chip.
 */
export function AddCollegeBox({
  listId,
  excludeIds,
  label,
  onAdded,
  startExpanded = false,
  studentId = null,
}: {
  listId: string;
  excludeIds: string[];
  label: string;
  onAdded: (unitId: string) => void;
  startExpanded?: boolean;
  studentId?: string | null;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchoolIndexEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [addedId, setAddedId] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, StandingLevel | null>>({});
  const [sorted, setSorted] = useState(true);
  const shownLevels = useRef(new Set<string>());

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    searchSchoolsApi(q, { limit: 6, exclude: excludeIds, signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return;
        setResults(rows);
        if (!studentId || rows.length === 0) {
          setLevels({});
          setSorted(true);
          return;
        }
        fetchLevels(studentId, rows.map((r) => r.id), controller.signal).then((data) => {
          if (!data || controller.signal.aborted) return;
          setLevels(data.levels);
          setSorted(data.sorted);
          for (const r of rows) {
            const level = data.levels[r.id];
            // Once per result set: a key of the ids and the level, so a re-render of the same answer never retriggers it.
            const key = `${r.id}:${level ?? "none"}`;
            if (level && !shownLevels.current.has(key)) {
              shownLevels.current.add(key);
              track("plan_add_level_shown", { level });
            }
          }
        });
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, studentId]);
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
          {visibleResults.map((s) => {
            const level = levels[s.id];
            return (
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
                {studentId && level && (
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", GROUP_CLASS[level])}>{GROUP_HEADING[level]} for you</span>
                )}
              </button>
            );
          })}
          {studentId && !sorted && (
            <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
              Add your grades and Quad sorts these for you.{" "}
              <Link href={recordPageHref(studentId)} className="font-semibold text-primary hover:underline" onMouseDown={(e) => e.preventDefault()}>
                Add your grades
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
