"use client";

/**
 * Step 12, Recommenders (specs/planner/record/steps.md; specs/planner/v3/guides/recommenders.md): the guide's own
 * rows (`RecommenderRow`), editing the draft's `recommenders` list — rank arrows, status, up to RECOMMENDERS_MAX —
 * without the guide's "What to think about"/"How to ask" sections (folded behind a `?` icon here instead).
 */
import { catalogCourse } from "@/lib/chances/catalog";
import { RecommenderRow } from "@/components/planner/guides/RecommenderRow";
import { Headline } from "@/components/planner/intake/Headline";
import type { IntakeDraft } from "@/lib/planner/intake";
import { moveRank, nextRank, orderRecommenders, setStatus } from "@/lib/planner/recommenders";
import { RECOMMENDERS_MAX, type RecommenderEntry, type RecommenderStatus } from "@/lib/student-profile";

/** A small "?" disclosure with one sentence (less-text.md's pattern, ahead of R4's fold component). */
function InfoNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="inline-block align-middle">
      <summary
        aria-label={label}
        className="inline-flex size-6 min-h-6 cursor-pointer list-none items-center justify-center rounded-full border text-xs font-bold text-muted-foreground [&::-webkit-details-marker]:hidden"
      >
        ?
      </summary>
      <p className="mt-1.5 max-w-xs text-xs text-muted-foreground">{children}</p>
    </details>
  );
}

export function RecommendersStep({
  draft,
  setDraft,
  today,
  canInvite,
  firstRun,
}: {
  draft: IntakeDraft;
  setDraft: (next: IntakeDraft) => void;
  today: string;
  canInvite: boolean;
  firstRun: boolean;
}) {
  const entries = orderRecommenders(draft.recommenders);
  // Subject chips from the student's own AP courses (the guide's `subjectsFrom` reads the full saved course list;
  // the tour only has the AP picker's rows, so this reads their catalog names directly).
  const subjects = [...new Set(draft.courses.map((c) => catalogCourse(c.key)?.name).filter((n): n is string => Boolean(n)))];

  const update = (id: string, next: RecommenderEntry) => setDraft({ ...draft, recommenders: draft.recommenders.map((e) => (e.id === id ? next : e)) });
  const move = (id: string, dir: -1 | 1) => setDraft({ ...draft, recommenders: moveRank(draft.recommenders, id, dir) });
  const remove = (id: string) => setDraft({ ...draft, recommenders: draft.recommenders.filter((e) => e.id !== id).map((e, i) => ({ ...e, rank: i + 1 })) });
  const status = (id: string, s: RecommenderStatus) => setDraft({ ...draft, recommenders: draft.recommenders.map((e) => (e.id === id ? setStatus(e, s, today) : e)) });

  const add = () => {
    const row: RecommenderEntry = {
      id: `recommender-${Date.now()}-${entries.length}`,
      name: "",
      subject: null,
      courseId: null,
      years: [],
      rank: nextRank(draft.recommenders),
      status: "thinking",
      askedOn: null,
      agreedOn: null,
      invitedOn: null,
    };
    setDraft({ ...draft, recommenders: [...draft.recommenders, row] });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Headline lead="Your" pop="recommenders" />
          <InfoNote label="Why recommenders matter">
            Most colleges ask for one or two teacher letters. Pick teachers from junior year in core subjects, and ask early in senior year.
          </InfoNote>
        </div>
        <p className="text-sm text-muted-foreground">The teachers who might write for you, first choice first.</p>
        {firstRun && (
          <p className="text-sm text-muted-foreground">Most students pick these the summer before senior year; skip it for now if you like.</p>
        )}
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
              today={today}
              canInvite={canInvite}
              editable
              isFirst={i === 0}
              isLast={i === entries.length - 1}
              onMove={(dir) => move(entry.id, dir)}
              onChange={(next) => update(entry.id, next)}
              onRemove={() => remove(entry.id)}
              onStatus={(s) => status(entry.id, s)}
            />
          ))}
        </ul>
      )}

      {entries.length < RECOMMENDERS_MAX && (
        <button
          type="button"
          onClick={add}
          className="min-h-10 rounded-full border border-dashed px-4 text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          + Add a teacher
        </button>
      )}
    </div>
  );
}

export default RecommendersStep;
