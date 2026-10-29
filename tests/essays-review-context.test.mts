/**
 * What the reader knows (lib/essays/review-context.ts; specs/product/essays/reviewer.md "What the reader knows"): the
 * prompt, the story, the depth reading's top two, this college's other drafts and the main essay, the college's
 * factors and (for a "why us") facts, the major, connections, and interest acts. A fixture record carries everything
 * the reader must never get (the name, grades, test results, courses, the activities beyond the top two, awards' names,
 * the fee-waiver answer, the home state, the college's prices, another college's draft); a walk over the assembled
 * context proves none slipped in. The story goes as the student wrote it, with only their own name taken out.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftForReader, openingOf, reviewContext, userTurn, withoutName, type ContextInput } from "../lib/essays/review-context.ts";
import { MAIN_REF } from "../lib/essays/prompts.ts";
import { sanitizeProfile } from "../lib/student-profile.ts";
import type { School } from "../lib/types.ts";

const WAKE = "199847";
const DUKE = "198419";

const SCHOOL = {
  unit_id: WAKE,
  name: "Wake Forest University",
  type: "private-nonprofit",
  location: { city: "Winston-Salem", state: "NC", zip: "27109", region: "Southeast" },
  demographics: { undergrad_enrollment: 5447 },
  campus: { setting: { locale: 12, label: "City: Midsize", group: "city" }, programs: { rotc: ["army"], study_abroad: true, undergrad_research: true, intellectual_disability_program: false } },
  selectivity: { tier: "highly_selective" },
  academics: { student_faculty_ratio: 10, majors_top: [{ cip: "52.0201", title: "Business Administration", share: 0.15 }] },
  admissions: { factors: { essay: "considered" }, year: 2024, applicants: 1, admitted: 1, enrolled: 1 },
  reported: { admission_profile: { factors: { essay: "important", character: "very_important", interest: "considered", gpa: "very_important", test_scores: "considered" } } },
  cost: { tuition_out_of_state: 67642 },
} as unknown as School;

/** Every forbidden value, planted in the record. */
const FORBIDDEN = {
  name: "Maya",
  surname: "Ortiz",
  gpa: "3.91",
  weighted: "4.47",
  sat: "1490",
  act: "33",
  rank: "top 5",
  course: "AP Physics C",
  courseMark: "A-",
  thirdActivity: "Chess club",
  award: "AMC 12 Honor Roll",
  income: "84000",
  dukeDraft: "Duke's chapel",
  tuition: "67642",
  homeState: "TX",
};

const PROFILE = sanitizeProfile({
  basics: { gradYear: 2027, stateOfResidence: "TX", highSchool: "Lamar High School", feeWaiverEligible: true },
  academics: {
    gpa: 3.91,
    weightedGpa: 4.47,
    classStanding: "top5",
    courses: [{ id: "c1", kind: "ap", key: null, name: "AP Physics C", subject: "science", year: 11, status: "taken", grades: { s1: "A-", s2: "A-", final: "A-" }, exam: 5 }],
    activities: [
      { name: "Robotics team", kind: "club", family: "engineering", years: [9, 10, 11, 12], roles: { "11": "officer", "12": "leader" }, recognition: 2 },
      { name: "Bike shop job", kind: "work", family: "business", years: [10, 11, 12], roles: {}, hoursPerWeek: 12 },
      { name: "Chess club", kind: "club", family: "math", years: [9], roles: {} },
    ],
    awards: [{ key: null, name: "AMC 12 Honor Roll", tier: 2, year: 11 }],
    connections: [{ id: "k1", unitId: WAKE, family: ["parent", "sibling"], recruited: "none" }],
    firstGeneration: false,
  },
  tests: { satTotal: 1490, actComposite: 33 },
  plans: { intendedMajors: ["14", "11"] },
  story: { narrative: "Maya Ortiz builds things that move. I started in a garage with my dad's drill and never stopped.", updatedAt: null },
});

const BASE: ContextInput = {
  essayId: "e-why",
  prompt: { title: "Why us", text: "Why Wake Forest? (150 words)", options: [], kind: "why_us", limit: { kind: "words", max: 150 }, required: true, college: { unit_id: WAKE, name: "Wake Forest University" }, quote: "Respond in 150 words or fewer." },
  school: SCHOOL,
  profile: PROFILE,
  studentName: "Maya Ortiz",
  drafts: [
    { id: "e-why", title: "Why Wake", prompt_ref: `college:${WAKE}:2026-27:1`, refs: [`college:${WAKE}:2026-27:1`], kind: "why_us", body: "The draft being read." },
    { id: "e-main", title: "Main essay", prompt_ref: MAIN_REF, refs: [MAIN_REF], kind: "personal", body: "My grandmother could not lift a spoon after her stroke, so Maya built a brace.\n\nSecond paragraph." },
    { id: "e-wake2", title: "Wake short answer", prompt_ref: `college:${WAKE}:2026-27:2`, refs: [`college:${WAKE}:2026-27:2`], kind: "short_answer", body: "Top ten list: robots, bikes, soup." },
    { id: "e-duke", title: "Why Duke", prompt_ref: `college:${DUKE}:2026-27:1`, refs: [`college:${DUKE}:2026-27:1`], kind: "why_us", body: "I loved Duke's chapel and its gardens." },
    { id: "e-linked", title: "Shared one", prompt_ref: `college:${DUKE}:2026-27:2`, refs: [`college:${DUKE}:2026-27:2`, `college:${WAKE}:2026-27:3`], kind: "essay", body: "A draft linked to both colleges." },
  ],
  interest: { visited: true, requestedInfo: false, followsSocial: true },
  priorNotes: [{ category: "mechanics", observation: "A word is misspelled.", state: "done" }],
};

/** Every string anywhere in a value. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]);
  return [];
}

test("the context holds what the spec's table lists", () => {
  const ctx = reviewContext(BASE);
  assert.equal(ctx.prompt.text, "Why Wake Forest? (150 words)");
  assert.equal(ctx.prompt.limit, "up to 150 words");
  assert.equal(ctx.prompt.college, "Wake Forest University");
  assert.equal(ctx.prompt.college_says, "Respond in 150 words or fewer.");
  assert.ok(ctx.story?.startsWith("[name] [name] builds things"), "the story, without the name");
  assert.deepEqual(ctx.depth?.went_deepest_in, ["Robotics team, four years, a leader", "Bike shop job, three years"]);
  assert.equal(ctx.depth?.recognition, "state-level recognition");
  assert.equal(ctx.writing.main_essay?.title, "Main essay");
  assert.equal(ctx.writing.main_essay?.opening, "My grandmother could not lift a spoon after her stroke, so [name] built a brace.");
  assert.deepEqual(ctx.writing.other_drafts_for_this_college.map((d) => d.title), ["Wake short answer", "Shared one"], "this college's drafts, a linked one included");
  assert.equal(ctx.college?.selectivity, "highly selective");
  assert.deepEqual(ctx.college?.factors, { "the essay": "important", "character and personal qualities": "very important", "the applicant's interest in the college": "considered" });
  assert.deepEqual(ctx.college?.facts, { where: "Winston-Salem, NC", type: "private nonprofit", undergraduates: "about 5,400", setting: "City: Midsize", top_majors: ["Business Administration"], programs: ["study abroad", "undergraduate research", "ROTC"] });
  assert.deepEqual(ctx.plan, { intended_majors: ["Engineering", "Computer science"], connections: ["A parent went here", "A sibling went here"], interest_shown: ["visited", "follows the college online"] });
  assert.deepEqual(ctx.prior_notes, [{ category: "mechanics", observation: "A word is misspelled.", state: "done" }]);
});

test("nothing forbidden reaches the reader: no name, grades, test results, extra activities, awards' names, finances, or other college's drafts", () => {
  const ctx = reviewContext(BASE);
  const all = strings(ctx).join("\n");
  for (const [what, v] of Object.entries(FORBIDDEN)) assert.ok(!all.includes(v), `${what} (${v}) leaked`);
  for (const key of ["gpa", "sat", "act", "tests", "grades", "income", "finances", "student_name", "display_name", "basics", "classStanding", "homeState", "courses", "awards", "firstGeneration"]) {
    assert.ok(!strings(Object.keys(ctx)).includes(key) && !all.split("\n").includes(key), `a "${key}" key leaked`);
  }
  const turn = userTurn(ctx, "The draft being read.");
  for (const [what, v] of Object.entries(FORBIDDEN)) assert.ok(!turn.includes(v), `${what} (${v}) leaked into the user turn`);
});

test("guard: the walk catches a leak (a context with the GPA added fails it)", () => {
  const ctx = reviewContext(BASE) as unknown as Record<string, unknown>;
  const leaky = { ...ctx, plan: { ...(ctx.plan as object), gpa: 3.91 } };
  assert.ok(strings(leaky).join("\n").includes(FORBIDDEN.gpa), "the forbidden-value assertion would fail");
});

test("facts only for a why-us or program prompt; a platform prompt has no college; the main essay gets no main-essay line", () => {
  const essay = reviewContext({ ...BASE, prompt: { ...BASE.prompt, kind: "essay" } });
  assert.equal(essay.college?.facts, null);
  assert.ok(essay.college?.factors);
  const main = reviewContext({ ...BASE, essayId: "e-main", prompt: { title: "The Common App personal essay", text: null, options: ["Prompt one", "Prompt two"], kind: "personal", limit: { kind: "words", max: 650, min: 250 }, required: true, college: null, quote: null }, school: null, interest: null });
  assert.equal(main.college, null);
  assert.equal(main.writing.main_essay, null);
  assert.deepEqual(main.writing.other_drafts_for_this_college, [], "no college, so no other college's drafts at all");
  assert.deepEqual(main.plan.connections, []);
  assert.deepEqual(main.plan.interest_shown, []);
  assert.equal(main.prompt.limit, "250 to 650 words");
  assert.deepEqual(main.prompt.choices, ["Prompt one", "Prompt two"]);
});

test("an empty record gives an empty context, never a crash", () => {
  const ctx = reviewContext({ ...BASE, profile: null, drafts: [], interest: null, priorNotes: [], studentName: null });
  assert.equal(ctx.story, null);
  assert.equal(ctx.depth, null);
  assert.deepEqual(ctx.plan.intended_majors, []);
});

test("helpers: the name comes out whole-word only; openings cut at a word; paragraphs numbered as the spans number them", () => {
  assert.equal(withoutName("Maya and Mayan ruins; MAYA.", "Maya Ortiz"), "[name] and Mayan ruins; [name].");
  assert.equal(withoutName("No name here.", null), "No name here.");
  const long = `${"word ".repeat(60)}end`;
  assert.ok(openingOf(long).length <= 201 && openingOf(long).endsWith("…"));
  assert.equal(draftForReader("One.\r\n\r\n  Two.\nThree."), "[¶0] One.\n\n[¶1] Two.\n\n[¶2] Three.");
});
