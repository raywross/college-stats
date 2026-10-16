/**
 * Pure helpers for the Your story guide (specs/planner/v3/guides/your-story.md; build-plan.md "U6 Your story guide"):
 * the four starters (the old three prompts' questions, specs/planner/next-steps/your-story.md "The prompts", plus one
 * new one) and the auto-tick rule. No React, no server import; safe in client components and tests.
 */
import { STORY_DONE_CHARS } from "../student-profile.ts";

export interface StoryStarter {
  id: "about" | "thread" | "major" | "changed_mind";
  /** The chip's own label. */
  label: string;
  /** What it appends to the field. */
  question: string;
}

/**
 * The four starters (build-plan.md "Deliver" 1: "the old three prompts' questions plus 'A moment you changed your
 * mind'"). `majorName`, already lowercased by the caller (lib/chances/depth.ts's own convention), fills the third
 * one when the student has an intended major; without one it stays generic.
 */
export function storyStarters(majorName: string | null): StoryStarter[] {
  return [
    {
      id: "about",
      label: "What your grades don't say",
      question: "What should someone reading your application know about you that your grades don't say?",
    },
    {
      id: "thread",
      label: "What ties your activities together",
      question: "What ties the things you've spent your time on together?",
    },
    {
      id: "major",
      label: majorName ? `Why ${majorName}` : "Why your major",
      question: majorName ? `Why ${majorName}, in a few sentences?` : "Why this major, in a few sentences?",
    },
    {
      id: "changed_mind",
      label: "A moment you changed your mind",
      question: "Describe a moment you changed your mind.",
    },
  ];
}

/**
 * A starter's question appended as a new line (your-story.md "The field": "tapping one appends its question as a
 * line in the text for the student to answer, so the field stays one narrative"). An empty field just gets the
 * question; trailing whitespace on what's there is dropped first so a starter never lands on a blank line.
 */
export function appendStarter(text: string, question: string): string {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed === "" ? question : `${trimmed}\n${question}`;
}

/**
 * The auto-tick rule (your-story.md "Footer": "the move's Done … also ticked automatically once the story has at
 * least 200 characters"; build-plan.md "Deliver" 1: "when a save first brings the narrative to STORY_DONE_CHARS or
 * more"): true exactly when a save's narrative length crosses STORY_DONE_CHARS that it hadn't already reached before
 * that save, so a caller that ticks once on `true` and remembers it never ticks twice, and a story that was already
 * long when the guide opened never re-ticks on its next ordinary save.
 */
export function crossesStoryDone(beforeLength: number, afterLength: number): boolean {
  return beforeLength < STORY_DONE_CHARS && afterLength >= STORY_DONE_CHARS;
}
