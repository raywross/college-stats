/**
 * "None" on the intake's four activity steps (owner, 2026-10-12): stored as `academics.activitiesNone`, cleared by
 * adding an entry, counted by the progress ring, shown on Review, and sent to the estimate as `activitiesAnswered`
 * once every step is answered. The model's side is in tests/chances-model.test.mts. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProfile, sanitizeActivitiesNone, sanitizeProfile } from "../lib/student-profile.ts";
import { allActivityStepsAnswered, reconcileStepNone, stepRailSummary, stepReviewValue, toggleStepNone } from "../lib/planner/activity-steps.ts";
import { applyIntake, draftFromProfile, intakeToSave, parseIntakeSave, reviewLines, type IntakeDraft } from "../lib/planner/intake.ts";
import { profileProgress, sectionDone } from "../lib/planner/profile-progress.ts";
import { estimateInputFromProfile } from "../lib/chances/estimate-input.ts";
import { sanitizeEstimateStudent } from "../lib/chances/estimate-request.ts";
import type { ActivityEntry, AwardEntry } from "../lib/chances/types.ts";

const TODAY = "2026-10-12";
const act = (kind: ActivityEntry["kind"], name: string): ActivityEntry =>
  ({ id: `a-${name}`, kind, name, years: [10], roles: { 10: "member" }, hoursPerWeek: null, recognition: null, relatedToMajor: false }) as unknown as ActivityEntry;
const award = { key: null, name: "Science fair", tier: 3, year: 10 } as unknown as AwardEntry;

test("sanitizer: only the four step keys, only true; old profiles read as unanswered", () => {
  assert.deepEqual(sanitizeActivitiesNone({ sports: true, clubs: "yes", work: 1, other: true, extra: true }), { sports: true, other: true });
  assert.deepEqual(sanitizeActivitiesNone(null), {});
  assert.deepEqual(sanitizeActivitiesNone(["sports"]), {});
  assert.deepEqual(emptyProfile().academics.activitiesNone, {});
  const old = sanitizeProfile({ academics: { gpa: 3.5 } });
  assert.deepEqual(old.academics.activitiesNone, {}, "a profile saved before the field existed");
  const saved = sanitizeProfile({ academics: { activitiesNone: { work: true } } });
  assert.deepEqual(saved.academics.activitiesNone, { work: true });
});

test("choosing None clears that step's entries only; choosing it again leaves the step unanswered", () => {
  const a = { activities: [act("sport", "Soccer"), act("club", "Chess")], awards: [award], activitiesNone: {} };
  const sportsNone = toggleStepNone(a, "sports");
  assert.deepEqual(sportsNone.activities.map((x) => x.name), ["Chess"]);
  assert.equal(sportsNone.awards.length, 1, "awards belong to Other; untouched");
  assert.deepEqual(sportsNone.activitiesNone, { sports: true });
  const otherNone = toggleStepNone(a, "other");
  assert.deepEqual(otherNone.awards, [], "None on Other clears its awards too");
  assert.deepEqual(toggleStepNone(sportsNone, "sports").activitiesNone, {}, "tapping again un-answers it");
});

test("adding an entry clears that step's None, and only that step's", () => {
  assert.deepEqual(reconcileStepNone([act("sport", "Soccer")], [], { sports: true, work: true }), { work: true });
  assert.deepEqual(reconcileStepNone([], [award], { other: true, clubs: true }), { clubs: true }, "an award fills Other");
  assert.deepEqual(reconcileStepNone([], [], { sports: true }), { sports: true });
});

test("review and rail say None only when chosen", () => {
  assert.equal(stepReviewValue("work", [], [], true), "None");
  assert.equal(stepReviewValue("work", [], [], false), "Not added");
  assert.equal(stepReviewValue("sports", [act("sport", "Soccer")], [], false), "Soccer");
  assert.equal(stepRailSummary("clubs", [], [], true), "None");
  assert.equal(stepRailSummary("clubs", [], [], false), null);
  const d: IntakeDraft = { ...draftFromProfile(null, 2028, TODAY), gpa: "3.8", test: "none", activitiesNone: { sports: true, clubs: true } };
  const lines = Object.fromEntries(reviewLines(d, TODAY).map((l) => [l.label, l.value]));
  assert.equal(lines.Sports, "None");
  assert.equal(lines.Clubs, "None");
  assert.equal(lines.Work, "Not added");
});

test("intake round-trip: draft → save → parse → apply → draft keeps None, and a step with entries drops it", () => {
  const p = emptyProfile();
  p.academics.activitiesNone = { work: true, other: true };
  const d = draftFromProfile(p, 2028, TODAY);
  assert.deepEqual(d.activitiesNone, { work: true, other: true });
  const filled: IntakeDraft = { ...d, gpa: "3.7", test: "none", activities: [act("work", "Job")] };
  const save = intakeToSave(filled)!;
  assert.deepEqual(save.activitiesNone, { other: true }, "an entry on Work clears its None");
  const parsed = parseIntakeSave(JSON.parse(JSON.stringify(save)))!;
  assert.deepEqual(parsed.activitiesNone, { other: true });
  const out = applyIntake(p, parsed, TODAY);
  assert.deepEqual(out.academics.activitiesNone, { other: true });
  assert.deepEqual(draftFromProfile(out, 2028, TODAY).activitiesNone, { other: true });
  // Untrusted input: junk is dropped, and None beside entries can't survive parsing.
  const bad = parseIntakeSave({ ...JSON.parse(JSON.stringify(save)), activitiesNone: { work: true, nope: true } })!;
  assert.deepEqual(bad.activitiesNone, {}, "work has an entry, nope isn't a step");
});

test("the ring counts a step done with an entry or None, never just for having seen it", () => {
  const p = emptyProfile();
  for (const s of ["sports", "clubs", "work", "other"] as const) assert.equal(sectionDone(p, s), false);
  p.academics.activitiesNone = { sports: true, work: true };
  assert.equal(sectionDone(p, "sports"), true);
  assert.equal(sectionDone(p, "work"), true);
  assert.equal(sectionDone(p, "clubs"), false);
  p.academics.awards = [award];
  assert.equal(sectionDone(p, "other"), true);
  assert.equal(profileProgress(p).done, 3);
});

test("the estimate input: activitiesAnswered only when all four steps are answered; the request keeps only a literal true", () => {
  const p = emptyProfile();
  assert.equal(estimateInputFromProfile(p, "1", null).student.activitiesAnswered, false);
  p.academics.activitiesNone = { sports: true, clubs: true, work: true };
  assert.equal(allActivityStepsAnswered(p.academics.activities, p.academics.awards, p.academics.activitiesNone), false);
  p.academics.awards = [award];
  assert.equal(estimateInputFromProfile(p, "1", null).student.activitiesAnswered, true, "an award answers Other");
  assert.deepEqual(estimateInputFromProfile(p, "1", null).student.activities, [], "the list itself stays empty");
  assert.equal(sanitizeEstimateStudent({ activitiesAnswered: true }).activitiesAnswered, true);
  for (const v of ["true", 1, {}, null, undefined]) assert.equal(sanitizeEstimateStudent({ activitiesAnswered: v }).activitiesAnswered, false);
});
