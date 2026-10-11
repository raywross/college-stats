"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { Crest } from "@/components/school/Crest";
import { PlanRow } from "@/components/planner/PlanRow";
import { ListNotices } from "@/components/planner/ListNotices";
import type { PlanTabProps } from "@/components/planner/tabs/types";
import { addToList } from "@/lib/lists";
import { track } from "@/lib/analytics";
import { searchSchoolsApi } from "@/lib/school-api";
import type { SchoolIndexEntry } from "@/lib/dataset";
import { setGroup, setPlanDream, setPlanRound } from "@/lib/planner/store-plan";
import type { PickedGroup } from "@/lib/planner/plan-writes";
import { roundDates } from "@/lib/planner/rounds";
import type { PlanRowView } from "@/lib/planner/plan-view";
import { anySuggested, headerCountsLine, ROW_SORT_OPTIONS, sortRows, type RowSort } from "@/lib/planner/list-row";
import type { ListRound } from "@/lib/list-rules";
import { cn } from "@/lib/utils";

/**
 * The Colleges tab: the list as the plan (specs/planner/redesign/list.md). Owns its own copy of the rows so every
 * tap (the Dream, the group chip, the round chip) updates at once; a refused write rolls the row back and shows an
 * inline message, and a successful one refreshes the server page so the notices, balance line, and tasks that
 * depend on more than one row stay correct.
 */
export default function PlanList({ ctx, view }: PlanTabProps) {
  const router = useRouter();
  const [rows, setRows] = useState<PlanRowView[]>(view.rows);
  const [viewSeen, setViewSeen] = useState(view);
  const [sort, setSort] = useState<RowSort>("default");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [edTwoPending, startEdTwo] = useTransition();
  const canEdit = ctx.viewer.canEdit;

  // The server's view (a refresh, a different child, a data publish) replaces whatever's local. Resetting state
  // during render (rather than in an effect) avoids an extra render each time the view changes.
  if (view !== viewSeen) {
    setViewSeen(view);
    setRows(view.rows);
  }

  const setRowError = (id: string, message: string | null) =>
    setErrors((e) => {
      if (message) return { ...e, [id]: message };
      if (!(id in e)) return e;
      const rest = { ...e };
      delete rest[id];
      return rest;
    });

  const patch = (id: string, p: Partial<PlanRowView>) => setRows((rs) => rs.map((r) => (r.item.id === id ? { ...r, ...p } : r)));

  async function handleDream(row: PlanRowView) {
    const before = rows;
    const next = !row.dream;
    setRowError(row.item.id, null);
    setRows((rs) => rs.map((r) => (r.item.id === row.item.id ? { ...r, dream: next } : next && r.dream ? { ...r, dream: false } : r)));
    track("plan_dream_set", { on: next });
    const result = await setPlanDream(row.item.id, next);
    if (!result.ok) {
      setRows(before);
      setRowError(row.item.id, result.message);
      return;
    }
    router.refresh();
  }

  async function handleGroup(row: PlanRowView, group: PickedGroup | null) {
    const before = rows;
    setRowError(row.item.id, null);
    patch(row.item.id, { group: group ?? row.standing?.fit ?? "unsorted", groupAuto: group === null });
    track("plan_group_changed", { from_auto: row.groupAuto });
    const result = await setGroup(row.item.id, group);
    if (!result.ok) {
      setRows(before);
      setRowError(row.item.id, result.message);
      return;
    }
    router.refresh();
  }

  async function handleRound(row: PlanRowView, round: ListRound | null) {
    const before = rows;
    setRowError(row.item.id, null);
    if (round) {
      // The closing/notification dates for immediate feedback; the citation's edition is left as the server last
      // had it (null here) until router.refresh() below replaces this row with the authoritative one.
      const dates = row.school ? roundDates(row.school, round) : null;
      patch(row.item.id, {
        round,
        roundAuto: false,
        deadline: dates?.closing ? { iso: dates.closing.iso, field: dates.closing.field, edition: null, lastCycle: false } : null,
        decision: dates?.notification ? { iso: dates.notification.iso, field: dates.notification.field } : null,
      });
    } else {
      patch(row.item.id, { roundAuto: true });
    }
    track("plan_round_changed", { from_auto: row.roundAuto, round: round ?? row.round });
    const result = await setPlanRound(row.item.id, round);
    if (!result.ok) {
      setRows(before);
      setRowError(row.item.id, result.message);
      return;
    }
    router.refresh();
  }

  function handleUseEdTwo(itemId: string) {
    const dreamRound = rows.find((r) => r.dream)?.round === "rea" ? "rea" : "ed";
    startEdTwo(async () => {
      track("plan_ed2_offer_used", { dream_round: dreamRound });
      const result = await setPlanRound(itemId, "ed2");
      if (result.ok) router.refresh();
    });
  }

  const ordered = sortRows(rows, sort);
  const dreamRow = rows.find((r) => r.dream) ?? null;

  return (
    <div className="space-y-4">
      <ListNotices view={view} onUseEdTwo={handleUseEdTwo} edTwoPending={edTwoPending} />

      {rows.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No colleges here yet. Add one below.</p>
      ) : (
        <section className="overflow-hidden rounded-3xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">{headerCountsLine(rows)}</p>
            <div className="flex items-center gap-3">
              {anySuggested(rows) && (
                <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5" aria-hidden /> = sorted for you; tap to change
                </p>
              )}
              {rows.length > 1 && (
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  Sort
                  <select value={sort} onChange={(e) => setSort(e.target.value as RowSort)} className="h-8 rounded-full border bg-background px-2 text-xs font-semibold text-foreground">
                    {ROW_SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
          {!dreamRow && (
            <p className="border-b bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
              Mark a Dream if one college is your clear first choice; if it has early decision, your plan starts it there.
            </p>
          )}
          <ul className="divide-y">
            {ordered.map((row) => (
              <PlanRow
                key={row.item.id}
                row={row}
                ctx={ctx}
                dreamName={dreamRow && dreamRow.item.id !== row.item.id ? (dreamRow.school?.name ?? null) : null}
                error={errors[row.item.id] ?? null}
                onToggleDream={handleDream}
                onGroup={handleGroup}
                onRound={handleRound}
              />
            ))}
          </ul>
        </section>
      )}

      {canEdit && <AddCollegeBox listId={ctx.list.id} excludeIds={rows.map((r) => r.item.unit_id)} onAdded={() => router.refresh()} />}
    </div>
  );
}

/** list.md "Around the list": the search box at the bottom; a new college arrives with its group and round already
 * filled (planView computes them live, and the next plan open stores them). */
function AddCollegeBox({ listId, excludeIds, onAdded }: { listId: string; excludeIds: string[]; onAdded: () => void }) {
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
        onAdded();
      }
    });
  };

  return (
    <div className="relative">
      <label className="flex h-11 items-center gap-2 rounded-full border bg-card px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Add a college…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label="Add a college to your list"
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
