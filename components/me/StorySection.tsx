"use client";

/**
 * "Your story" (specs/planner/v3/guides/your-story.md): one private narrative, in the student's own words, that
 * starts the essay before anyone writes one. Plan v3 (build-plan.md "U6 Your story guide") moves the field itself
 * into its own guide page; this section, on the Numbers page (/household/[person]/numbers, after the profile form),
 * is now the status line plus a link that opens it there. A guardian sees only whether it's written ("Maya has
 * written her story" / "not yet"), never the text (lib/student-profile.ts redactStoryForGuardian; parents.md
 * "private notes stay private").
 */
import Link from "next/link";
import { guideHref } from "@/lib/planner/guides";
import { guardianStoryLine } from "@/lib/student-profile";
import type { ProfileAccess } from "@/lib/student-profile-store";

/** A guardian's whole view of it: "Maya has written their story." / "Maya hasn't written their story yet." */
function GuardianLine({ written, firstName }: { written: boolean; firstName: string | null }) {
  return <p className="text-sm text-muted-foreground">{guardianStoryLine(firstName, written)}</p>;
}

export function StorySection({ profile }: { profile: ProfileAccess }) {
  const { data, student, relation } = profile;
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

  const written = data.story !== null;
  return (
    <section className="space-y-2 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="your-story-heading">
      <h2 id="your-story-heading" className="font-display text-base font-bold">
        Your story
      </h2>
      <p className="text-sm text-muted-foreground">
        {written ? "You've written your story." : "One page in your own words, private to you. The counselor's questionnaire and the essay both start from it."}
      </p>
      <Link href={guideHref("story", { person: null, from: "numbers" })} className="inline-flex text-sm font-semibold text-primary hover:underline">
        {written ? "Open your story" : "Write your story"}
      </Link>
    </section>
  );
}

export default StorySection;
