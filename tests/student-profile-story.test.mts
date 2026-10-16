/**
 * Your story (specs/planner/v3/guides/your-story.md; plan v3 build-plan.md "Profile"): one narrative, `storyMissing`'s
 * 200-character rule, the guardian strip (lib/student-profile.ts `redactStoryForGuardian`/`profileForViewer`, wired into
 * lib/student-profile-store.ts `profilesICanSee`), the admin console's export never carrying the text, `saveStory`
 * reading the one `narrative` field, and the `story_missing` applies-key closing the "Write your story" move once the
 * narrative reaches STORY_DONE_CHARS. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyProfile,
  guardianStoryLine,
  profileForViewer,
  redactStoryForGuardian,
  sanitizeProfile,
  storyLengthBand,
  storyMissing,
  STORY_DONE_CHARS,
  STORY_MAX,
  type StudentProfileData,
} from "../lib/student-profile.ts";
import { generate } from "../lib/planner/generators/season.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import { gradeOf, seasonOf } from "../lib/planner/seasons.ts";
import { applyMerge, isOpen, mergeTasks } from "../lib/planner/tasks.ts";
import type { GeneratorInput, PlanTask } from "../lib/planner/types.ts";

const story = (narrative: string, updatedAt: string | null = "2026-10-14T12:00:00.000Z") => ({ narrative, updatedAt });

test("the limits: STORY_MAX 2,000, done at 200", () => {
  assert.equal(STORY_MAX, 2000);
  assert.equal(STORY_DONE_CHARS, 200);
});

test("storyMissing: true with no story, and until the narrative reaches STORY_DONE_CHARS (trimmed)", () => {
  assert.equal(storyMissing(null), true);
  assert.equal(storyMissing({ story: null }), true);
  assert.equal(storyMissing({ story: story("x".repeat(STORY_DONE_CHARS - 1)) }), true, "199 characters is not yet");
  assert.equal(storyMissing({ story: story("x".repeat(STORY_DONE_CHARS)) }), false, "200 is written");
  // Whitespace doesn't count (sanitizeStory trims, but a hand-built fixture shouldn't fool the check either).
  assert.equal(storyMissing({ story: story(" ".repeat(150) + "x".repeat(STORY_DONE_CHARS - 1) + " ".repeat(150)) }), true);
  // Planted: a rule that only checked "anything written" would read a one-liner as done.
  const naive = (s: { narrative: string } | null) => !s || s.narrative.trim() === "";
  assert.equal(naive(story("One line.")), false);
  assert.equal(storyMissing({ story: story("One line.") }), true, "the real rule still asks for more");
});

test("storyLengthBand: short under 200, medium under 1,000, long from 1,000", () => {
  assert.equal(storyLengthBand(""), "short");
  assert.equal(storyLengthBand("x".repeat(199)), "short");
  assert.equal(storyLengthBand("x".repeat(200)), "medium");
  assert.equal(storyLengthBand("x".repeat(999)), "medium");
  assert.equal(storyLengthBand("x".repeat(1000)), "long");
});

test("redactStoryForGuardian: text becomes '', updatedAt survives; null in, null out", () => {
  const s = story("I fix bikes.");
  assert.deepEqual(redactStoryForGuardian(s), { narrative: "", updatedAt: s.updatedAt });
  assert.equal(redactStoryForGuardian(null), null);
});

// QA fix (2026-10-16): the fixed "They has written their story" template didn't agree in number. A name takes
// singular "has"; no name falls back to "Your student" (also singular), never the ungrammatical "They has".
test("guardianStoryLine: a name reads 'has'/'hasn't'; no name falls back to 'Your student', never 'They has'", () => {
  assert.equal(guardianStoryLine("Maya", true), "Maya has written their story.");
  assert.equal(guardianStoryLine("Maya", false), "Maya hasn't written their story yet.");
  assert.equal(guardianStoryLine(null, true), "Your student has written their story.");
  assert.equal(guardianStoryLine(null, false), "Your student hasn't written their story yet.");
  for (const written of [true, false]) {
    assert.doesNotMatch(guardianStoryLine(null, written), /\bThey has\b/);
  }
});

test("profileForViewer: a guardian's copy carries no story text (but keeps updatedAt, so 'has written' survives); the student's own copy is untouched", () => {
  const s = story("I fix bikes. Making things work.");
  const data = { ...sanitizeProfile({}), story: s };

  const asSelf = profileForViewer(data, "self");
  assert.deepEqual(asSelf.story, s, "the student sees their own words");
  assert.equal(asSelf, data, "unchanged reference: no copy needed for the student");

  const asGuardian = profileForViewer(data, "guardian");
  assert.deepEqual(asGuardian.story, { narrative: "", updatedAt: s.updatedAt });

  // Planted: a loader that forgets to strip would just return `data` back unchanged for a guardian too.
  const forgotToStrip = data;
  assert.notDeepEqual(forgotToStrip.story, asGuardian.story, "the forgetful version would fail this guard");

  // Nothing else on the profile moves.
  assert.deepEqual({ ...asGuardian, story: null }, { ...data, story: null });
});

test("profileForViewer: a guardian's copy of an old three-prompt story is stripped too", () => {
  const data = sanitizeProfile({ story: { about: "I fix bikes.", thread: "Making things work.", majorWhy: "", updatedAt: "2026-10-14T12:00:00.000Z" } });
  assert.match(data.story?.narrative ?? "", /^About you: I fix bikes\./);
  assert.deepEqual(profileForViewer(data, "guardian").story, { narrative: "", updatedAt: "2026-10-14T12:00:00.000Z" });
});

test("profileForViewer: a guardian sees 'not yet' correctly when nothing was ever written", () => {
  const data = sanitizeProfile({});
  assert.equal(data.story, null);
  assert.equal(profileForViewer(data, "guardian").story, null);
});

test("lib/student-profile-store.ts actually calls the guardian strip (profilesICanSee); a loader that forgets to wire it in fails this guard", () => {
  const src = readFileSync(new URL("../lib/student-profile-store.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function profilesICanSee"), src.indexOf("export async function profileFor"));
  assert.match(fn, /profileForViewer\(/, "profilesICanSee must run every row through profileForViewer, not sanitizeProfile alone");
});

test("the admin console's student view (lib/admin/people.ts adminStudent) never returns the story's text", () => {
  const src = readFileSync(new URL("../lib/admin/people.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function adminStudent"), src.indexOf("export async function logStudentView"));
  assert.match(fn, /redactStoryForGuardian\(/, "the admin console's student page must redact the story the same way a guardian's view does");
});

test("saveStory (lib/student-profile-store.ts) is student-only and reads the one `narrative` field", () => {
  const src = readFileSync(new URL("../lib/student-profile-store.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function saveStory"), src.indexOf("export async function importLocalProfile"));
  assert.match(fn, /relation\s*!==\s*"self"/, "saveStory must check relation, not just canEdit");
  assert.match(fn, /form\.get\("narrative"\)/, "the form's one field");
  assert.doesNotMatch(fn, /form\.get\("(about|thread|majorWhy)"\)/, "the three prompts are gone");
});

/* ------------------------------------------------------------------ */
/* story_filled telemetry: never the text, only a length band          */
/* ------------------------------------------------------------------ */

test("story_filled is registered with a length band only (lib/analytics.ts)", async () => {
  const { EVENTS } = await import("../lib/analytics.ts");
  const entry = EVENTS.story_filled;
  assert.ok(entry, "story_filled must be a registered event");
  assert.deepEqual(entry.properties, ["length_band"], "never the text, only how long it is, by band");
});

/* ------------------------------------------------------------------ */
/* The move: story_missing closes "Write your story" once written      */
/* ------------------------------------------------------------------ */

const LIST = "list-story-1";
const G = 2028;
// R1b (specs/planner/record/ranking.md "Timing rules moved here"): the story move's season moved from junior_fall
// to summer_before_senior, so the day used to generate it here moves too.
const STORY_DAY = "2027-07-01"; // mid summer_before_senior for the class of 2028 (tests/planner-season-generator.test.mts MID table)

function genInput(profile: StudentProfileData | null, over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: "2026-10-14T12:00:00Z", sort: null, rounds_plan_accepted_at: null },
    items: [],
    schools: {},
    profile,
    cycle: loadCycle(cycleFor(G)),
    grade: gradeOf(G, STORY_DAY),
    today: STORY_DAY,
    visits: [],
    offers: [],
    gradYear: G,
    season: seasonOf(G, STORY_DAY),
    estimates: {},
    ...over,
  } as GeneratorInput;
}

const storyTaskKey = `${LIST}:playbook:story`;
const written: StudentProfileData = { ...emptyProfile(), story: story("I fix bikes for neighbors. ".repeat(10)) };

test("'Write your story' is generated while story_missing holds, and disappears once the narrative reaches 200 characters", () => {
  assert.ok(generate(genInput(null)).some((t) => t.key === storyTaskKey), "shows with no profile on file");
  const short: StudentProfileData = { ...emptyProfile(), story: story("I fix bikes.") };
  assert.ok(generate(genInput(short)).some((t) => t.key === storyTaskKey), "a short story keeps the move open");
  assert.ok(written.story!.narrative.trim().length >= STORY_DONE_CHARS);
  assert.ok(!generate(genInput(written)).some((t) => t.key === storyTaskKey), "written: the move is gone from what's generated");
});

test("the move closes through the real merge path (generate() + mergeTasks + applyMerge), not just in the generator's own output", () => {
  const round1 = generate(genInput(null));
  const merge1 = mergeTasks([], round1);
  assert.ok(merge1.upserts.some((u) => u.key === storyTaskKey));
  let tasks: PlanTask[] = applyMerge(LIST, [], merge1, STORY_DAY);
  const storyTask = tasks.find((t) => t.key === storyTaskKey)!;
  assert.ok(storyTask, "the task exists after the first merge");
  assert.equal(isOpen(storyTask, STORY_DAY), true, "and it's open");

  const round2 = generate(genInput(written));
  assert.ok(!round2.some((t) => t.key === storyTaskKey), "no longer generated");
  const merge2 = mergeTasks(tasks, round2);
  assert.ok(merge2.orphans.includes(storyTask.id), "the previously-open task is orphaned: a generator that still emitted it would leave orphans empty");
  tasks = applyMerge(LIST, tasks, merge2, STORY_DAY);
  const after = tasks.find((t) => t.id === storyTask.id)!;
  assert.equal(isOpen(after, STORY_DAY), false, "the move is closed: no longer open");
});
