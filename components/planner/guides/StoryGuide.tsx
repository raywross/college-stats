"use client";

/**
 * Your story (specs/planner/v3/guides/your-story.md; plan v3 build-plan.md "U6 Your story guide"): one private
 * narrative, framed by depth and breadth, beside a read-only look at what the student's record already says. Opens
 * from the `story` move, the Numbers page's Your story section, and the summer essay move's "start from your story".
 *
 * A guardian sees the student's screen (owner, 2026-10-16: "using the student view"): the same framing and the same
 * record sentences. Only the story's text stays the student's (lib/student-profile.ts redactStoryForGuardian strips it
 * server-side and `saveStory` refuses a guardian), so in place of the field a guardian reads one line ("{First} has
 * written their story." / "hasn't … yet."). Saved through the same `saveStory` action as the old Numbers-page field
 * and move card, both of which this unit replaces.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { WhyFold } from "@/components/ui/why-fold";
import { track } from "@/lib/analytics";
import { activitiesReading, type CourseTracks } from "@/lib/chances/depth";
import { noteText } from "@/lib/chances/notes";
import { majorFamilyName } from "@/lib/majors";
import { ACTIVITY_STEP_INDEX } from "@/lib/planner/intake";
import { planHref } from "@/lib/planner/plan-tabs";
import { tick } from "@/lib/planner/store";
import { isOpen } from "@/lib/planner/tasks";
import { appendStarter, crossesStoryDone, storyStarters } from "@/lib/planner/story-guide";
import { saveStory, type StorySaveState } from "@/lib/student-profile-store";
import { guardianStoryLine, STORY_MAX, storyLengthBand, storyWritten } from "@/lib/student-profile";
import type { GuideProps } from "./types";

/** What the guide's server `load` sends down (lib/planner/guides-server.ts "story" entry). */
export interface StoryGuideData {
  tracks: CourseTracks | null;
}

/** What a guardian reads where the student's field is (your-story.md "Rules": the text is the student's alone). */
function GuardianLine({ written, firstName }: { written: boolean; firstName: string | null }) {
  return <p className="text-sm text-muted-foreground">{guardianStoryLine(firstName, written)}</p>;
}

/** "Colleges that read beyond the numbers …", with "depth" linking the glossary. Folded, closed (less-text.md). */
function Frame() {
  return (
    <WhyFold title="Depth and breadth" screen="story_guide" section="depth_and_breadth">
      <p className="max-w-prose">
        Colleges that read beyond the numbers look for two things: <Term term="depth">depth</Term>, a few things carried for years with a growing role, and
        breadth, that those things add up to a person with a direction. Your story is where the second comes from. Write it the way you&apos;d tell a
        teacher who asked &quot;what are you about?&quot;
      </p>
    </WhyFold>
  );
}

/**
 * The depth reading's sentences, the course tracks' sentences, and the intended major, read-only, exactly as the
 * Numbers page shows them. Folded (less-text.md): open the first time (the story is empty), closed once there's
 * text to read instead.
 */
function WhatYourRecordSays({
  ctx,
  tracks,
  person,
  storyEmpty,
}: {
  ctx: GuideProps["ctx"];
  tracks: CourseTracks | null;
  person: string | null;
  storyEmpty: boolean;
}) {
  const profile = ctx.profile;
  const activities = profile?.academics.activities ?? [];
  const awards = profile?.academics.awards ?? [];
  const majorCode = profile?.plans.intendedMajors[0] ?? null;
  const majorName = majorFamilyName(majorCode);

  const activityLines = activities.length === 0 ? [] : activitiesReading(activities, awards).notes.map(noteText);
  const trackLines = (tracks?.families ?? []).map((f) => noteText(f.note));
  const lines = [...activityLines, ...trackLines];
  if (majorName) lines.push(`Intended major: ${majorName}.`);

  return (
    <WhyFold title="What your record says so far" screen="story_guide" section="record_so_far" defaultOpen={storyEmpty}>
      {activities.length === 0 && (
        <p>
          Add your activities and the plan will show what they say.{" "}
          <Link href={planHref({ person, setup: true, step: ACTIVITY_STEP_INDEX.clubs })} className="font-semibold text-primary hover:underline">
            Add them
          </Link>
          .
        </p>
      )}
      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((line, i) => (
            <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
          ))}
        </ul>
      )}
    </WhyFold>
  );
}

export function StoryGuide({ ctx, move, person, data }: GuideProps) {
  const { tracks } = (data as StoryGuideData | undefined) ?? { tracks: null };
  const isGuardian = ctx.viewer.isGuardian;
  const studentId = ctx.student?.id ?? null;
  const firstName = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const story = ctx.profile?.story ?? null;

  if (!studentId) {
    return (
      <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
        <p className="text-sm text-muted-foreground">Sign in to write your story.</p>
      </section>
    );
  }

  const majorName = majorFamilyName(ctx.profile?.plans.intendedMajors[0] ?? null)?.toLowerCase() ?? null;
  const openMove = move && isOpen(move, ctx.today) ? move : null;
  const storyEmpty = isGuardian ? !storyWritten(ctx.profile) : !story?.narrative?.trim();

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">Private to you. Nobody at Quad reads it, and your parents can&apos;t see it.</p>

      <Frame />
      <WhatYourRecordSays ctx={ctx} tracks={tracks} person={person} storyEmpty={storyEmpty} />

      {isGuardian ? (
        <GuardianLine written={storyWritten(ctx.profile)} firstName={firstName} />
      ) : (
        <StoryField studentId={studentId} initial={story?.narrative ?? ""} majorName={majorName} moveId={openMove?.id ?? null} />
      )}
    </div>
  );
}

function StoryField({ studentId, initial, majorName, moveId }: { studentId: string; initial: string; majorName: string | null; moveId: string | null }) {
  const [state, action, pending] = useActionState<StorySaveState, FormData>(saveStory, { status: "idle" });
  const [narrative, setNarrative] = useState(initial);
  const [justTicked, setJustTicked] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const priorLengthRef = useRef(initial.trim().length);
  const tickedRef = useRef(false);
  const savedNarrativeRef = useRef(initial);

  // `useActionState` re-runs this after every successful dispatch (saveStory posts the one `narrative` field, blur or
  // Save): the length band it reports, and the auto-tick, both read the text that was actually just submitted, not
  // whatever's since been typed.
  useEffect(() => {
    if (state.status !== "saved") return;
    const submitted = savedNarrativeRef.current;
    track("story_filled", { length_band: storyLengthBand(submitted) });
    const afterLength = submitted.trim().length;
    if (!tickedRef.current && moveId && crossesStoryDone(priorLengthRef.current, afterLength)) {
      tickedRef.current = true;
      setJustTicked(true);
      void tick(moveId);
    }
    priorLengthRef.current = afterLength;
    // Only on a fresh "saved" result, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const starters = storyStarters(majorName);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Your story</h2>
        <span className="text-xs text-muted-foreground" aria-hidden>
          {narrative.length} / {STORY_MAX}
        </span>
      </div>
      <form ref={formRef} action={action}>
        <input type="hidden" name="student_id" value={studentId} />
        <textarea
          aria-label="Your story"
          name="narrative"
          rows={10}
          maxLength={STORY_MAX}
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          onBlur={() => {
            savedNarrativeRef.current = narrative;
            formRef.current?.requestSubmit();
          }}
          disabled={pending}
          className="w-full rounded-xl border border-input bg-background p-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Stuck? Start with one of these:</span>
          {starters.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setNarrative((prev) => appendStarter(prev, s.question))}
              className="min-h-9 rounded-full border border-dashed px-3 text-xs font-semibold text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            onClick={() => {
              savedNarrativeRef.current = narrative;
            }}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {state.status === "saved" && !justTicked && (
            <span className="text-sm font-medium text-muted-foreground" role="status">
              Saved.
            </span>
          )}
          {justTicked && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground" role="status">
              <Check className="size-4" aria-hidden /> Saved — that&apos;s enough to count as done.
            </span>
          )}
          {state.status === "error" && (
            <span className="text-sm font-medium text-destructive" role="alert">
              {state.message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

export default StoryGuide;
