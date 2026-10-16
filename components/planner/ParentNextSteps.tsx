"use client";

/**
 * A guardian's Next steps tab (specs/planner/v3/parents.md "The tab"; build-plan.md "U9 The parent's Next steps"):
 * their own part first (built `yourPartMoves`, as cards, hidden while empty), then "{First name}'s season": the
 * season's open moves (Now and Next) as compact rows, a row's title opening its guide read-only when it has one
 * (`guideFor`). "Coming up: {next season}" folds open (the one look-ahead a parent gets that the student's own tab
 * doesn't). "Done and skipped this season" folds closed: this season's done moves with their date, and its skipped
 * moves with "Skipped {date}" and **Bring back** for an editor (`undismiss`, attributed `by: "guardian"`).
 *
 * Nothing here grades: no count of what's undone in red, no "behind", no comparison between children (parents.md
 * "Rules"). A `reach_score_*` move's title holds the student's own target score ("Work toward your 1400"); this view
 * never shows it (`parentSafeTitle`). The story move's row reads "Written" / "Not yet" from `ctx.profile?.story`'s
 * presence (a guardian's profile is redacted, but `updatedAt` survives) instead of the usual date text; its title
 * stays as the catalog wrote it.
 *
 * Your part's Done and Skip stay optimistic and live here (as NextSteps.tsx's do), not in the cards. Bring back is
 * optimistic too: it drops the row from the fold at once; a refused write puts it back and shows the message.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { MOVE_CARDS } from "@/components/planner/moves/registry";
import MoveCard, { personFor } from "@/components/planner/moves/MoveCard";
import { SeasonExplainer } from "@/components/planner/SeasonExplainer";
import type { PlanTabProps } from "@/components/planner/tabs/types";
import { track } from "@/lib/analytics";
import { guideFor } from "@/lib/planner/guides";
import { comingUpRows, parentSafeTitle, seasonRows, skippedLabel, yourPartMoves, type SeasonRow } from "@/lib/planner/moves";
import { nextSeason, SEASON_LABELS } from "@/lib/planner/seasons";
import { dismiss, tick, undismiss, untick } from "@/lib/planner/store";
import { dayLabel } from "@/lib/planner/tasks";
import type { PlanContext, PlanTask } from "@/lib/planner/types";

/** Undo stays live for a minute after Done (seasons.md "The Next steps tab"). */
const UNDO_MS = 60_000;
/** A guardian's Your part shows this many cards before the rest fold (the same cap as Now). */
const YOUR_PART_NOW = 6;

type Overlay = { status: "done"; canUndo: boolean } | { status: "skipped" };

const withoutKey = <T,>(o: Record<string, T>, id: string): Record<string, T> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));

/** The why's first clause, for a season row (desktop only) and the folded Your part card. */
function firstClause(detail: string | null): string | null {
  if (!detail) return null;
  const m = /^[^.!?]*[.!?]?/.exec(detail);
  const clause = m ? m[0].trim() : "";
  return clause || null;
}

const STATE_WORDS: Record<SeasonRow["state"], string> = { now: "Now", next: "Next", done: "Done", skipped: "Skipped" };

/** A story move's date column: "Written" / "Not yet" from the profile, not from any date (parents.md "Rules"). */
function storyWhen(profile: PlanContext["profile"]): string {
  return profile?.story?.updatedAt ? "Written" : "Not yet";
}

export function GuardianNextSteps({ ctx, view }: PlanTabProps) {
  const router = useRouter();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const viewed = useRef(false);

  const viewerRole = "guardian" as const;
  const seasonOpts = { season: ctx.season, gradYear: ctx.gradYear, today: ctx.today };
  const yourPart = yourPartMoves(ctx.tasks, ctx.today);
  const rows = seasonRows(ctx.tasks, seasonOpts);
  const openRows = rows.filter((r) => r.state === "now" || r.state === "next");
  const doneRows = rows.filter((r) => r.state === "done");
  const skippedRows = rows.filter((r) => r.state === "skipped" && !restored.has(r.task.id));
  const foldCount = doneRows.length + skippedRows.length;
  const comingUp = comingUpRows(ctx.tasks, seasonOpts);
  const next = nextSeason(ctx.season);
  const classOf = ctx.gradYear !== null ? ` · Class of ${ctx.gradYear}` : "";
  const firstName = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? "Your student";
  const person = personFor(ctx);

  // Once per mount (parents.md "Rules"): a fresh plan (a new child chosen) fires again.
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("plan_parent_season_viewed", { season: ctx.season });
  }, [ctx.season]);

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
      track("plan_move_done", { kind: task.kind, season: task.season ?? ctx.season, by: viewerRole });
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
      track("plan_move_skipped", { kind: task.kind, season: task.season ?? ctx.season });
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
      track("plan_move_restored", { kind: task.kind, season: task.season ?? ctx.season, by: "guardian" });
      router.refresh();
    });
  }

  function renderYourPartCard(task: PlanTask) {
    const ov = overlay[task.id];
    if (ov?.status === "skipped") return null;
    if (ov?.status === "done") {
      const clause = firstClause(task.detail);
      return (
        <div key={task.id} className="flex items-center justify-between gap-3 rounded-3xl bg-card p-4 ring-1 ring-border">
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

  /** One "{First}'s season" or "Done and skipped" row. */
  function renderRow(row: SeasonRow) {
    const { task, state } = row;
    const guide = guideFor(task);
    const title = parentSafeTitle(task);
    const isStory = task.kind === "story";
    const whenText = isStory
      ? storyWhen(ctx.profile)
      : state === "done"
        ? `${row.when ? dayLabel(row.when.slice(0, 10), ctx.today) : "this season"} ✓`
        : state === "skipped"
          ? skippedLabel(task, ctx.today)
          : row.when
            ? dayLabel(row.when, ctx.today)
            : "this season";
    const clause = firstClause(task.detail);
    return (
      <li key={task.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
        <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{STATE_WORDS[state]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            {guide ? (
              <Link href={guide.hrefFor(task, { person, items: ctx.items })} className="min-w-0 truncate font-medium hover:underline">
                {title}
              </Link>
            ) : (
              <span className="min-w-0 truncate font-medium">{title}</span>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">{whenText}</span>
          </div>
          {clause && <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{clause}</p>}
        </div>
        {state === "skipped" && ctx.viewer.canEdit && (
          <button
            type="button"
            disabled={pendingIds.has(task.id)}
            onClick={() => handleBringBack(task)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-border hover:bg-muted disabled:opacity-60"
          >
            Bring back
          </button>
        )}
        {errors[task.id] && (
          <p role="alert" className="text-xs text-destructive">
            {errors[task.id]}
          </p>
        )}
      </li>
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

      {yourPart.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Your part</h3>
          {/* The same cap as Now (README.md "Three to six things"): the first six, the rest folded (QA 2026-10-14
              found seventeen unfolded cards for an eleven-college senior). */}
          <div className="space-y-3">{yourPart.slice(0, YOUR_PART_NOW).map(renderYourPartCard)}</div>
          {yourPart.length > YOUR_PART_NOW && (
            <details className="group rounded-3xl bg-card p-4 ring-1 ring-border">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                More of your part ({yourPart.length - YOUR_PART_NOW})
                <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
              </summary>
              <div className="mt-3 space-y-3">{yourPart.slice(YOUR_PART_NOW).map(renderYourPartCard)}</div>
            </details>
          )}
        </div>
      )}

      <div className="space-y-2 rounded-3xl bg-card p-4 ring-1 ring-border">
        <h3 className="text-sm font-semibold">
          {firstName}&#39;s season · {SEASON_LABELS[ctx.season]}
        </h3>
        {openRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing open this season.</p>
        ) : (
          <ul className="divide-y divide-border">{openRows.map(renderRow)}</ul>
        )}
      </div>

      {next && comingUp.length > 0 && (
        <details className="group rounded-3xl bg-card p-4 ring-1 ring-border" open>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            Coming up · {SEASON_LABELS[next].toLowerCase()} ({comingUp.length})
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {comingUp.map((m, i) => (
              <li key={`${m.title}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{m.title}</span>
                {m.date && <span className="shrink-0 text-xs text-muted-foreground">{dayLabel(m.date, ctx.today)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {foldCount > 0 && (
        <details className="group rounded-3xl bg-card p-4 ring-1 ring-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            Done and skipped this season ({foldCount})
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          </summary>
          <ul className="mt-3 divide-y divide-border">
            {doneRows.map(renderRow)}
            {skippedRows.map(renderRow)}
          </ul>
        </details>
      )}
    </section>
  );
}

export default GuardianNextSteps;
