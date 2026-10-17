"use client";

/**
 * Pick your recommenders (specs/planner/v3/guides/recommenders.md): what to think about, the teachers entered and
 * ranked with a status each, how to ask, and (from November of senior year) a line to thank them. Every change
 * saves optimistically through `saveRecommenders`; reaching two asked/agreed/invited ticks the open
 * `pick_recommenders` move. Visible and editable to a guardian (a teacher's name isn't a private note).
 */
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { WhyFold } from "@/components/ui/why-fold";
import { track } from "@/lib/analytics";
import { guideHref } from "@/lib/planner/guides";
import {
  collegesAskLine,
  HOW_TO_ASK,
  moveRank,
  nextRank,
  orderRecommenders,
  setStatus,
  subjectsFrom,
  thankSeason,
  THINK_ABOUT,
} from "@/lib/planner/recommenders";
import { seasonRank } from "@/lib/planner/seasons";
import { tick } from "@/lib/planner/store";
import { saveRecommenders } from "@/lib/student-profile-store";
import { isOpen } from "@/lib/planner/tasks";
import { RECOMMENDERS_MAX, type RecommenderEntry, type RecommenderStatus } from "@/lib/student-profile";
import { RecommenderRow } from "./RecommenderRow";
import type { GuideProps } from "./types";

const ADVISOR_SOURCES: readonly { name: string; href: string }[] = [
  { name: "College Board", href: "https://bigfuture.collegeboard.org" },
  { name: "NACAC", href: "https://www.nacacnet.org" },
];

export function RecommendersGuide({ ctx, move, person }: GuideProps) {
  const profile = ctx.profile;
  const editable = ctx.viewer.canEdit;
  const studentId = ctx.student?.id ?? null;

  const [entries, setEntries] = useState<RecommenderEntry[]>(() => orderRecommenders(profile?.recommenders ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ticked = useRef(false);

  if (!profile || !studentId) {
    return (
      <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
        <p className="text-sm text-muted-foreground">Set up your plan to see this guide.</p>
      </section>
    );
  }

  const openMove = move && isOpen(move, ctx.today) ? move : null;
  const subjects = subjectsFrom(profile.academics.courses);
  const askLine = collegesAskLine(ctx.items, ctx.schools);
  const canInvite = seasonRank(ctx.season) >= seasonRank("senior_fall");
  const showThank = thankSeason(ctx.season, ctx.today);
  const thankOpen = Boolean(openMove?.key?.endsWith(":cycle:thank_recommenders"));
  const pickOpen = Boolean(openMove?.key?.endsWith(":playbook:pick_recommenders"));

  function save(next: RecommenderEntry[], after?: () => void) {
    setEntries(next);
    setError(null);
    startTransition(async () => {
      const result = await saveRecommenders(studentId!, next);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      after?.();
    });
  }

  function afterAskedChange(next: readonly RecommenderEntry[]) {
    const asked = next.filter((e) => e.status !== "thinking").length;
    if (!ticked.current && asked >= 2 && pickOpen && openMove) {
      ticked.current = true;
      void tick(openMove.id);
    }
  }

  const onChange = (id: string, next: RecommenderEntry) => save(entries.map((e) => (e.id === id ? next : e)));
  const onMove = (id: string, dir: -1 | 1) => save(moveRank(entries, id, dir));
  const onRemove = (id: string) => {
    const next = entries.filter((e) => e.id !== id).map((e, i) => ({ ...e, rank: i + 1 }));
    save(next, () => track("recommenders_count", { n: next.length }));
  };

  function onStatus(id: string, status: RecommenderStatus) {
    const next = entries.map((e) => (e.id === id ? setStatus(e, status, ctx.today) : e));
    track("plan_recommender_status", { status });
    save(next, () => afterAskedChange(next));
  }

  function addTeacher() {
    const row: RecommenderEntry = {
      id: `recommender-${entries.length + 1}-${Date.now()}`,
      name: "",
      subject: null,
      courseId: null,
      years: [],
      rank: nextRank(entries),
      status: "thinking",
      askedOn: null,
      agreedOn: null,
      invitedOn: null,
    };
    const next = [...entries, row];
    save(next, () => track("recommenders_count", { n: next.length }));
  }

  function thankDone() {
    if (!move) return;
    startTransition(async () => {
      await tick(move.id);
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
            Your teachers
          </h2>
          {editable && <span className="text-xs text-muted-foreground">drag to rank, or use the arrows</span>}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teachers yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry, i) => (
              <RecommenderRow
                key={entry.id}
                entry={entry}
                subjects={subjects}
                today={ctx.today}
                canInvite={canInvite}
                editable={editable}
                isFirst={i === 0}
                isLast={i === entries.length - 1}
                onMove={(dir) => onMove(entry.id, dir)}
                onChange={(next) => onChange(entry.id, next)}
                onRemove={() => onRemove(entry.id)}
                onStatus={(status) => onStatus(entry.id, status)}
              />
            ))}
          </ul>
        )}
        {editable && entries.length < RECOMMENDERS_MAX && (
          <button type="button" onClick={addTeacher} disabled={pending} className="min-h-10 rounded-full border border-dashed px-4 text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-60">
            + Add a teacher
          </button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <WhyFold title="What to think about" screen="recommenders_guide" section="what_to_think_about">
        <ul className="space-y-1.5">
          {THINK_ABOUT.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="text-xs">
          Sources:{" "}
          {ADVISOR_SOURCES.map((s, i) => (
            <span key={s.name}>
              {i > 0 && ", "}
              <a href={s.href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                {s.name}
              </a>
            </span>
          ))}
          .
        </p>
        {askLine && (
          <details className="rounded-xl border bg-background p-2.5 text-sm">
            <summary className="cursor-pointer font-semibold">What your colleges ask for</summary>
            <p className="mt-1.5 text-muted-foreground">{askLine.text}.</p>
          </details>
        )}
      </WhyFold>

      <WhyFold title="How to ask" screen="recommenders_guide" section="how_to_ask">
        <p>{HOW_TO_ASK.join(" ")}</p>
        <Link href={guideHref("story", { person, from: "card" })} className="inline-block font-semibold text-primary hover:underline">
          Open your story
        </Link>
      </WhyFold>

      {showThank && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Letters are in. A note by hand goes a long way.</p>
          {editable && thankOpen && (
            <button
              type="button"
              disabled={pending}
              onClick={thankDone}
              className="min-h-10 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              Done
            </button>
          )}
        </section>
      )}
    </div>
  );
}

export default RecommendersGuide;
