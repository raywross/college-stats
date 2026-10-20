"use client";

/**
 * The Next steps tab (specs/planner/v3/now.md "The tab"; build-plan.md "U1 Foundation" step 7). The header (the
 * season in words and class year, "How this season works"), at most three cards (`nowMoves`' `now`, the season gate
 * and NOW_MAX), and one folded **Done and skipped (n)** line: this season's done moves with a check and the day, and
 * its skipped moves with "Skipped Oct 12" and **Bring back**. Nothing else: no More this season, no Coming up (the
 * explainer's next-season line is the one look ahead). With nothing to do: "Nothing to do right now. Enjoy it." and
 * the explainer's lead.
 *
 * Owner, 2026-10-16 (plan-v3-fix-cards; `specs/planner/v3/parents.md`'s "As built" note): "For now, when a parent
 * looks at a student they should see what they see"; later the same day: "make it so that it works the same for both
 * parents and students, using the student view." A guardian renders exactly this view: the same `nowMoves` call
 * with `viewer: "student"`, the same three cards with the same titles, the same header, the same Done and skipped
 * fold. No separate Your part list (a parent's own moves rank among the three as they do for the student). Editing
 * still needs edit access. `ParentNextSteps.tsx` (the former guardian-only tab) is kept but unused;
 * `specs/planner/v3/parents.md` describes it.
 *
 * A card is `MOVE_CARDS[task.kind]` when one exists, else `MoveCard` (its one button opens the move's guide). Done,
 * Skip, and Bring back are optimistic and live here, not in the cards: Done folds the card with a check and Undo for a
 * minute; Skip folds it at once; Bring back moves the row out of the fold at once. A refused write rolls back and shows
 * its message; a successful one refreshes the page so the next-ranked move takes the freed place.
 *
 * `?move=<task id>` (`planHref({ tab: "next", move })`, the people line's "Next:") scrolls that card into view on
 * mount and rings it briefly.
 */
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { MOVE_CARDS } from "@/components/planner/moves/registry";
import MoveCard from "@/components/planner/moves/MoveCard";
import { SeasonExplainer } from "@/components/planner/SeasonExplainer";
import type { PlanTabProps } from "@/components/planner/tabs/types";
import { track } from "@/lib/analytics";
import { SEASON_EXPLAINER } from "@/lib/planner/moves-catalog";
import { doneLabel, nowMoves, skippedLabel, taskSeason } from "@/lib/planner/moves";
import { importanceFactsFrom } from "@/lib/planner/importance-facts";
import { allMovesBySeason, conditionalMoves, hiddenNote } from "@/lib/planner/all-moves";
import { SEASON_LABELS } from "@/lib/planner/seasons";
import { dismiss, tick, undismiss, untick } from "@/lib/planner/store";
import type { PlanTask } from "@/lib/planner/types";

/** Undo stays live for a minute after Done (seasons.md "The Next steps tab"). */
const UNDO_MS = 60_000;
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

export function NextSteps({ ctx, view }: PlanTabProps) {
  return <StudentNextSteps ctx={ctx} view={view} />;
}

function StudentNextSteps({ ctx, view }: PlanTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scrolled = useRef(false);

  const by = ctx.viewer.isGuardian ? "guardian" : "student";
  const facts = importanceFactsFrom(ctx, view);
  const groups = nowMoves(ctx.tasks, { season: ctx.season, gradYear: ctx.gradYear, today: ctx.today, viewer: "student", facts });
  const classOf = ctx.gradYear !== null ? ` · Class of ${ctx.gradYear}` : "";
  const seasonOfTask = (t: PlanTask) => taskSeason(t, ctx.gradYear, ctx.season);
  const skipped = groups.skipped.filter((t) => !restored.has(t.id));
  const foldCount = groups.done.length + skipped.length;

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

  function setPending(id: string, on: boolean) {
    setPendingIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function handleDone(task: PlanTask) {
    setError(task.id, null);
    setOverlay((o) => ({ ...o, [task.id]: { status: "done", canUndo: true } }));
    setPending(task.id, true);
    timers.current[task.id] = setTimeout(() => {
      setOverlay((o) => (o[task.id]?.status === "done" ? { ...o, [task.id]: { status: "done", canUndo: false } } : o));
    }, UNDO_MS);
    startTransition(async () => {
      const result = await tick(task.id);
      setPending(task.id, false);
      if (!result.ok) {
        clearTimeout(timers.current[task.id]);
        setOverlay((o) => withoutKey(o, task.id));
        setError(task.id, result.message);
        return;
      }
      track("plan_move_done", { kind: task.kind, season: seasonOfTask(task), by });
      router.refresh();
    });
  }

  function handleUndo(task: PlanTask) {
    clearTimeout(timers.current[task.id]);
    setOverlay((o) => withoutKey(o, task.id));
    setPending(task.id, true);
    startTransition(async () => {
      await untick(task.id);
      setPending(task.id, false);
      router.refresh();
    });
  }

  function handleSkip(task: PlanTask) {
    setError(task.id, null);
    setOverlay((o) => ({ ...o, [task.id]: { status: "skipped" } }));
    setPending(task.id, true);
    startTransition(async () => {
      const result = await dismiss(task.id, true);
      setPending(task.id, false);
      if (!result.ok) {
        setOverlay((o) => withoutKey(o, task.id));
        setError(task.id, result.message);
        return;
      }
      track("plan_move_skipped", { kind: task.kind, season: seasonOfTask(task) });
      router.refresh();
    });
  }

  function handleBringBack(task: PlanTask) {
    setError(task.id, null);
    setRestored((s) => new Set(s).add(task.id));
    setPending(task.id, true);
    startTransition(async () => {
      const result = await undismiss(task.id);
      setPending(task.id, false);
      if (!result.ok) {
        setRestored((s) => {
          const n = new Set(s);
          n.delete(task.id);
          return n;
        });
        setError(task.id, result.message);
        return;
      }
      track("plan_move_restored", { kind: task.kind, season: seasonOfTask(task), by });
      router.refresh();
    });
  }

  function renderCard(task: PlanTask, rank?: number) {
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
            <button type="button" className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-primary hover:underline" onClick={() => handleUndo(task)}>
              Undo
            </button>
          )}
        </div>
      );
    }
    const Card = MOVE_CARDS[task.kind] ?? MoveCard;
    return (
      <div key={task.id}>
        <Card task={task} ctx={ctx} view={view} onDone={handleDone} onSkip={handleSkip} pending={pendingIds.has(task.id)} rank={rank} />
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
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-border hover:bg-muted"
          onClick={() => {
            setExplainerOpen(true);
            track("plan_season_explainer_opened", { season: ctx.season });
          }}
        >
          How this season works
        </button>
      </div>
      <SeasonExplainer open={explainerOpen} onOpenChange={setExplainerOpen} season={ctx.season} />

      {ctx.allMoves ? (
        <AllMoves
          ctx={ctx}
          renderCard={renderCard}
          pendingIds={pendingIds}
          restored={restored}
          errors={errors}
          onBringBack={handleBringBack}
          onUndo={handleUndo}
        />
      ) : groups.now.length === 0 ? (
        <div className="space-y-1">
          <p className="font-semibold">Nothing to do right now. Enjoy it.</p>
          <p className="text-sm text-muted-foreground">{SEASON_EXPLAINER[ctx.season].lead}</p>
        </div>
      ) : (
        <div className="space-y-3">{groups.now.map((task, i) => renderCard(task, i + 1))}</div>
      )}

      {!ctx.allMoves && foldCount > 0 && (
        <details className="group rounded-3xl bg-card p-4 ring-1 ring-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            Done and skipped ({foldCount})
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {groups.done.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="flex min-w-0 items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate line-through">{t.title}</span>
                </span>
                {doneLabel(t, ctx.today) && <span className="shrink-0 text-xs">{doneLabel(t, ctx.today)}</span>}
              </li>
            ))}
            {skipped.map((t) => (
              <li key={t.id} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate">{t.title}</span>
                    <span className="block text-xs text-muted-foreground">{skippedLabel(t, ctx.today)}</span>
                  </span>
                  {ctx.viewer.canEdit && (
                    <button
                      type="button"
                      disabled={pendingIds.has(t.id)}
                      onClick={() => handleBringBack(t)}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-border hover:bg-muted disabled:opacity-60"
                    >
                      Bring back
                    </button>
                  )}
                </div>
                {errors[t.id] && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {errors[t.id]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * The all-moves preview (lib/planner/all-moves.ts; `PLANNER_ALL_MOVES=1`): every move by the season it belongs to, the
 * current season open, each open move as its real card (Done, Skip, and the guide work), done ones with Undo, skipped
 * ones with Bring back, then the rule moves this plan has no row for yet.
 */
function AllMoves({
  ctx,
  renderCard,
  pendingIds,
  restored,
  errors,
  onBringBack,
  onUndo,
}: {
  ctx: PlanTabProps["ctx"];
  renderCard: (task: PlanTask) => ReactNode;
  pendingIds: ReadonlySet<string>;
  restored: ReadonlySet<string>;
  errors: Record<string, string>;
  onBringBack: (task: PlanTask) => void;
  onUndo: (task: PlanTask) => void;
}) {
  const sections = allMovesBySeason(ctx.tasks, { season: ctx.season, gradYear: ctx.gradYear, today: ctx.today });
  const waiting = conditionalMoves(ctx.tasks);
  const rowButton = "inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-border hover:bg-muted disabled:opacity-60";
  return (
    <div className="space-y-3">
      <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        Preview: every move, by the season it belongs to. The real tab shows only this season&apos;s top three.
      </p>
      {sections.map((s) => {
        const skipped = s.skipped.filter((t) => !restored.has(t.id));
        const total = s.open.length + s.done.length + skipped.length;
        return (
          <details key={s.season} open={s.season === ctx.season} className="group rounded-3xl bg-card p-4 ring-1 ring-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
              <span>
                {SEASON_LABELS[s.season]}
                {s.season === ctx.season && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Now</span>}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {s.open.length} open · {total} in all
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {s.open.map((t) => {
                const note = hiddenNote(t);
                return (
                  <div key={t.id}>
                    {note && <p className="mb-1 px-1 text-xs text-muted-foreground">{note}</p>}
                    {renderCard(t)}
                  </div>
                );
              })}
              {(s.done.length > 0 || skipped.length > 0) && (
                <ul className="space-y-2 pt-1">
                  {s.done.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-2">
                        <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                        <span className="truncate line-through">{t.title}</span>
                      </span>
                      {ctx.viewer.canEdit && (
                        <button type="button" disabled={pendingIds.has(t.id)} onClick={() => onUndo(t)} className={rowButton}>
                          Undo
                        </button>
                      )}
                    </li>
                  ))}
                  {skipped.map((t) => (
                    <li key={t.id} className="text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate">{t.title}</span>
                          <span className="block text-xs text-muted-foreground">{skippedLabel(t, ctx.today)}</span>
                        </span>
                        {ctx.viewer.canEdit && (
                          <button type="button" disabled={pendingIds.has(t.id)} onClick={() => onBringBack(t)} className={rowButton}>
                            Bring back
                          </button>
                        )}
                      </div>
                      {errors[t.id] && (
                        <p role="alert" className="mt-1 text-xs text-destructive">
                          {errors[t.id]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        );
      })}
      {waiting.length > 0 && (
        <details className="group rounded-3xl bg-card p-4 ring-1 ring-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            When the list calls for them
            <span className="text-xs font-normal text-muted-foreground">{waiting.length} not on this plan yet</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {waiting.map((m) => (
              <li key={m.key} className="text-sm">
                <span className="block font-medium">{m.title}</span>
                <span className="block text-xs text-muted-foreground">{m.why}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default NextSteps;
