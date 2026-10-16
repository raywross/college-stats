"use client";

/**
 * "Your story" (specs/planner/v3/guides/your-story.md): one private narrative, in the student's own words, that
 * starts the essay before anyone writes one (plan v3 U1 made it one field; U6 redesigns it). On the Numbers page
 * (/household/[person]/numbers, after the profile form) for the student themselves; a guardian sees only whether
 * it's written ("Maya has written her story" / "not yet"), never the text (lib/student-profile.ts
 * redactStoryForGuardian; parents.md "private notes stay private"). The move's card (StoryCard.tsx) is the same
 * field inline; this section and that card both save through `saveStory` (lib/student-profile-store.ts), which never
 * touches any other part of the profile.
 *
 * Plain text only: no links or formatting, pasted text kept as typed (sanitizeStory trims and caps it server-side;
 * this form only shows the running count against the same limit).
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { activitiesReading } from "@/lib/chances/depth";
import { noteText } from "@/lib/chances/notes";
import { STORY_MAX, storyLengthBand, storyMissing } from "@/lib/student-profile";
import { saveStory, type ProfileAccess, type StorySaveState } from "@/lib/student-profile-store";
import { track } from "@/lib/analytics";

function Count({ value }: { value: string }) {
  return (
    <span className="text-xs text-muted-foreground" aria-hidden>
      {value.length}/{STORY_MAX}
    </span>
  );
}

function StoryField({ id, name, value, onChange, disabled }: { id: string; name: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div>
      <textarea
        id={id}
        name={name}
        rows={8}
        maxLength={STORY_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1.5 w-full rounded-xl border border-input bg-background p-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60"
      />
      <div className="mt-1 flex justify-end">
        <Count value={value} />
      </div>
    </div>
  );
}

/** A guardian's whole view of it: "Maya has written her story." / "Maya hasn't written her story yet." */
function GuardianLine({ written, firstName }: { written: boolean; firstName: string | null }) {
  const name = firstName ?? "The student";
  return <p className="text-sm text-muted-foreground">{written ? `${name} has written their story.` : `${name} hasn't written their story yet.`}</p>;
}

export function StorySection({ profile }: { profile: ProfileAccess }) {
  const { data, student, relation, canEdit } = profile;
  const firstName = student.display_name?.trim().split(/\s+/)[0] ?? null;

  if (relation === "guardian") {
    return (
      <section className="space-y-2 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="your-story-heading">
        <h2 id="your-story-heading" className="font-display text-base font-bold">
          Your story
        </h2>
        <GuardianLine written={data.story !== null} firstName={firstName} />
        <p className="text-xs text-muted-foreground">Private to {firstName ?? "the student"}. It&apos;s never shown to a guardian, even here.</p>
      </section>
    );
  }

  return <StorySectionEditor data={data} studentId={student.id} canEdit={canEdit} />;
}

function StorySectionEditor({ data, studentId, canEdit }: { data: ProfileAccess["data"]; studentId: string; canEdit: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<StorySaveState, FormData>(saveStory, { status: "idle" });
  const [narrative, setNarrative] = useState(data.story?.narrative ?? "");
  const disabled = !canEdit || pending;

  const { notes } = activitiesReading(data.academics.activities, data.academics.awards);
  const depthLine = notes.length > 0 ? noteText(notes[0]) : null;

  useEffect(() => {
    if (state.status !== "saved") return;
    track("story_filled", { length_band: storyLengthBand(narrative) });
    router.refresh();
    // Only on a fresh "saved" result, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="your-story-heading">
      <div>
        <h2 id="your-story-heading" className="font-display text-base font-bold">
          Your story
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One page in your own words, private to you. The counselor&apos;s questionnaire and the essay both start from it.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="student_id" value={studentId} />

        <div>
          <label className="block text-sm font-semibold" htmlFor="story-narrative">
            Your story
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">What should someone reading your application know about you that your grades don&apos;t say? What ties your time together?</p>
          {data.academics.activities.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {data.academics.activities.map((a) => (
                <li key={a.id} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {a.name}
                </li>
              ))}
            </ul>
          )}
          {depthLine && <p className="mt-1.5 text-xs text-muted-foreground">{depthLine}</p>}
          <StoryField id="story-narrative" name="narrative" value={narrative} onChange={setNarrative} disabled={disabled} />
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
            {state.status === "saved" && (
              <span className="text-sm font-medium text-muted-foreground" role="status">
                Saved.
              </span>
            )}
            {state.status === "error" && (
              <span className="text-sm font-medium text-destructive" role="alert">
                {state.message}
              </span>
            )}
            {!storyMissing(data) && (
              <span className="text-xs text-muted-foreground">Done — the junior-fall move is closed.</span>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

export default StorySection;
