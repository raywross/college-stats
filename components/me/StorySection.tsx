"use client";

/**
 * "Your story" (specs/planner/next-steps/your-story.md): three short, private prompts that start the narrative
 * before anyone writes an essay — About you, The thread, and Why this major. On the Numbers page
 * (/household/[person]/numbers, after the profile form) for the student themselves; a guardian sees only whether
 * it's written ("Maya has written her story" / "not yet"), never the text (lib/student-profile.ts
 * redactStoryForGuardian; parents.md "private notes stay private"). The move's card (StoryCard.tsx) is the same
 * three prompts inline, for junior fall's "Write your story" and the senior move that offers them to a student who
 * skipped it; this section and that card both save through `saveStory` (lib/student-profile-store.ts), which never
 * touches any other part of the profile.
 *
 * Plain text only: no links or formatting, pasted text kept as typed (sanitizeStory trims and caps it server-side;
 * this form only shows the running count against the same limit).
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { activitiesReading } from "@/lib/chances/depth";
import { noteText } from "@/lib/chances/notes";
import { majorFamilyName } from "@/lib/majors";
import { STORY_MAX, storyMissing } from "@/lib/student-profile";
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
        rows={3}
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
  const [about, setAbout] = useState(data.story?.about ?? "");
  const [thread, setThread] = useState(data.story?.thread ?? "");
  const [majorWhy, setMajorWhy] = useState(data.story?.majorWhy ?? "");
  const major = data.plans.intendedMajors[0] ?? null;
  const majorName = major ? majorFamilyName(major) : null;
  const disabled = !canEdit || pending;

  const { notes } = activitiesReading(data.academics.activities, data.academics.awards);
  const depthLine = notes.length > 0 ? noteText(notes[0]) : null;

  useEffect(() => {
    if (state.status !== "saved") return;
    const filled = [about, thread, majorName ? majorWhy : null].filter((v) => v !== null && v.trim() !== "").length;
    track("story_filled", { count: filled });
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
          Three short prompts, private to you. No one reads or rewrites them — the counselor&apos;s questionnaire and the essay both start from your own words.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="student_id" value={studentId} />

        <div>
          <label className="block text-sm font-semibold" htmlFor="story-about">
            About you
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">What should someone reading your application know about you that your grades don&apos;t say?</p>
          <StoryField id="story-about" name="about" value={about} onChange={setAbout} disabled={disabled} />
        </div>

        <div>
          <label className="block text-sm font-semibold" htmlFor="story-thread">
            The thread
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">What ties the things you&apos;ve spent your time on together?</p>
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
          <StoryField id="story-thread" name="thread" value={thread} onChange={setThread} disabled={disabled} />
        </div>

        {majorName ? (
          <div>
            <label className="block text-sm font-semibold" htmlFor="story-major-why">
              Why {majorName}?
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">In a few sentences; &quot;not sure yet&quot; is a fine answer.</p>
            <StoryField id="story-major-why" name="majorWhy" value={majorWhy} onChange={setMajorWhy} disabled={disabled} />
          </div>
        ) : (
          // No intended major yet: kept off the form but the saved value (if any) still travels with the submit, so
          // picking a major later doesn't need a return visit to see what's already there.
          <input type="hidden" name="majorWhy" value={majorWhy} />
        )}

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
