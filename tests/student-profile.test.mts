/**
 * lib/student-profile.ts: GPA conversion, sanitizing untrusted input, completeness, and the fit predicates
 * (specs/product/student-profile.md). Pure module, no database or server needed. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "../lib/types.ts";
import {
  completeness,
  completenessScore,
  effectiveGradYear,
  emptyProfile,
  fitsPreferences,
  fitsScores,
  gpaAsEntered,
  gpaDisplay,
  isClassStanding,
  rankExpectationHint,
  rankExpectationMismatch,
  sanitizeActivities,
  sanitizeAwards,
  sanitizeClassStanding,
  sanitizeProfile,
  unweightedGpa4,
  weightedGpaHint,
  type StudentProfileData,
} from "../lib/student-profile.ts";
import { ACTIVITIES_MAX, AWARDS_MAX, CLASS_STANDING_PERCENTILE } from "../lib/chances/levels.ts";
// lib/student-profile.ts: only type-only internal imports plus lib/score-bands.ts and lib/majors.ts, both of which
// are themselves type-only internally, so this resolves under plain Node ESM (no bundler) just like those two.

/** A college shaped like data/schools.json, with only what fitsScores/fitsPreferences read. */
function school(
  id: string,
  o: {
    sat?: [number, number] | null;
    act?: [number, number] | null;
    testPolicy?: School["admissions"]["test_policy"];
    enrollment?: number;
    setting?: "city" | "suburb" | "town" | "rural" | null;
    state?: string;
    region?: string;
    type?: School["type"];
    avgPaidAll?: number | null;
  } = {},
): School {
  const sat = o.sat === undefined ? null : o.sat;
  return {
    unit_id: id,
    name: `College ${id}`,
    location: { city: "City", state: o.state ?? "MA", zip: "02138", region: o.region ?? "New England" },
    type: o.type ?? "private-nonprofit",
    admissions: {
      year: 2024,
      applicants: 1000,
      admitted: 500,
      enrolled: 200,
      acceptance_rate: 0.5,
      sat_reading_25_75: sat ? [Math.round(sat[0] / 2), Math.round(sat[1] / 2)] : null,
      sat_math_25_75: sat ? [Math.round(sat[0] / 2), Math.round(sat[1] / 2)] : null,
      act_composite_25_75: o.act === undefined ? null : o.act,
      test_submission_rate_sat: null,
      test_submission_rate_act: null,
      test_policy: o.testPolicy ?? null,
    },
    demographics: { undergrad_enrollment: o.enrollment ?? 7000 },
    campus: o.setting === undefined ? undefined : { setting: o.setting ? { locale: 11, label: "x", group: o.setting } : null },
    cost: { avg_paid_all: o.avgPaidAll === undefined ? null : o.avgPaidAll, cost_of_attendance: null } as School["cost"],
  } as unknown as School;
}

/* ------------------------------------------------------------------ */
/* GPA conversion                                                      */
/* ------------------------------------------------------------------ */

test("unweightedGpa4: 4.0 scale passes through (capped at 4.0), 5.0 scale scales proportionally", () => {
  assert.equal(unweightedGpa4(3.8, "4.0"), 3.8);
  assert.equal(unweightedGpa4(4.3, "4.0"), 4.0);
  assert.equal(unweightedGpa4(4.5, "5.0"), 3.6);
  assert.equal(unweightedGpa4(null, "4.0"), null);
});

test("unweightedGpa4: the 100-point table matches the worked example (93 -> 3.7)", () => {
  assert.equal(unweightedGpa4(93, "100"), 3.7);
  assert.equal(unweightedGpa4(100, "100"), 4.0);
  assert.equal(unweightedGpa4(97, "100"), 4.0);
  assert.equal(unweightedGpa4(64, "100"), 0.0);
  assert.equal(unweightedGpa4(80, "100"), 2.3);
});

test("gpaDisplay shows the conversion only when the scale isn't already 4.0", () => {
  assert.equal(gpaDisplay({ gpa: 3.8, gpaScale: "4.0" }), "3.8 unweighted");
  assert.equal(gpaDisplay({ gpa: 93, gpaScale: "100" }), "about 3.7 unweighted (from 93/100)");
  // A weighted GPA shows as entered (owner, 2026-10-11), never converted down: on the weighted scale, or above 4.0.
  assert.equal(gpaDisplay({ gpa: 4.5, gpaScale: "5.0" }), "4.5 weighted");
  assert.equal(gpaDisplay({ gpa: 4.4, gpaScale: "4.0" }), "4.4 weighted");
  assert.equal(gpaDisplay({ gpa: 4.0, gpaScale: "4.0" }), "4.0 unweighted");
  assert.equal(gpaDisplay({ gpa: null, gpaScale: "4.0" }), null);
});

test("gpaAsEntered: the plan's header shows the GPA as entered", () => {
  assert.equal(gpaAsEntered({ gpa: 3.82, gpaScale: "4.0" }), "3.82");
  assert.equal(gpaAsEntered({ gpa: 4.4, gpaScale: "4.0" }), "4.4 weighted");
  assert.equal(gpaAsEntered({ gpa: 4.4, gpaScale: "5.0" }), "4.4 weighted");
  assert.equal(gpaAsEntered({ gpa: 93, gpaScale: "100" }), "93/100");
  assert.equal(gpaAsEntered({ gpa: null, gpaScale: "4.0" }), null);
});

/* ------------------------------------------------------------------ */
/* Sanitizing                                                          */
/* ------------------------------------------------------------------ */

test("sanitizeProfile never throws on garbage and always returns a complete shape", () => {
  assert.deepEqual(sanitizeProfile(null), emptyProfile());
  assert.deepEqual(sanitizeProfile("not an object"), emptyProfile());
  assert.deepEqual(sanitizeProfile([1, 2, 3]), emptyProfile());
  assert.deepEqual(sanitizeProfile({}), emptyProfile());
});

test("sanitizeProfile drops out-of-range and wrongly typed values instead of coercing them to 0", () => {
  const out = sanitizeProfile({
    tests: { satTotal: 9999, actComposite: "32", satMath: 650 },
    academics: { gpa: -1, classRankPercentile: 200 },
    plans: { intendedMajors: ["11", "not-a-family", "52", "11"] },
  });
  assert.equal(out.tests.satTotal, null, "out-of-range SAT dropped, not clamped");
  assert.equal(out.tests.actComposite, 32, "numeric strings are accepted");
  assert.equal(out.tests.satMath, 650);
  assert.equal(out.academics.gpa, null, "negative GPA dropped");
  assert.equal(out.academics.classRankPercentile, null, "percentile over 100 dropped");
  assert.deepEqual(out.plans.intendedMajors, ["11", "52"], "unknown family dropped, duplicate dropped");
});

test("sanitizeProfile caps intended majors at 3 and preferences at their lists", () => {
  const out = sanitizeProfile({ plans: { intendedMajors: ["11", "52", "42", "26"] } });
  assert.deepEqual(out.plans.intendedMajors, ["11", "52", "42"]);
});

test("sanitizeProfile allows a weighted GPA up to 120 (some high schools weight a 100-point scale above 100)", () => {
  assert.equal(sanitizeProfile({ academics: { weightedGpa: 108 } }).academics.weightedGpa, 108);
  assert.equal(sanitizeProfile({ academics: { weightedGpa: 120 } }).academics.weightedGpa, 120);
  assert.equal(sanitizeProfile({ academics: { weightedGpa: 121 } }).academics.weightedGpa, null, "over 120 dropped, not clamped");
  assert.equal(sanitizeProfile({ academics: { weightedGpa: -1 } }).academics.weightedGpa, null);
});

/* ------------------------------------------------------------------ */
/* effectiveGradYear                                                   */
/* ------------------------------------------------------------------ */

test("effectiveGradYear: the student record's grad_year fills in when the profile has none", () => {
  assert.equal(effectiveGradYear({ gradYear: null }, 2028), 2028);
});

test("effectiveGradYear: a saved profile value wins over the student record", () => {
  assert.equal(effectiveGradYear({ gradYear: 2027 }, 2028), 2027);
});

test("effectiveGradYear: null when neither is on file", () => {
  assert.equal(effectiveGradYear({ gradYear: null }, null), null);
});

/* ------------------------------------------------------------------ */
/* Completeness                                                        */
/* ------------------------------------------------------------------ */

test("completeness lists what's missing per tool, and the score is the met fraction", () => {
  const empty = emptyProfile();
  assert.ok(completeness(empty).every((i) => !i.met));
  assert.equal(completenessScore(empty), 0);

  const withScores: StudentProfileData = { ...empty, tests: { ...empty.tests, satTotal: 1450 } };
  const items = completeness(withScores);
  assert.ok(items.find((i) => i.tool.includes("ScoreChecker"))?.met);
  assert.ok(items.find((i) => i.tool.includes("Fits my scores"))?.met);
  assert.ok(!items.find((i) => i.tool.includes("Chances"))?.met);
  assert.ok(completenessScore(withScores) > 0 && completenessScore(withScores) < 1);
});

/* ------------------------------------------------------------------ */
/* fitsScores                                                          */
/* ------------------------------------------------------------------ */

test("fitsScores: in when the score is within the SAT or ACT range", () => {
  const s = school("a", { sat: [1300, 1500] });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 1400 } };
  assert.equal(fitsScores(s, profile), "in");
});

test("fitsScores: out when the score is outside every range the college reports", () => {
  const s = school("a", { sat: [1300, 1500] });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 1100 } };
  assert.equal(fitsScores(s, profile), "out");
});

test("fitsScores: test-blind colleges are always in", () => {
  const s = school("a", { testPolicy: "not-considered" });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 900 } };
  assert.equal(fitsScores(s, profile), "in");
});

test("fitsScores: a college with no ranges at all is unknown, not out, and not in", () => {
  const s = school("a"); // no sat, no act, no test_policy
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, satTotal: 1400 } };
  assert.equal(fitsScores(s, profile), "unknown");
});

test("fitsScores: with no score on file, a reporting college is still unknown (nothing to compare)", () => {
  const s = school("a", { sat: [1300, 1500] });
  assert.equal(fitsScores(s, emptyProfile()), "unknown");
});

test("fitsScores: ACT alone can also put a student in", () => {
  const s = school("a", { act: [28, 33] });
  const profile = { ...emptyProfile(), tests: { ...emptyProfile().tests, actComposite: 30 } };
  assert.equal(fitsScores(s, profile), "in");
});

/* ------------------------------------------------------------------ */
/* fitsPreferences                                                      */
/* ------------------------------------------------------------------ */

test("fitsPreferences: everything fits when no preference is set", () => {
  const s = school("a");
  assert.equal(fitsPreferences(s, emptyProfile()), "in");
});

test("fitsPreferences: size and type must both match when both are set", () => {
  const s = school("a", { enrollment: 2000, type: "private-nonprofit" });
  const profile = { ...emptyProfile(), preferences: { ...emptyProfile().preferences, sizes: ["small" as const], types: ["private-nonprofit" as const] } };
  assert.equal(fitsPreferences(s, profile), "in");
  const mismatched = { ...profile, preferences: { ...profile.preferences, types: ["public" as const] } };
  assert.equal(fitsPreferences(s, mismatched), "out");
});

test("fitsPreferences: setting unknown (no campus.setting) is unknown, not out, when no other preference fails", () => {
  const s = school("a", { setting: null });
  const profile = { ...emptyProfile(), preferences: { ...emptyProfile().preferences, settings: ["city" as const] } };
  assert.equal(fitsPreferences(s, profile), "unknown");
});

test("fitsPreferences: one definite mismatch outranks an unknown elsewhere", () => {
  const s = school("a", { setting: null, enrollment: 30000 });
  const profile = {
    ...emptyProfile(),
    preferences: { ...emptyProfile().preferences, settings: ["city" as const], sizes: ["small" as const] },
  };
  assert.equal(fitsPreferences(s, profile), "out");
});

test("fitsPreferences: max average cost compares against avg_paid_all", () => {
  const cheap = school("a", { avgPaidAll: 15000 });
  const pricey = school("b", { avgPaidAll: 60000 });
  const profile = { ...emptyProfile(), preferences: { ...emptyProfile().preferences, maxAverageCost: 20000 } };
  assert.equal(fitsPreferences(cheap, profile), "in");
  assert.equal(fitsPreferences(pricey, profile), "out");
});

/* ------------------------------------------------------------------ */
/* Admission chances, next: class standing, activities, awards,        */
/* first generation (specs/chances/depth.md, inputs-beyond-academics.md) */
/* ------------------------------------------------------------------ */

test("sanitizeClassStanding: a pick sets the percentile from the table; a matching percentile sets the pick back; anything else leaves classStanding null", () => {
  assert.deepEqual(sanitizeClassStanding("top10", null), { classStanding: "top10", classRankPercentile: 10 });
  // The pick wins even when a different percentile is also sent.
  assert.deepEqual(sanitizeClassStanding("top5", 50), { classStanding: "top5", classRankPercentile: 5 });
  assert.deepEqual(sanitizeClassStanding(null, 25), { classStanding: "top25", classRankPercentile: 25 });
  assert.deepEqual(sanitizeClassStanding(null, 40), { classStanding: null, classRankPercentile: 40 });
  assert.deepEqual(sanitizeClassStanding(null, null), { classStanding: null, classRankPercentile: null });
  // A stored "no_rank" (the removed "my school doesn't rank" pick, owner 2026-10-12) reads as unanswered: it isn't
  // one of the accepted picks, and there's no percentile on file either.
  assert.deepEqual(sanitizeClassStanding("no_rank", null), { classStanding: null, classRankPercentile: null });
  assert.deepEqual(sanitizeClassStanding("not-a-pick", null), { classStanding: null, classRankPercentile: null });
  // Every CLASS_STANDING_PERCENTILE entry except "no_rank" (no longer an accepted pick) round-trips through the pick.
  for (const [pick, pct] of Object.entries(CLASS_STANDING_PERCENTILE)) {
    if (pick === "no_rank") continue;
    assert.equal(sanitizeClassStanding(pick, null).classRankPercentile, pct);
    if (pct !== null) assert.equal(sanitizeClassStanding(null, pct).classStanding, pick);
  }
});

test("isClassStanding: no_rank is no longer an accepted pick (owner, 2026-10-12)", () => {
  assert.equal(isClassStanding("no_rank"), false);
  assert.equal(isClassStanding("top5"), true);
});

test("sanitizeActivities: caps at ACTIVITIES_MAX, drops unnamed/invalid rows, keeps names to 60 chars, years to 9–12, hours to 1–60, a role only for a checked year", () => {
  const many = Array.from({ length: ACTIVITIES_MAX + 2 }, (_, i) => ({ id: `a${i}`, name: `Club ${i}`, kind: "club", years: [10], roles: {}, hoursPerWeek: 2, recognition: null, relatedToMajor: false }));
  assert.equal(sanitizeActivities(many).length, ACTIVITIES_MAX);
  assert.equal(sanitizeActivities([{ name: "" }]).length, 0, "an unnamed row is dropped");
  assert.equal(sanitizeActivities("nope" as unknown).length, 0);
  const long = sanitizeActivities([{ name: "x".repeat(90), kind: "club", years: [], roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false }]);
  assert.equal(long.length, 0, "a name over 60 characters is dropped, not truncated");
  const [a] = sanitizeActivities([{ name: "Robotics", kind: "club", years: [9, 13, 10], roles: { "10": "leader" }, hoursPerWeek: 90, recognition: 9, relatedToMajor: true }]);
  assert.deepEqual(a.years, [9, 10], "13 is outside 9–12");
  assert.equal(a.roles[10], "leader");
  assert.equal(a.roles[9], "member", "a checked year with no role sent defaults to member");
  assert.equal(a.hoursPerWeek, null, "90 is outside 1–60");
  assert.equal(a.recognition, null, "9 isn't one of the four tiers");
  assert.equal(a.relatedToMajor, true);
  // Duplicate ids are made unique rather than dropped.
  const [x, y] = sanitizeActivities([
    { id: "dup", name: "A", kind: "club", years: [], roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false },
    { id: "dup", name: "B", kind: "club", years: [], roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false },
  ]);
  assert.notEqual(x.id, y.id);
});

test("ACTIVITIES_MAX holds sports, clubs, work, and other together: at least the Common App's 10, at most 25", () => {
  assert.ok(ACTIVITIES_MAX >= 10 && ACTIVITIES_MAX <= 25);
});

test("sanitizeActivities: a catalog key sets kind and family from the catalog; titles are kept per checked year when the kind offers them and set the role tier; old rows read back unchanged", () => {
  const [soccer] = sanitizeActivities([
    { id: "s", name: "Soccer", kind: "club", catalogKey: "soccer", family: "math", years: [9, 11, 12], roles: { "9": "leader" }, titles: { "9": "JV", "11": "Varsity", "12": "Captain", "10": "Captain" }, hoursPerWeek: 10, recognition: 2, relatedToMajor: false },
  ]);
  assert.equal(soccer.kind, "sport", "the catalog's kind wins over the client's");
  assert.equal(soccer.family, "athletics", "the catalog's family wins over the client's");
  assert.equal(soccer.catalogKey, "soccer");
  assert.deepEqual(soccer.titles, { 9: "JV", 11: "Varsity", 12: "Captain" }, "an unchecked year's title is dropped");
  assert.deepEqual(soccer.roles, { 9: "member", 11: "member", 12: "leader" }, "the role tier follows the title, not the client's role");
  const [typed] = sanitizeActivities([
    { id: "t", name: "Bee club", kind: "club", catalogKey: "no_such_club", family: "science", years: [10], roles: { "10": "officer" }, titles: { "10": "Captain" }, hoursPerWeek: null, recognition: null, relatedToMajor: false },
  ]);
  assert.equal(typed.catalogKey, undefined, "an unknown catalog key is dropped, the row stays as typed");
  assert.equal(typed.family, "science");
  assert.equal(typed.titles, undefined, "Captain isn't a club title");
  assert.equal(typed.roles[10], "officer", "without a valid title, the sent role stands");
  const [bad] = sanitizeActivities([{ id: "b", name: "X", kind: "club", family: "astrology", years: [], roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false }]);
  assert.equal(bad.family, undefined);
  const old = { id: "o", name: "Robotics", kind: "club", years: [10], roles: { 10: "officer" }, hoursPerWeek: 4, recognition: null, relatedToMajor: false };
  assert.deepEqual(sanitizeActivities([old]), [old], "a row saved before the catalogs reads back exactly");
});

test("sanitizeAwards: caps at AWARDS_MAX, a catalog key takes its name and tier from the catalog (never the client's), an unknown key drops the row, 'Something else' needs a name and a tier", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, key: null, name: `Award ${i}`, tier: 4, year: null }));
  assert.equal(sanitizeAwards(many).length, AWARDS_MAX);
  const [fromCatalog] = sanitizeAwards([{ key: "honor_roll", name: "Hacked name", tier: 1, year: 11 }]);
  assert.equal(fromCatalog.name, "Honor roll", "the catalog's name wins over whatever the client sent");
  assert.equal(fromCatalog.tier, 4, "the catalog's tier wins too");
  assert.equal(sanitizeAwards([{ key: "not_a_real_award" }]).length, 0, "an unknown key drops the row");
  assert.equal(sanitizeAwards([{ key: null, name: "", tier: 2 }]).length, 0, "'Something else' needs a name");
  assert.equal(sanitizeAwards([{ key: null, name: "Science fair", tier: 9 }]).length, 0, "and a real tier");
  const [other] = sanitizeAwards([{ key: null, name: "Science fair", tier: 2, year: 10 }]);
  assert.deepEqual(other, { id: "award-1", key: null, name: "Science fair", tier: 2, year: 10 });
});

test("A profile saved before class standing, activities, awards, or first generation existed reads as the documented defaults", () => {
  const old = sanitizeProfile({ academics: { gpa: 3.5 } });
  assert.equal(old.academics.classStanding, null);
  assert.equal(old.academics.classRankPercentile, null);
  assert.deepEqual(old.academics.activities, []);
  assert.deepEqual(old.academics.awards, []);
  assert.equal(old.academics.firstGeneration, null);
  assert.equal(emptyProfile().academics.firstGeneration, null);
});

test("firstGeneration: yes/no/not set, never coerced to false", () => {
  assert.equal(sanitizeProfile({ academics: { firstGeneration: true } }).academics.firstGeneration, true);
  assert.equal(sanitizeProfile({ academics: { firstGeneration: false } }).academics.firstGeneration, false);
  assert.equal(sanitizeProfile({ academics: {} }).academics.firstGeneration, null);
  assert.equal(sanitizeProfile({ academics: { firstGeneration: "yes" } }).academics.firstGeneration, true);
});

test("sanitizeProfile: classStanding and activities/awards round-trip through the whole profile", () => {
  const p = sanitizeProfile({
    academics: {
      classStanding: "top10",
      activities: [{ id: "a", name: "Soccer", kind: "sport", years: [11, 12], roles: { "11": "member", "12": "leader" }, hoursPerWeek: 10, recognition: 3, relatedToMajor: false }],
      awards: [{ key: "ap_scholar", year: 12 }],
    },
  });
  assert.equal(p.academics.classStanding, "top10");
  assert.equal(p.academics.classRankPercentile, 10);
  assert.equal(p.academics.activities.length, 1);
  assert.equal(p.academics.awards[0]?.name, "AP Scholar");
});

/* ------------------------------------------------------------------ */
/* Grades inputs, U11: weightedGpa, rankExpectation (inputs-beyond-     */
/* academics.md, method/standing.md "Revision 1")                      */
/* ------------------------------------------------------------------ */

test("rankExpectation: sanitized to a known value or null; a profile saved before it existed reads as null", () => {
  assert.equal(sanitizeProfile({ academics: { rankExpectation: "valedictorian" } }).academics.rankExpectation, "valedictorian");
  assert.equal(sanitizeProfile({ academics: { rankExpectation: "salutatorian" } }).academics.rankExpectation, "salutatorian");
  assert.equal(sanitizeProfile({ academics: { rankExpectation: "not-a-pick" } }).academics.rankExpectation, null);
  assert.equal(sanitizeProfile({ academics: {} }).academics.rankExpectation, null);
  assert.equal(emptyProfile().academics.rankExpectation, null);
});

test("rankExpectationMismatch: valedictorian implies top1, salutatorian top1 or top5; either side unset is never a mismatch", () => {
  assert.equal(rankExpectationMismatch("top1", "valedictorian"), false);
  assert.equal(rankExpectationMismatch("top5", "valedictorian"), true, "valedictorian expects top 1%, not top 5%");
  assert.equal(rankExpectationMismatch("top25", "valedictorian"), true);
  assert.equal(rankExpectationMismatch("top1", "salutatorian"), false);
  assert.equal(rankExpectationMismatch("top5", "salutatorian"), false);
  assert.equal(rankExpectationMismatch("top10", "salutatorian"), true);
  assert.equal(rankExpectationMismatch(null, "valedictorian"), false, "nothing to reconcile without a class-standing pick");
  assert.equal(rankExpectationMismatch("top25", null), false, "nothing to reconcile without an expectation");
});

test("rankExpectationHint: names which pick to fix, only when they disagree", () => {
  assert.equal(rankExpectationHint("top25", "valedictorian"), "Valedictorian is usually top 1%. Update your class standing to match, or change this if it's not right.");
  assert.equal(rankExpectationHint("top10", "salutatorian"), "Salutatorian is usually top 5%. Update your class standing to match, or change this if it's not right.");
  assert.equal(rankExpectationHint("top1", "valedictorian"), null);
  assert.equal(rankExpectationHint(null, "valedictorian"), null);
});

test("weightedGpaHint: a weighted GPA below the unweighted one asks the student to check, only on a 4- or 5-point scale", () => {
  assert.equal(weightedGpaHint(3.8, "4.0", 3.6), "A weighted GPA is usually higher than unweighted. Check these two numbers.");
  assert.equal(weightedGpaHint(3.8, "4.0", 4.2), null, "higher than unweighted is the normal case");
  assert.equal(weightedGpaHint(3.8, "4.0", 3.8), null, "equal isn't below");
  assert.equal(weightedGpaHint(92, "100", 85), null, "the 100-point scale isn't compared (different families)");
  assert.equal(weightedGpaHint(null, "4.0", 3.6), null, "no unweighted GPA yet");
  assert.equal(weightedGpaHint(3.8, "4.0", null), null, "no weighted GPA yet");
});

test("story (plan v3, guides/your-story.md): one narrative round-trips through sanitizeProfile; plain text, STORY_MAX; null when empty", async () => {
  const { emptyProfile: empty, sanitizeProfile: sanitize, sanitizeStory, STORY_MAX } = await import("../lib/student-profile.ts");
  assert.equal(STORY_MAX, 2000);
  assert.equal(empty().story, null);
  assert.equal(sanitize({}).story, null, "an older profile without a story reads as none");
  const story = { narrative: "I fix bikes for neighbors.\n\nMaking things work again.", updatedAt: "2026-10-14T12:00:00.000Z" };
  const saved = sanitize({ ...empty(), story });
  assert.deepEqual(saved.story, story);
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(saved))).story, story, "round-trips through JSON");
  // Plain text: tags and control characters go; the narrative is capped; a bad timestamp is dropped.
  assert.deepEqual(sanitizeStory({ narrative: "<b>Bold</b> move\u0007", updatedAt: "yesterday" }), { narrative: "Bold move", updatedAt: null });
  assert.equal(sanitizeStory({ narrative: "x".repeat(STORY_MAX + 50) })?.narrative.length, STORY_MAX, "capped at STORY_MAX");
  assert.equal(sanitizeStory({ narrative: "  <i></i> " }), null, "an empty narrative is no story");
  assert.equal(sanitizeStory("a string"), null);
});

test("story: the built three-prompt shape is joined into one narrative (review note 4)", async () => {
  const { sanitizeProfile: sanitize, sanitizeStory, STORY_MAX } = await import("../lib/student-profile.ts");
  const old = { about: "I fix bikes.", thread: "Making things work.", majorWhy: "Robots.", updatedAt: "2026-10-14T12:00:00.000Z" };
  assert.deepEqual(sanitizeStory(old), {
    narrative: "About you: I fix bikes.\n\nThe thread: Making things work.\n\nWhy this major: Robots.",
    updatedAt: old.updatedAt,
  });
  // Only the non-empty answers, in order.
  assert.equal(sanitizeStory({ about: "", thread: "Making things work.", majorWhy: "  " })?.narrative, "The thread: Making things work.");
  assert.equal(sanitizeStory({ about: " ", thread: "", majorWhy: "<i></i>" }), null, "all three empty is no story");
  // The join is capped too.
  const long = sanitizeStory({ about: "a".repeat(1500), thread: "b".repeat(1500), majorWhy: "" });
  assert.equal(long?.narrative.length, STORY_MAX);
  // A saved old profile reads in the new shape, and its next save writes it.
  const read = sanitize({ story: old });
  assert.deepEqual(Object.keys(read.story ?? {}).sort(), ["narrative", "updatedAt"]);
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(read))).story, read.story, "the new shape round-trips");
});

test("connections (plan v3, connections.md): sanitized, empty entries dropped, one per college, capped at CONNECTIONS_MAX", async () => {
  const { emptyProfile: empty, sanitizeProfile: sanitize, sanitizeConnections, connectionFor, CONNECTIONS_MAX } = await import("../lib/student-profile.ts");
  assert.deepEqual(empty().academics.connections, []);
  assert.deepEqual(sanitize({}).academics.connections, [], "a profile saved before connections reads as none");
  const duke = { id: "c1", unitId: "198419", family: ["parent", "bogus", "parent"], recruited: "none" };
  const mich = { id: "c2", unitId: "170976", family: [], recruited: "contact" };
  const out = sanitizeConnections([duke, mich, { id: "c3", unitId: "110635", family: [], recruited: "none" }, { id: "c4", unitId: "198419", family: ["sibling"], recruited: "none" }, { unitId: "", family: ["parent"] }, { unitId: "1234567890123", family: ["parent"] }]);
  assert.deepEqual(out, [
    { id: "c1", unitId: "198419", family: ["parent"], recruited: "none" },
    { id: "c2", unitId: "170976", family: [], recruited: "contact" },
  ], "nothing set dropped; a second Duke dropped; no unit id or one over 12 characters dropped");
  // Planted: an entry with nothing set must not survive.
  assert.equal(sanitizeConnections([{ id: "x", unitId: "110635", family: [], recruited: "none" }]).length, 0);
  assert.equal(sanitizeConnections(Array.from({ length: 15 }, (_, i) => ({ unitId: String(100000 + i), family: ["sibling"] }))).length, CONNECTIONS_MAX);
  // Round trip through the profile; connectionFor reads by unit id.
  const p = sanitize({ academics: { connections: [duke, mich] } });
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(p))).academics.connections, p.academics.connections);
  assert.equal(connectionFor(p, "170976")?.recruited, "contact");
  assert.equal(connectionFor(p, "999999"), null);
  assert.equal(connectionFor(null, "170976"), null);
});

test("activitiesNone keeps the Connections step's None", async () => {
  const { sanitizeActivitiesNone } = await import("../lib/student-profile.ts");
  assert.deepEqual(sanitizeActivitiesNone({ connections: true, sports: true, bogus: true }), { sports: true, connections: true });
});

test("recommenders (plan v3, guides/recommenders.md): sanitized, ranked 1..n, capped at RECOMMENDERS_MAX; recommendersAsked counts asked/agreed/invited", async () => {
  const { emptyProfile: empty, sanitizeProfile: sanitize, sanitizeRecommenders, recommendersAsked, RECOMMENDERS_MAX, RECOMMENDER_NAME_MAX } = await import("../lib/student-profile.ts");
  assert.deepEqual(empty().recommenders, []);
  assert.deepEqual(sanitize({}).recommenders, [], "a profile saved before recommenders reads as none");
  const rows = sanitizeRecommenders([
    { id: "r1", name: "Ms. Ortiz", subject: "English", courseId: "c-eng", years: [11, 11, 8], rank: 2, status: "asked", askedOn: "2027-03-02", agreedOn: "soon", invitedOn: null },
    { id: "r2", name: "Mr. Lee", subject: null, years: [10], rank: 1, status: "bogus" },
    { id: "r3", name: "", status: "asked" },
    { id: "r4", name: "x".repeat(RECOMMENDER_NAME_MAX + 1) },
  ]);
  assert.deepEqual(rows, [
    { id: "r2", name: "Mr. Lee", subject: null, courseId: null, years: [10], rank: 1, status: "thinking", askedOn: null, agreedOn: null, invitedOn: null },
    { id: "r1", name: "Ms. Ortiz", subject: "English", courseId: "c-eng", years: [11], rank: 2, status: "asked", askedOn: "2027-03-02", agreedOn: null, invitedOn: null },
  ]);
  const many = sanitizeRecommenders(Array.from({ length: 7 }, (_, i) => ({ name: `Teacher ${i}`, status: "agreed" })));
  assert.equal(many.length, RECOMMENDERS_MAX, "capped at four");
  assert.deepEqual(many.map((r) => r.rank), [1, 2, 3, 4]);
  const p = sanitize({ recommenders: [...rows, { name: "Dr. Kim", status: "invited" }] });
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(p))).recommenders, p.recommenders, "round-trips");
  assert.equal(recommendersAsked(p), 2);
  assert.equal(recommendersAsked(null), 0);
});

test("tests.registeredDates (plan v3): kept only for keys also in plannedDates", async () => {
  const { emptyProfile: empty, sanitizeProfile: sanitize } = await import("../lib/student-profile.ts");
  assert.deepEqual(empty().tests.registeredDates, []);
  assert.deepEqual(sanitize({}).tests.registeredDates, []);
  const p = sanitize({ tests: { plannedDates: ["sat_2026_10", "act_2026_12"], registeredDates: ["sat_2026_10", "sat_2027_03", "nope", "sat_2026_10"] } });
  assert.deepEqual(p.tests.registeredDates, ["sat_2026_10"], "a date not planned (or not a key) is dropped; no duplicates");
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(p))).tests, p.tests);
});
