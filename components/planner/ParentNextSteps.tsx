"use client";

/**
 * A guardian's Next steps tab, as the next-steps build left it (specs/planner/next-steps/seasons.md "The Next steps
 * tab"), moved out of NextSteps.tsx by plan v3's U1 so the student's tab could become three cards; plan v3's U9
 * rewrites this file (specs/planner/v3/parents.md). Header (the season in words and class year, "How this season
 * works"), the guardian's own moves first (Your part, `yourPartMoves`), then Now (`nowMoves`, NOW_MAX cards), folded
 * "More this season" and "Coming up: {next season}" (titles, dates for dated ones), and a folded Done count. A card is
 * `MOVE_CARDS[task.kind]` when one exists, else `MoveCard`.
 *
 * Done and Not now are optimistic and live here, not in the cards (whose `onDone`/`onSkip` are plain callbacks):
 * tapping either folds the card in place at once (Done shows a check and the why's first clause, with Undo for a
 * minute; Not now just leaves). A refused write rolls the card back and shows its message; a successful one
 * refreshes the page so the folds, the people line, and anything season-wide stay correct.
 *
 * `?move=<task id>` (`planHref({ tab: "next", move })`, the people line's "Next:") scrolls that card into view on
 * mount and rings it briefly.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { MOVE_CARDS } from "@/components/planner/moves/registry";
import MoveCard from "@/components/planner/moves/MoveCard";
import { SeasonExplainer } from "@/components/planner/SeasonExplainer";
import type { PlanTabProps } from "@/components/planner/tabs/types";
import { track } from "@/lib/analytics";
import { nowMoves, yourPartMoves } from "@/lib/planner/moves";
import { nextSeason, SEASON_LABELS } from "@/lib/planner/seasons";
import { dismiss, tick, untick } from "@/lib/planner/store";
import { dayLabel } from "@/lib/planner/tasks";
import type { PlanTask } from "@/lib/planner/types";

/** Undo stays live for a minute after Done (seasons.md "The Next steps tab"). */
const UNDO_MS = 60_000;
/** A guardian's Your part shows this many cards before the rest fold (the same cap as Now). */
const YOUR_PART_NOW = 6;
/** A ring the scrolled-to card wears briefly for `?move=`. */
const RING_CLASSES = ["ring-2", "ring-ring", "ring-offset-2"] as const;

type Overlay = { status: "done"; canUndo: boolean } | { status: "skipped" };

const withoutKey = <T,>(o: Record<string, T>, id: string): Record<string, T> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));

/** The why's first clause, for the folded Done card ("folds the card with a check and a short line"). */
function firstClause(detail: string | null): string | null {
  if (!detail) return null;
  const m = /^[^.!?]*[.!?]?/.exec(detail);
  const clause = m ? m[0].trim() : "";
  return clause || null;
}

export function GuardianNextSteps({ ctx, view }: PlanTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scrolled = useRef(false);

  const viewerRole: "student" | "guardian" = ctx.viewer.isGuardian ? "guardian" : "student";
  const groups = nowMoves(ctx.tasks, { season: ctx.season, gradYear: ctx.gradYear, today: ctx.today, viewer: viewerRole });
  const yourPart = ctx.viewer.isGuardian ? yourPartMoves(ctx.tasks, ctx.today) : [];
  const next = nextSeason(ctx.season);
  const classOf = ctx.gradYear !== null ? ` · Class of ${ctx.gradYear}` : "";

  // `?move=<task id>`: scroll that card into view once, and ring it briefly.
  useEffect(() => {
    if (scrolled.current) return;
    const id = searchParams.get("move");
    if (!id) return;
    const el = document.getElementById(`move-${id}`);
    if (!el) return;
    scrolled.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add(...RING_CLASSES);
    const t = setTimeout(() => el.classList.remove(...RING_CLASSES), 2000);
    return () => clearTimeout(t);
  }, [searchParams]);

  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
    },
    [],
  );

  function setError(id: string, message: string | null) {
    setErrors((e) => (message ? { ...e, [id]: message } : id in e ? withoutKey(e, id) : e));
  }

  function handleDone(task: PlanTask) {
    setError(task.id, null);
    setOverlay((o) => ({ ...o, [task.id]: { status: "done", canUndo: true } }));
    setPendingIds((s) => new Set(s).add(task.id));
    timers.current[task.id] = setTimeout(() => {
      setOverlay((o) => (o[task.id]?.status === "done" ? { ...o, [task.id]: { status: "done", canUndo: false } } : o));
    }, UNDO_MS);
    startTransition(async () => {
      const result = await tick(task.id);
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
      if (!result.ok) {
        clearTimeout(timers.current[task.id]);
        setOverlay((o) => withoutKey(o, task.id));
        setError(task.id, result.message);
        return;
      }
      track("plan_move_done", { kind: task.kind, season: task.season ?? ctx.season, by: viewerRole });
      router.refresh();
    });
  }

  function handleUndo(task: PlanTask) {
    clearTimeout(timers.current[task.id]);
    setOverlay((o) => withoutKey(o, task.id));
    setPendingIds((s) => new Set(s).add(task.id));
    startTransition(async () => {
      await untick(task.id);
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
      router.refresh();
    });
  }

  function handleSkip(task: PlanTask) {
    setError(task.id, null);
    setOverlay((o) => ({ ...o, [task.id]: { status: "skipped" } }));
    setPendingIds((s) => new Set(s).add(task.id));
    startTransition(async () => {
      const result = await dismiss(task.id, true);
      setPendingIds((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
      if (!result.ok) {
        setOverlay((o) => withoutKey(o, task.id));
        setError(task.id, result.message);
        return;
      }
      track("plan_move_skipped", { kind: task.kind, season: task.season ?? ctx.season });
      router.refresh();
    });
  }

  function renderCard(task: PlanTask) {
    const ov = overlay[task.id];
    if (ov?.status === "skipped") return null;
    if (ov?.status === "done") {
      const clause = firstClause(task.detail);
      return (
        <div key={task.id} id={`move-${task.id}`} className="flex items-center justify-between gap-3 rounded-3xl bg-card p-4 ring-1 ring-border">
          <div className="flex min-w-0 items-center gap-2">
            <Check className="size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-muted-foreground line-through">{task.title}</p>
              {clause && <p className="truncate text-xs text-muted-foreground">{clause}</p>}
            </div>
          </div>
          {ov.canUndo && (
            <button type="button" className="shrink-0 text-sm font-semibold text-primary hover:underline" onClick={() => handleUndo(task)}>
              Undo
            </button>
          )}
        </div>
      );
    }
    const Card = MOVE_CARDS[task.kind] ?? MoveCard;
    return (
      <div key={task.id}>
        <Card task={task} ctx={ctx} view={view} onDone={handleDone} onSkip={handleSkip} pending={pendingIds.has(task.id)} />
        {errors[task.id] && (
          <p role="alert" className="mt-1 px-1 text-xs text-destructive">
            {errors[task.id]}
          </p>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="next-steps-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="next-steps-heading" className="text-lg font-semibold">
          {SEASON_LABELS[ctx.season]}
          {classOf}
        </h2>
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-border hover:bg-muted sm:min-h-9"
          onClick={() => {
            setExplainerOpen(true);
            track("plan_season_explainer_opened", { season: ctx.season });
          }}
        >
          How this season works
        </button>
      </div>
      <SeasonExplainer open={explainerOpen} onOpenChange={setExplainerOpen} season={ctx.season} />

      {ctx.viewer.isGuardian && yourPart.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Your part</h3>
          {/* The same cap as Now (README.md "Three to six things"): the first six, the rest folded (QA 2026-10-14
              found seventeen unfolded cards for an eleven-college senior). */}
          <div className="space-y-3">{yourPart.slice(0, YOUR_PART_NOW).map(renderCard)}</div>
          {yourPart.length > YOUR_PART_NOW && (
            <details className="group rounded-3xl bg-card p-4 ring-1 ring-border">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                More of your part ({yourPart.length - YOUR_PART_NOW})
                <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
              </summary>
              <div className="mt-3 space-y-3">{yourPart.slice(YOUR_PART_NOW).map(renderCard)}</div>
            </details>
          )}
        </div>
      )}

      {groups.now.length === 0 ? (
        <p className="text-muted-foreground">Nothing to do this season. Enjoy it.</p>
      ) : (
        <div className="space-y-3">{groups.now.map(renderCard)}</div>
      )}

      {groups.more.length > 0 && (
        <details className="group rounded-3xl bg-card p-4 ring-1 ring-border">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            More this season ({groups.more.length})
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          </summary>
          <div className="mt-3 space-y-3">{groups.more.map(renderCard)}</div>
        </details>
      )}

      {next && groups.comingUp.length > 0 && (
        <details className="group rounded-3xl bg-card p-4 ring-1 ring-border" open={groups.now.length === 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            Coming up: {SEASON_LABELS[next].toLowerCase()} ({groups.comingUp.length})
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {groups.comingUp.map((m, i) => (
              <li key={`${m.title}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{m.title}</span>
                {m.date && <span className="shrink-0 text-xs text-muted-foreground">{dayLabel(m.date, ctx.today)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {groups.done.length > 0 && (
        <details className="group rounded-3xl bg-card p-4 ring-1 ring-border">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            Done ({groups.done.length})
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {groups.done.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="truncate line-through">{t.title}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default GuardianNextSteps;
