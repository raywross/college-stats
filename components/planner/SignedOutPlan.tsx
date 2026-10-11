"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Heart, Search } from "lucide-react";
import { useLocalProfile } from "@/components/me/useLocalProfile";
import { useNumbersDraft, NumbersFields } from "@/components/planner/NumbersForm";
import { LocalCoursesSheet } from "@/components/profile/LocalCoursesSheet";
import { Crest } from "@/components/school/Crest";
import { Term, SourceTip } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import { loginHref } from "@/lib/accounts";
import type { CrestBrand } from "@/lib/brand";
import type { AnyCited } from "@/lib/lineage";
import { CATEGORY_LABELS, type ListCategory, type ListRound } from "@/lib/list-rules";
import { GROUP_CLASS, ROUND_VAR, STRIPED } from "@/lib/planner/colors";
import {
  addLocalCollege,
  getLocalPlan,
  type LocalPlan,
  MAX_LOCAL_COLLEGES,
  planItemsFor,
  removeLocalCollege,
  setLocalDream,
  setLocalGroup,
  setLocalPlan,
  setLocalRound,
  subscribeLocalPlan,
} from "@/lib/planner/local-plan";
import { dayLabel, isPastDeadline, nextGroup, roundOptionLabel } from "@/lib/planner/list-row";
import { planView, type PlanRowView } from "@/lib/planner/plan-view";
import { applyNumbers } from "@/lib/planner/plan-writes";
import { roundDates } from "@/lib/planner/rounds";
import type { PickedGroup } from "@/lib/planner/plan-writes";
import type { PlanSchool } from "@/lib/planner/types";
import { searchSchoolsApi } from "@/lib/school-api";
import type { SchoolIndexEntry } from "@/lib/dataset";
import { emptyProfile } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

const TODAY = () => new Date().toISOString().slice(0, 10);
/** The server snapshot must be the same object every call, or React warns of an infinite loop (browser QA 2026-10-10). */
const EMPTY_LOCAL_PLAN: LocalPlan = { unitIds: [], dream: null, groups: {}, rounds: {} };
const emptyLocalPlan = (): LocalPlan => EMPTY_LOCAL_PLAN;

/* ------------------------------------------------------------------ */
/* The pitch's looping re-sort (decorative; prefers-reduced-motion     */
/* freezes it via app/globals.css's universal animation-duration rule) */
/* ------------------------------------------------------------------ */

const PITCH_ROWS: { name: string; group: Exclude<ListCategory, "unsorted"> }[] = [
  { name: "Eastbrook University", group: "likely" },
  { name: "Example College", group: "target" },
  { name: "Dream State", group: "reach" },
];

function PitchAnimation() {
  return (
    <div aria-hidden className="relative h-[136px] overflow-hidden rounded-2xl border bg-muted/30" style={{ "--sop-h": "44px" } as React.CSSProperties}>
      <style>{`
        @keyframes sop-cycle {
          0%, 22% { transform: translateY(0); }
          33%, 55% { transform: translateY(var(--sop-h)); }
          66%, 88% { transform: translateY(calc(var(--sop-h) * 2)); }
          100% { transform: translateY(0); }
        }
        .sop-row { animation: sop-cycle 9s ease-in-out infinite; }
      `}</style>
      {PITCH_ROWS.map((r, i) => (
        <div
          key={r.name}
          className="sop-row absolute inset-x-2 top-2 flex h-9 items-center justify-between rounded-xl border bg-card px-3 text-xs font-semibold shadow-sm"
          style={{ animationDelay: `${-(i * 3)}s` }}
        >
          <span className="truncate">{r.name}</span>
          <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] font-bold", GROUP_CLASS[r.group])}>{CATEGORY_LABELS[r.group]}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add colleges from search (local only; no server action)             */
/* ------------------------------------------------------------------ */

function AddCollegeBox({ excludeIds, full, onAdd }: { excludeIds: string[]; full: boolean; onAdd: (unitId: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchoolIndexEntry[]>([]);
  const [open, setOpen] = useState(false);

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

  if (full) {
    return <p className="rounded-full border bg-muted/40 px-4 py-2.5 text-center text-sm text-muted-foreground">You&apos;ve added {MAX_LOCAL_COLLEGES} colleges — sign up to add more.</p>;
  }

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
          aria-label="Add a college to your plan"
        />
      </label>
      {open && visibleResults.length > 0 && (
        <div className="absolute inset-x-0 z-20 mt-1.5 overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-xl">
          {visibleResults.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAdd(s.id);
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-muted"
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

/* ------------------------------------------------------------------ */
/* One row: heart, group and round chips (local state only)           */
/* ------------------------------------------------------------------ */

function LocalRow({
  row,
  today,
  onToggleDream,
  onGroup,
  onRound,
  onRemove,
}: {
  row: PlanRowView;
  today: string;
  onToggleDream: () => void;
  onGroup: (group: PickedGroup | null) => void;
  onRound: (round: ListRound | null) => void;
  onRemove: () => void;
}) {
  const { item, school, deadline } = row;
  const name = school?.name ?? item.unit_id;
  const past = isPastDeadline(deadline?.iso ?? null, today);
  const dates: Record<ListRound, string | null> = Object.fromEntries(row.pickable.map((r) => [r, school ? roundDates(school, r).closing?.iso ?? null : null])) as Record<ListRound, string | null>;
  const deadlineCite = deadline ? school?.cites[deadline.field] : undefined;

  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] sm:px-4">
      <button
        type="button"
        onClick={onToggleDream}
        aria-pressed={row.dream}
        aria-label={row.dream ? `${name} is your Dream; tap to remove the heart` : `Mark ${name} as your Dream`}
        title={row.dream ? "Your Dream" : "Mark as Dream"}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-muted"
      >
        <Heart className={cn("size-5", row.dream && "fill-rose-500 text-rose-500")} aria-hidden />
      </button>

      <div className="min-w-0">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {school && <Crest id={school.unit_id} name={school.name} size="xs" brand={school.brand as CrestBrand | undefined} />}
          <span className="min-w-0 truncate">{name}</span>
        </span>
        {row.dream && (
          <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
            <Term term="dream-school">Dream</Term>
          </p>
        )}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:contents">
        {row.group === "unsorted" ? (
          <span className="inline-flex h-8 shrink-0 items-center rounded-full bg-muted px-3 text-xs font-semibold text-muted-foreground">Add a number</span>
        ) : (
          <button
            type="button"
            onClick={() => onGroup(nextGroup(row.group))}
            title={row.groupAuto ? "Sorted for you; tap to change" : "You picked this group"}
            aria-label={`${CATEGORY_LABELS[row.group]}${row.groupAuto ? ", sorted for you; tap to change" : ", your pick"}`}
            className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-bold", GROUP_CLASS[row.group])}
          >
            {CATEGORY_LABELS[row.group]}
          </button>
        )}

        <label className="relative inline-flex h-11 shrink-0 items-center">
          <span className="sr-only">Round</span>
          <span
            aria-hidden
            className={cn("pointer-events-none absolute left-2.5 size-2.5 rounded-full", STRIPED.has(row.round) && "ring-2 ring-offset-1 ring-offset-card")}
            style={{ background: ROUND_VAR[row.round] }}
          />
          <select
            value={row.round}
            onChange={(e) => onRound(e.target.value as ListRound)}
            title={row.roundAuto ? "Started for you; tap to change" : "You picked this round"}
            className="h-8 appearance-none rounded-full border bg-background pr-3 pl-7 text-xs font-bold"
          >
            {row.pickable.map((r) => (
              <option key={r} value={r}>
                {roundOptionLabel(r, dates[r] ?? null)}
              </option>
            ))}
          </select>
        </label>

        <span className={cn("inline-flex items-center gap-1 text-sm font-semibold tabular-nums", past && "text-muted-foreground line-through")}>
          {deadline ? (
            <>
              {dayLabel(deadline.iso)}
              {deadlineCite ? <SourceTip cited={deadlineCite as AnyCited} /> : null}
            </>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">no date on record</span>
          )}
        </span>

        <button type="button" onClick={onRemove} aria-label={`Remove ${name} from your plan`} className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          ×
        </button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                             */
/* ------------------------------------------------------------------ */

/**
 * `/plan` signed out (specs/planner/redesign/page.md "Signed out"): the pitch, the numbers form (kept in the
 * existing local profile, `lib/student-profile.ts` LOCAL_PROFILE_KEY), add-from-search colleges kept under a new
 * key (`lib/planner/local-plan.ts`), and live group/round chips computed the same way the signed-in plan computes
 * them (`planView`) — every tap only changes local state; nothing is a Server Action. "Save your plan" sends the
 * visitor to sign up; `components/planner/ImportLocalPlan.tsx` moves this onto their real list on the next
 * signed-in `/plan` open.
 */
export default function SignedOutPlan() {
  const { data: profile, save: saveProfile } = useLocalProfile();
  const draft = useNumbersDraft(profile);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const localPlan = useSyncExternalStore(subscribeLocalPlan, getLocalPlan, emptyLocalPlan);
  const [schools, setSchools] = useState<Record<string, PlanSchool>>({});
  const startedRef = useRef(false);
  const lastSavedNumbers = useRef<string | null>(null);
  const fetchedRef = useRef<Set<string>>(new Set());

  // Persist the numbers draft to the existing local profile as it changes (no Save button signed out: every change
  // re-runs the model at once, standing.md "The numbers").
  useEffect(() => {
    if (!draft.parsed) return;
    const next = applyNumbers(profile ?? emptyProfile(), draft.parsed);
    const key = JSON.stringify(next);
    if (key === lastSavedNumbers.current) return;
    lastSavedNumbers.current = key;
    saveProfile(next);
    if (!startedRef.current && (draft.parsed.gpa !== null || draft.parsed.score !== null)) {
      startedRef.current = true;
      track("plan_signed_out_started", { from: "numbers" });
    }
    // profile is read fresh each time via the store; omitting it here avoids re-saving on our own write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.parsed]);

  // The schools behind the local ids, fetched once per id (lib/planner/types.ts PlanSchool, via app/api/plan/schools).
  // `fetchedRef` (not `schools`) tracks what's been requested, so an id the API can't resolve is never retried in a loop.
  useEffect(() => {
    const missing = localPlan.unitIds.filter((id) => !fetchedRef.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) fetchedRef.current.add(id);
    const controller = new AbortController();
    fetch(`/api/plan/schools?ids=${missing.join(",")}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { schools: Record<string, PlanSchool> } | null) => {
        if (body) setSchools((s) => ({ ...s, ...body.schools }));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [localPlan.unitIds]);

  const items = useMemo(() => planItemsFor(localPlan, TODAY), [localPlan]);
  const view = useMemo(() => planView({ items, schools, profile, today: TODAY() }), [items, schools, profile]);

  const update = (next: LocalPlan) => setLocalPlan(next);

  const addCollege = (unitId: string) => {
    const next = addLocalCollege(localPlan, unitId);
    if (next === localPlan) return; // already on the list, or at the cap
    update(next);
    if (!startedRef.current) {
      startedRef.current = true;
      track("plan_signed_out_started", { from: "college" });
    }
  };

  const hasNumbers = draft.parsed !== null && (draft.parsed.gpa !== null || draft.parsed.score !== null);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-3xl border bg-card p-5 sm:p-6">
        <h1 className="font-display text-2xl font-bold">Your colleges, sorted by your numbers, with every deadline in one place.</h1>
        <PitchAnimation />
      </section>

      <NumbersFields draft={draft} />

      <div>
        <button
          type="button"
          onClick={() => setCoursesOpen(true)}
          className="flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-2xl border bg-card px-4 py-2 text-left text-sm hover:bg-muted/60"
        >
          <span className="font-semibold">{profile.academics.courses.length > 0 ? `Your courses (${profile.academics.courses.length})` : "Add your courses (optional)"}</span>
          <span className="text-muted-foreground">{profile.academics.courses.length > 0 ? "Edit" : "Helps at colleges where most students have top GPAs."}</span>
        </button>
        <LocalCoursesSheet open={coursesOpen} onOpenChange={setCoursesOpen} />
      </div>

      <section className="space-y-4">
        {view.rows.length === 0 ? (
          <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">Add a college below to start your plan.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {view.rows.map((row) => (
              <LocalRow
                key={row.item.id}
                row={row}
                today={TODAY()}
                onToggleDream={() => update(setLocalDream(localPlan, localPlan.dream === row.item.unit_id ? null : row.item.unit_id))}
                onGroup={(group) => update(setLocalGroup(localPlan, row.item.unit_id, group))}
                onRound={(round) => update(setLocalRound(localPlan, row.item.unit_id, round))}
                onRemove={() => update(removeLocalCollege(localPlan, row.item.unit_id))}
              />
            ))}
          </ul>
        )}
        <AddCollegeBox excludeIds={localPlan.unitIds} full={localPlan.unitIds.length >= MAX_LOCAL_COLLEGES} onAdd={addCollege} />
      </section>

      <section className="flex flex-col items-start gap-2 rounded-3xl border bg-pop/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="text-sm text-muted-foreground">Sign up to keep this plan across devices, share it with a parent, and get reminders.</p>
        <Link
          href={loginHref("/plan")}
          onClick={() => track("plan_signed_out_saved", { has_numbers: hasNumbers })}
          className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Save your plan
        </Link>
      </section>
    </div>
  );
}
