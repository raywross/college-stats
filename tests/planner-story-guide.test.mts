/**
 * The Your story guide's pure helpers (lib/planner/story-guide.ts; specs/planner/v3/guides/your-story.md): the four
 * starters append their question as a new line, and the auto-tick rule fires exactly once, the first time a save
 * crosses STORY_DONE_CHARS. Also a source-level guard that the guide's guardian branch never renders a `<textarea>`
 * or any other input, and that `StoryCard` (deleted this unit) is gone from the registry. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendStarter, crossesStoryDone, storyStarters } from "../lib/planner/story-guide.ts";
import { STORY_DONE_CHARS } from "../lib/student-profile.ts";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* storyStarters                                                       */
/* ------------------------------------------------------------------ */

test("storyStarters: the old three prompts' questions plus one new one", () => {
  const starters = storyStarters(null);
  assert.equal(starters.length, 4);
  assert.deepEqual(starters.map((s) => s.id), ["about", "thread", "major", "changed_mind"]);
  // The old three prompts' own questions (specs/planner/next-steps/your-story.md "The prompts"), not paraphrased.
  assert.equal(starters[0].question, "What should someone reading your application know about you that your grades don't say?");
  assert.equal(starters[1].question, "What ties the things you've spent your time on together?");
  assert.equal(starters[3].label, "A moment you changed your mind");
  // Without a major, the third starter stays generic.
  assert.equal(starters[2].label, "Why your major");
  assert.equal(starters[2].question, "Why this major, in a few sentences?");
});

test("storyStarters: the third fills in the intended major", () => {
  const starters = storyStarters("engineering");
  assert.equal(starters[2].label, "Why engineering");
  assert.equal(starters[2].question, "Why engineering, in a few sentences?");
});

/* ------------------------------------------------------------------ */
/* appendStarter                                                       */
/* ------------------------------------------------------------------ */

test("appendStarter: an empty field just gets the question", () => {
  assert.equal(appendStarter("", "What ties the things you've spent your time on together?"), "What ties the things you've spent your time on together?");
  assert.equal(appendStarter("   ", "Q?"), "Q?");
});

test("appendStarter: existing text gets the question as a new line, trailing whitespace dropped first", () => {
  assert.equal(appendStarter("I run track.", "Q?"), "I run track.\nQ?");
  assert.equal(appendStarter("I run track.\n\n  ", "Q?"), "I run track.\nQ?");
});

test("appendStarter: tapping two starters keeps the narrative one piece, each on its own line", () => {
  let text = "";
  text = appendStarter(text, "First?");
  text = appendStarter(text, "Second?");
  assert.equal(text, "First?\nSecond?");
});

/* ------------------------------------------------------------------ */
/* crossesStoryDone: the auto-tick rule                                 */
/* ------------------------------------------------------------------ */

test("crossesStoryDone: true exactly when a save first reaches STORY_DONE_CHARS", () => {
  assert.equal(crossesStoryDone(150, 200), true, "crosses the line");
  assert.equal(crossesStoryDone(150, 199), false, "still short");
  assert.equal(crossesStoryDone(200, 250), false, "already there before this save");
  assert.equal(crossesStoryDone(0, 0), false, "empty stays empty");
  assert.equal(crossesStoryDone(STORY_DONE_CHARS, STORY_DONE_CHARS), false, "already done, not a fresh crossing");
  assert.equal(crossesStoryDone(STORY_DONE_CHARS - 1, STORY_DONE_CHARS), true, "the exact boundary, from just under");
});

test("crossesStoryDone: a save that trims back below the line and later grows past it again fires once more (the caller's own 'already ticked' flag is what makes it fire only once per guide session, not this rule)", () => {
  // 250 -> 100 (trimmed below) -> 210 (grown past again): the rule reports a fresh crossing the second time, same as
  // the first; a caller that already ticked once for this move and remembers it is what keeps the plan's move from
  // reopening, not this pure rule (which only answers "did this one save cross the line").
  assert.equal(crossesStoryDone(100, 250), true);
  assert.equal(crossesStoryDone(250, 100), false, "going down never counts as crossing");
  assert.equal(crossesStoryDone(100, 210), true);
});

test("crossesStoryDone: planted bad rule — 'at or over 200' alone, with no 'was under before', would re-tick on every save once written", () => {
  const naive = (_before: number, after: number) => after >= STORY_DONE_CHARS;
  // The real rule and the naive one agree on a fresh crossing…
  assert.equal(crossesStoryDone(150, 200), naive(150, 200));
  // …but disagree once the story is already long and gets saved again (a routine edit, not a fresh crossing):
  // the naive rule would have the caller call tick() every single save forever.
  assert.equal(crossesStoryDone(900, 950), false);
  assert.equal(naive(900, 950), true);
});

/* ------------------------------------------------------------------ */
/* Source guards                                                       */
/* ------------------------------------------------------------------ */

test("StoryGuide.tsx: the guardian's branch renders no textarea or other input, just the one line", () => {
  const src = readFileSync(join(ROOT, "components/planner/guides/StoryGuide.tsx"), "utf8");
  const guardianFn = src.slice(src.indexOf("function GuardianView"), src.indexOf("function Frame"));
  // QA fix (2026-10-16, finding 5): the line is now the shared `guardianStoryLine` helper (lib/student-profile.ts),
  // not a fixed "{name} has written…" template with a "They" fallback — that disagreed in number ("They has").
  assert.match(guardianFn, /guardianStoryLine\(firstName, written\)/);
  assert.doesNotMatch(guardianFn, /<textarea/i);
  assert.doesNotMatch(guardianFn, /<input/i);
  assert.doesNotMatch(guardianFn, /<form/i);

  // The main component returns the guardian view before reaching the field at all.
  const mainFn = src.slice(src.indexOf("export function StoryGuide("), src.indexOf("function StoryField"));
  const guardianBranch = mainFn.slice(mainFn.indexOf("if (isGuardian)"), mainFn.indexOf("if (isGuardian)") + 120);
  assert.match(guardianBranch, /return <GuardianView/);
});

test("StoryCard is gone: not imported or referenced anywhere a guide, card, or test would reach it", () => {
  const files = [
    "components/planner/moves/registry.tsx",
    "components/me/StorySection.tsx",
    "lib/planner/guides-server.ts",
    "components/planner/guides/stubs.tsx",
  ];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /StoryCard/, f);
  }
  assert.equal(
    (() => {
      try {
        readFileSync(join(ROOT, "components/planner/moves/StoryCard.tsx"), "utf8");
        return true;
      } catch {
        return false;
      }
    })(),
    false,
    "the file itself must be deleted",
  );
});
