"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { Crest } from "@/components/school/Crest";
import { PlanRow } from "@/components/planner/PlanRow";
import { PlanNotice } from "@/components/planner/PlanNotice";
import type { PlanTabProps } from "@/components/planner/tabs/types";
import { addToList, removeFromList } from "@/lib/lists";
import { track } from "@/lib/analytics";
import { searchSchoolsApi } from "@/lib/school-api";
import type { SchoolIndexEntry } from "@/lib/dataset";
import { setPlanDream, setPlanRound } from "@/lib/planner/store-plan";
import { roundDates } from "@/lib/planner/rounds";
import type { PlanRowView } from "@/lib/planner/plan-view";
import { anySuggestedRound, headerCountsLine } from "@/lib/planner/list-row";
import { displayGroup, GROUP_CLASS, GROUP_LABEL } from "@/lib/planner/colors";
import type { DisplayGroup } from "@/lib/planner/colors";
import { STANDING_LEVELS } from "@/lib/chances/levels";
import type { ListRound } from "@/lib/list-rules";
import { cn } from "@/lib/utils";

/** list.md "Grouped by...": High reach, Reach, Target, Likely, Safe, then "Not sorted yet" (levels.md "Where the
 * levels show") — Quad's five-level estimate where the row has one, else its stored (pre-five-level) category
 * widened to this display set (lib/planner/colors.ts `displayGroup`). Empty sections are left out; `rows` is
 * assumed already ordered (Dream first, then by group, then list position), so each section keeps that order. */
const SECTION_ORDER: readonly DisplayGroup[] = [...STANDING_LEVELS, "unsorted"];

interface RowSection {
  group: DisplayGroup;
  rows: PlanRowView[];
}

function sectionedRows(rows: readonly PlanRowView[]): RowSection[] {
  const groupOf = (r: PlanRowView) => displayGroup(r.group, r.estimate?.group ?? null);
  return SECTION_ORDER.map((group) => ({ group, rows: rows.filter((r) => groupOf(r) === group) })).filter((g) => g.rows.length > 0);
}

/**
 * The Colleges tab: the list as the plan (specs/planner/redesign/list.md). Grouped by Reach / Target / Likely, then
 * "Not sorted yet" — Quad's groups only, no chip to cycle and no sort menu. Owns its own copy of the rows so every
 * tap (the Dream, the round chip, the drawer's remove) updates at once; a refused write rolls the row back and shows
 * an inline message, and a successful one refreshes the server page so the notices, balance line, and tasks that
 * depend on more than one row stay correct.
 */
export default function PlanList({ ctx, view }: PlanTabProps) {
  const router = useRouter();
  const [rows, setRows] = useState<PlanRowView[]>(view.rows);
  const [viewSeen, setViewSeen] = useState(view);
  const [errors, setErrors] = useState<Record<string, string>>({});
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

  async function handleRemove(row: PlanRowView) {
    const before = rows;
    setRowError(row.item.id, null);
    setRows((rs) => rs.filter((r) => r.item.id !== row.item.id));
    track("plan_college_removed", { dream: row.dream });
    const result = await removeFromList(row.item.id);
    if (!result.ok) {
      setRows(before);
      setRowError(row.item.id, result.message);
      return;
    }
    router.refresh();
  }

  const groups = sectionedRows(rows);
  const dreamRow = rows.find((r) => r.dream) ?? null;
  const suggestedRound = anySuggestedRound(rows);
  const firstName = ctx.student?.display_name?.trim().split(/\s+/)[0] || null;
  const addLabel = ctx.viewer.isGuardian && firstName ? `Add a college for ${firstName}` : "Add a college";

  return (
    <div className="space-y-4">
      <PlanNotice ctx={ctx} view={view} className="lg:hidden" />

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          <p>No colleges here yet.{canEdit ? " Add one below." : ""}</p>
          {ctx.viewer.isGuardian && ctx.student && ctx.student.user_id === null && (
            // A record the parent made that no account has claimed: colleges saved on the student's own account sit
            // on that account's list until the student accepts the household invitation (found in owner testing).
            <p className="mx-auto mt-2 max-w-md">
              {firstName || "Your student"} hasn&apos;t joined your household yet, so colleges saved on their own
              account don&apos;t show here. Send an invitation from{" "}
              <Link href="/household" className="font-semibold text-primary hover:underline">
                Household
              </Link>
              ; once it&apos;s accepted, their colleges appear here.
            </p>
          )}
        </div>
      ) : (
        <section className="overflow-hidden rounded-3xl border bg-card">
          <div className="hidden items-center justify-between gap-2 border-b px-4 py-3 lg:flex">
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              {headerCountsLine(rows)}
              {suggestedRound && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Sparkles className="size-3.5" aria-hidden /> suggested round
                </span>
              )}
            </p>
            <div className="flex items-center gap-10 pr-11 text-xs font-semibold text-muted-foreground">
              <span>Round</span>
              <span>Deadline</span>
              <span>Status</span>
            </div>
          </div>
          {!dreamRow && (
            <p className="border-b bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
              Mark a Dream if one college is your clear first choice; if it has early decision, your plan starts it there.
            </p>
          )}
          {groups.map(({ group, rows: groupRows }) => (
            <div key={group}>
              <div className="border-b px-4 py-3">
                <GroupHeading group={group} count={groupRows.length} />
              </div>
              <ul className="divide-y">
                {groupRows.map((row) => (
                  <PlanRow
                    key={row.item.id}
                    row={row}
                    ctx={ctx}
                    dreamName={dreamRow && dreamRow.item.id !== row.item.id ? (dreamRow.school?.name ?? null) : null}
                    error={errors[row.item.id] ?? null}
                    onToggleDream={handleDream}
                    onRound={handleRound}
                    onRemove={handleRemove}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {canEdit && <AddCollegeBox listId={ctx.list.id} excludeIds={rows.map((r) => r.item.unit_id)} label={addLabel} onAdded={() => router.refresh()} />}
    </div>
  );
}

/** list.md "Grouped by...": the section heading pill, High reach pink, Reach violet, Target sky, Likely emerald,
 * Safe green, "Not sorted yet" muted — calm tints, never a warning, with the group's count. */
function GroupHeading({ group, count }: { group: DisplayGroup; count: number }) {
  return (
    <p className={cn("inline-flex h-8 items-center rounded-full px-3 text-xs font-bold", GROUP_CLASS[group])}>
      {GROUP_LABEL[group]} · {count}
    </p>
  );
}

/** list.md "Around the list": a collapsed pill that expands into the search box; a new college arrives with its
 * group and round already filled (planView computes them live, and the next plan open stores them). */
function AddCollegeBox({ listId, excludeIds, label, onAdded }: { listId: string; excludeIds: string[]; label: string; onAdded: () => void }) {
  const [expanded, setExpanded] = useState(false);
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
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
