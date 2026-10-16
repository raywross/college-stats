"use client";

/**
 * The move card for kind `story` (specs/planner/next-steps/your-story.md): junior fall's "Write your story", and the
 * senior move that offers the same three prompts to a student who skipped it (your-story.md "Open questions" 1, the
 * owner's "yes"). The three prompts inline, the same shape as components/me/StorySection.tsx, saved through the same
 * `saveStory` action — a write here never touches any other part of the profile. A guardian sees only whether it's
 * written ("Maya has written her story" / "not yet"), never the text or an edit control; everyone sees everything
 * else the plan shows them (specs/chances/depth.md "Where it shows"), but the student's own words stay the
 * student's (parents.md "private notes stay private").
 *
 * `readOnly` lets another kind's card (the summer essay move's "Start from your story") embed this one beside its
 * own task, showing the three answers without inputs — U5's card passes it; see this file's note at the bottom for
 * what to wire up there.
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { activitiesReading } from "@/lib/chances/depth";
import { noteText } from "@/lib/chances/notes";
import { STORY_MAX, storyLengthBand, storyMissing } from "@/lib/student-profile";
import { saveStory, type StorySaveState } from "@/lib/student-profile-store";
import { taskDateLabel } from "@/lib/planner/tasks";
import { track } from "@/lib/analytics";
import type { MoveCardProps } from "./types";

function Count({ value }: { value: string }) {
  return (
    <span className="text-xs text-muted-foreground" aria-hidden>
      {value.length}/{STORY_MAX}
    </span>
  );
}

function StoryField({ id, name, label, value, onChange, disabled }: { id: string; name: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={6}
        maxLength={STORY_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-xl border border-input bg-background p-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60"
      />
      <div className="mt-0.5 flex justify-end">
        <Count value={value} />
      </div>
    </div>
  );
}

/** The read-only text, for `readOnly` (the essay move's "Start from your story") and for a guardian's own view. */
function StoryReadOnly({ narrative }: { narrative: string }) {
  return <p className="mt-2 whitespace-pre-line text-sm">{narrative || <span className="text-muted-foreground">Not written yet.</span>}</p>;
}

export function StoryCard({ task, ctx, onSkip, pending, readOnly }: MoveCardProps & { readOnly?: boolean }) {
  const date = taskDateLabel(task, ctx.today);
  const data = ctx.profile;
  const story = data?.story ?? null;
  const isGuardian = ctx.viewer.relation !== "self";
  const firstName = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;

  if (isGuardian) {
    return (
      <div className="rounded-xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold">{task.title}</p>
          <span className="shrink-0 text-sm text-muted-foreground">{date ?? "this season"}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{story !== null ? `${firstName ?? "They"} has written their story.` : `${firstName ?? "They"} hasn't written their story yet.`}</p>
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="rounded-xl bg-muted/30 p-3" id={`move-${task.id}-story`}>
        <p className="text-sm font-semibold">Your story</p>
        <StoryReadOnly narrative={story?.narrative ?? ""} />
      </div>
    );
  }

  return <StoryCardEditor task={task} ctx={ctx} onSkip={onSkip} pending={pending} />;
}

function StoryCardEditor({ task, ctx, onSkip, pending }: Pick<MoveCardProps, "task" | "ctx" | "onSkip" | "pending">) {
  const router = useRouter();
  const date = taskDateLabel(task, ctx.today);
  const studentId = ctx.student?.id ?? null;
  const data = ctx.profile;
  const story = data?.story ?? null;
  const [state, action, savePending] = useActionState<StorySaveState, FormData>(saveStory, { status: "idle" });
  const [narrative, setNarrative] = useState(story?.narrative ?? "");
  const disabled = !ctx.viewer.canEdit || savePending;

  const { notes } = data ? activitiesReading(data.academics.activities, data.academics.awards) : { notes: [] };
  const depthLine = notes.length > 0 ? noteText(notes[0]) : null;

  useEffect(() => {
    if (state.status !== "saved") return;
    track("story_filled", { length_band: storyLengthBand(narrative) });
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{task.title}</p>
        <span className="shrink-0 text-sm text-muted-foreground">{date ?? "this season"}</span>
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}

      {studentId && (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="student_id" value={studentId} />
          <div>
            <StoryField id={`${task.id}-narrative`} name="narrative" label="What should someone reading your application know about you that your grades don't say?" value={narrative} onChange={setNarrative} disabled={disabled} />
            {depthLine && <p className="mt-1 text-xs text-muted-foreground">{depthLine}</p>}
          </div>

          {ctx.viewer.canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={savePending} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
                {savePending ? "Saving…" : "Save"}
              </button>
              <button type="button" className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border" disabled={pending} onClick={() => onSkip(task)}>
                Not now
              </button>
              {state.status === "saved" && !storyMissing(data ?? null) && (
                <span className="text-xs text-muted-foreground">Saved — done for now.</span>
              )}
              {state.status === "error" && (
                <span className="text-xs font-medium text-destructive" role="alert">
                  {state.message}
                </span>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}

export default StoryCard;

/*
 * Note for U5 (Applying): the summer essay move's card ("Start from your story") can render `<StoryCard task={...}
 * ctx={ctx} view={view} onDone={...} onSkip={...} pending={...} readOnly />` beside its own content — `readOnly`
 * shows the three answers without inputs, same shape whichever student or no student has filled them. Not wired up
 * here since this unit doesn't own the essay generator or its card (lib/planner/generators/apply.ts,
 * components/planner/moves/SubmitCard.tsx) — see this build's final report for the same note.
 */
