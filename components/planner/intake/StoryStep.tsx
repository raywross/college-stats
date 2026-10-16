"use client";

/**
 * Step 11, Your story (specs/planner/record/steps.md; specs/planner/v3/guides/your-story.md): the same textarea and
 * starters as the story guide, writing into the draft (saved with everything else at Review, build-plan review note
 * 3). A guardian's draft carries no text (`draft.story === null`): "Written" / "Not yet" only, as the guide shows it.
 */
import { Headline } from "@/components/planner/intake/Headline";
import type { IntakeDraft } from "@/lib/planner/intake";
import { appendStarter, storyStarters } from "@/lib/planner/story-guide";
import { STORY_MAX } from "@/lib/student-profile";

export function StoryStep({
  draft,
  setDraft,
  majorName,
  firstRun,
}: {
  draft: IntakeDraft;
  setDraft: (next: IntakeDraft) => void;
  /** The first intended major's name, lowercased, for the "Why {major}" starter; null without one. */
  majorName: string | null;
  /** Steps 11 and 12 on the first run show a one-line note that it's fine to leave for later (steps.md). */
  firstRun: boolean;
}) {
  const starters = storyStarters(majorName);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Headline lead="Your" pop="story" />
        <p className="text-sm text-muted-foreground">A few sentences in your own words: what your grades don&apos;t say.</p>
        {firstRun && (
          <p className="text-sm text-muted-foreground">Most students write this the summer before senior year; skip it for now if you like.</p>
        )}
      </div>

      {draft.story === null ? (
        <p className="text-sm font-semibold">{draft.storyWritten ? "Written" : "Not yet"}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="intake-story" className="text-sm font-semibold">
              Your story
            </label>
            <span className="text-xs text-muted-foreground" aria-hidden>
              {draft.story.length} / {STORY_MAX}
            </span>
          </div>
          <textarea
            id="intake-story"
            aria-label="Your story"
            rows={10}
            maxLength={STORY_MAX}
            value={draft.story}
            onChange={(e) => setDraft({ ...draft, story: e.target.value })}
            className="w-full rounded-xl border border-input bg-background p-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Stuck? Start with one of these:</span>
            {starters.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setDraft({ ...draft, story: appendStarter(draft.story ?? "", s.question) })}
                className="min-h-9 rounded-full border border-dashed px-3 text-xs font-semibold text-muted-foreground hover:border-foreground hover:text-foreground"
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Private to you. Nobody at Quad reads it, and your parents can&apos;t see it.</p>
        </div>
      )}
    </div>
  );
}

export default StoryStep;
