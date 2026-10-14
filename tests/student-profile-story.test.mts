/**
 * Your story (specs/planner/next-steps/your-story.md), U7: `storyMissing`'s major condition, the guardian strip
 * (lib/student-profile.ts `redactStoryForGuardian`/`profileForViewer`, wired into lib/student-profile-store.ts
 * `profilesICanSee`), the admin console's export never carrying the text, and the `story_missing` applies-key
 * closing the "Write your story" move once every applicable prompt is filled. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyProfile,
  profileForViewer,
  redactStoryForGuardian,
  sanitizeProfile,
  sanitizeStory,
  storyMissing,
  STORY_FIELD_MAX,
  STORY_MAX,
  type StudentProfileData,
} from "../lib/student-profile.ts";
import { generate } from "../lib/planner/generators/season.ts";
import { loadCycle, cycleFor } from "../lib/planner/cycle.ts";
import { gradeOf, seasonOf } from "../lib/planner/seasons.ts";
import { applyMerge, isOpen, mergeTasks } from "../lib/planner/tasks.ts";
import type { GeneratorInput, PlanTask } from "../lib/planner/types.ts";

const withMajor = (major: boolean): Pick<StudentProfileData, "plans"> => ({
  plans: { intendedMajors: major ? ["11"] : [], earlyRoundInterest: null },
});

test("STORY_MAX is the same limit the sanitizer caps each prompt at (500)", () => {
  assert.equal(STORY_MAX, 500);
  assert.equal(STORY_MAX, STORY_FIELD_MAX);
});

test("storyMissing: true with no story at all", () => {
  assert.equal(storyMissing(null), true);
  assert.equal(storyMissing({ story: null, ...withMajor(false) }), true);
});

test("storyMissing: about and thread are always required", () => {
  const base = { about: "", thread: "", majorWhy: "", updatedAt: "2026-10-14T00:00:00Z" };
  assert.equal(storyMissing({ story: { ...base }, ...withMajor(false) }), true, "nothing written");
  assert.equal(storyMissing({ story: { ...base, about: "Something." }, ...withMajor(false) }), true, "thread still blank");
  assert.equal(storyMissing({ story: { ...base, about: "Something.", thread: "Also something." }, ...withMajor(false) }), false, "both written, no major to ask about");
  // Whitespace-only is the same as blank (sanitizeStory trims, but a hand-built fixture shouldn't fool the check either).
  assert.equal(storyMissing({ story: { ...base, about: "  ", thread: "x" }, ...withMajor(false) }), true);
});

test("storyMissing: majorWhy is required only once an intended major is set (your-story.md 'or not sure yet is a fine answer')", () => {
  const filled = { about: "Something.", thread: "Also something.", majorWhy: "", updatedAt: null };
  assert.equal(storyMissing({ story: filled, ...withMajor(false) }), false, "no major: about+thread is enough");
  assert.equal(storyMissing({ story: filled, ...withMajor(true) }), true, "a major is set: majorWhy still blank");
  assert.equal(storyMissing({ story: { ...filled, majorWhy: "Because I like it." }, ...withMajor(true) }), false, "all three filled");
  // Planted: a guard that forgot the major condition (just checking about+thread) would wrongly read this as done.
  const wronglyDone = !filled.about.trim() === false && !filled.thread.trim() === false;
  assert.equal(wronglyDone, true, "about+thread alone look done — the real check must still catch the missing majorWhy");
  assert.equal(storyMissing({ story: filled, ...withMajor(true) }), true);
});

test("redactStoryForGuardian: text becomes '', updatedAt survives; null in, null out", () => {
  const story = { about: "I fix bikes.", thread: "Making things work.", majorWhy: "Because robots.", updatedAt: "2026-10-14T12:00:00.000Z" };
  assert.deepEqual(redactStoryForGuardian(story), { about: "", thread: "", majorWhy: "", updatedAt: story.updatedAt });
  assert.equal(redactStoryForGuardian(null), null);
});

test("profileForViewer: a guardian's copy carries no story text (but keeps updatedAt, so 'has written' survives); the student's own copy is untouched", () => {
  const story = { about: "I fix bikes.", thread: "Making things work.", majorWhy: "", updatedAt: "2026-10-14T12:00:00.000Z" };
  const data = { ...sanitizeProfile({}), story };

  const asSelf = profileForViewer(data, "self");
  assert.deepEqual(asSelf.story, story, "the student sees their own words");
  assert.equal(asSelf, data, "unchanged reference: no copy needed for the student");

  const asGuardian = profileForViewer(data, "guardian");
  assert.deepEqual(asGuardian.story, { about: "", thread: "", majorWhy: "", updatedAt: story.updatedAt });
  assert.notEqual(asGuardian.story?.about, story.about);

  // Planted: a loader that forgets to strip would just return `data` back unchanged for a guardian too.
  const forgotToStrip = data;
  assert.notDeepEqual(forgotToStrip.story, asGuardian.story, "the forgetful version would fail this guard");

  // Nothing else on the profile moves.
  assert.deepEqual({ ...asGuardian, story: null }, { ...data, story: null });
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

test("saveStory (lib/student-profile-store.ts) is student-only: a guardian, even with edit access, can't write it", () => {
  const src = readFileSync(new URL("../lib/student-profile-store.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function saveStory"));
  assert.match(fn, /relation\s*!==\s*"self"/, "saveStory must check relation, not just canEdit");
});

/* ------------------------------------------------------------------ */
/* story_filled telemetry: never the text, only a count                */
/* ------------------------------------------------------------------ */

test("story_filled is registered as a count-only event (lib/analytics.ts)", async () => {
  const { EVENTS } = await import("../lib/analytics.ts");
  const entry = EVENTS.story_filled;
  assert.ok(entry, "story_filled must be a registered event");
  assert.deepEqual(entry.properties, ["count"], "never the prompts' text, only how many are filled");
});

/* ------------------------------------------------------------------ */
/* The move: story_missing closes "Write your story" once filled       */
/* ------------------------------------------------------------------ */

const LIST = "list-story-1";
const G = 2028;
const JUNIOR_FALL_DAY = "2026-11-15"; // mid junior_fall for the class of 2028 (tests/planner-season-generator.test.mts MID table)

function genInput(profile: StudentProfileData | null, over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: "2026-10-14T12:00:00Z", sort: null, rounds_plan_accepted_at: null },
    items: [],
    schools: {},
    profile,
    cycle: loadCycle(cycleFor(G)),
    grade: gradeOf(G, JUNIOR_FALL_DAY),
    today: JUNIOR_FALL_DAY,
    visits: [],
    offers: [],
    gradYear: G,
    season: seasonOf(G, JUNIOR_FALL_DAY),
    estimates: {},
    ...over,
  } as GeneratorInput;
}

const storyTaskKey = `${LIST}:playbook:story`;

test("'Write your story' is generated while story_missing holds, and disappears once every applicable prompt is filled", () => {
  // No profile at all: the move is generated (missing is the default).
  const noProfile = generate(genInput(null));
  assert.ok(noProfile.some((t) => t.key === storyTaskKey), "shows with no profile on file");

  // A profile with no intended major and both required prompts filled: the move stops generating.
  const filledNoMajor: StudentProfileData = {
    ...emptyProfile(),
    story: { about: "I fix bikes for neighbors.", thread: "Making things work again.", majorWhy: "", updatedAt: "2026-10-14T12:00:00Z" },
  };
  const doneNoMajor = generate(genInput(filledNoMajor));
  assert.ok(!doneNoMajor.some((t) => t.key === storyTaskKey), "about+thread is enough with no intended major");

  // A profile with an intended major but no majorWhy: still missing.
  const majorNotAnswered: StudentProfileData = {
    ...filledNoMajor,
    plans: { intendedMajors: ["11"], earlyRoundInterest: null },
  };
  const stillOpen = generate(genInput(majorNotAnswered));
  assert.ok(stillOpen.some((t) => t.key === storyTaskKey), "a major is set but majorWhy is still blank");

  // All three answered: closed.
  const allFilled: StudentProfileData = {
    ...majorNotAnswered,
    story: { ...majorNotAnswered.story!, majorWhy: "Robots are the future." },
  };
  const closed = generate(genInput(allFilled));
  assert.ok(!closed.some((t) => t.key === storyTaskKey), "every applicable prompt filled: the move is gone from what's generated");
});

test("the move closes through the real merge path (generateTasks-equivalent generate() + mergeTasks + applyMerge), not just in the generator's own output", () => {
  // Round 1: nothing written yet — the story task is upserted and open.
  const round1 = generate(genInput(null));
  const merge1 = mergeTasks([], round1);
  assert.ok(merge1.upserts.some((u) => u.key === storyTaskKey));
  let tasks: PlanTask[] = applyMerge(LIST, [], merge1, JUNIOR_FALL_DAY);
  const storyTask = tasks.find((t) => t.key === storyTaskKey)!;
  assert.ok(storyTask, "the task exists after the first merge");
  assert.equal(isOpen(storyTask, JUNIOR_FALL_DAY), true, "and it's open");

  // Round 2: the student fills in About and The thread (no intended major) — regenerate and merge again.
  const filled: StudentProfileData = {
    ...emptyProfile(),
    story: { about: "I fix bikes for neighbors.", thread: "Making things work again.", majorWhy: "", updatedAt: "2026-10-14T12:00:00Z" },
  };
  const round2 = generate(genInput(filled));
  assert.ok(!round2.some((t) => t.key === storyTaskKey), "no longer generated");
  const merge2 = mergeTasks(tasks, round2);
  assert.ok(merge2.orphans.includes(storyTask.id), "the previously-open task is orphaned: story_missing's own guard, planted — a generator that still emitted it would leave orphans empty");
  tasks = applyMerge(LIST, tasks, merge2, JUNIOR_FALL_DAY);
  const after = tasks.find((t) => t.id === storyTask.id)!;
  assert.equal(isOpen(after, JUNIOR_FALL_DAY), false, "the move is closed: no longer open");
});
