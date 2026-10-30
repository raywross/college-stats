/**
 * What is left to write (lib/essays/progress.ts; specs/product/essays/moves.md "What counts as work left"): the
 * worked example pinned row by row (with the move's title, why, date, and importance), then each rule on its own:
 * a choose set, a college with no supplement, one that refers to the form, one not on file, a withdrawn college, a
 * draft linked to two prompts, `submitted` counting as ready, own prompts for a college, and a list with no Common
 * App college (`main` is null). Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allReady, essayProgress, firstNotOnFile, nextOwnRef, ownRef, progressLine, type EssayProgress } from "../lib/essays/progress.ts";
import { parsePromptRef, resolvePrompt } from "../lib/essays/prompts.ts";
import { groupEssays } from "../lib/essays/rows.ts";
import { essaysButton, essaysMove } from "../lib/planner/generators/essays.ts";
import { importance, type ImportanceFacts } from "../lib/planner/importance.ts";
import { cycleFor, loadCycle } from "../lib/planner/cycle.ts";
import { seasonOf, type Season } from "../lib/planner/seasons.ts";
import type { PlanTask } from "../lib/planner/types.ts";
import {
  CYCLE,
  DUKE,
  DUKE_CHOOSE,
  ELON,
  GRAD,
  GT,
  MAIN,
  MICH,
  YALE,
  draft,
  essays,
  item,
  link,
  prompt,
  published,
  ref,
  school,
  workedDrafts,
  workedItems,
  workedSchools,
} from "./helpers/essays-plan.mts";

const progressOn = (on: Parameters<typeof workedDrafts>[0]) => essayProgress({ items: workedItems(), schools: workedSchools(), essays: workedDrafts(on) });

/** The move's importance on a day, as Now ranks it (base + timing; never carried: the stamp is the current season). */
function rank(p: EssayProgress, today: string): { season: Season; score: number; move: ReturnType<typeof essaysMove> } {
  const season = seasonOf(GRAD, today);
  const move = essaysMove(p, season);
  const facts: ImportanceFacts = { season, today, gradYear: GRAD, profile: null, cycle: loadCycle(cycleFor(GRAD)), listDeadlines: [] };
  const task = { kind: "essays", key: "l:essays:next", season, due_on: move.due_on, window_start: null, window_end: null, source: "season" } as Pick<PlanTask, "kind" | "key" | "season" | "due_on" | "window_start" | "window_end" | "source">;
  return { season, score: importance(task, facts), move };
}

/* ------------------------------------------------------------------ */
/* The worked example (moves.md), row by row                           */
/* ------------------------------------------------------------------ */

test("worked example, Jul 10: nothing started → Write your essays, undated, 72", () => {
  const p = progressOn("jul10");
  assert.equal(p.total, 8, "main + GT 2 + Duke 3 (2 + choose 1) + Michigan 2; Yale and Elon add none");
  assert.equal(p.remaining, 8);
  assert.deepEqual(p.main, { state: "not_started", essayId: null, count: 0, limit: 650 });
  const r = rank(p, "2026-07-10");
  assert.equal(r.season, "summer_before_senior");
  assert.equal(r.move.title, "Write your essays");
  assert.match(r.move.why, /^The personal essay is the summer's work: 650 words/);
  assert.equal(r.move.due_on, null);
  assert.equal(r.score, 72);
  assert.equal(essaysButton(p), "Write it");
});

test("worked example, Jul 28: the personal essay in progress → Finish your personal essay, 72", () => {
  const r = rank(progressOn("jul28"), "2026-07-28");
  assert.equal(r.move.title, "Finish your personal essay");
  assert.equal(r.move.why, "410 of 650 words, draft. Start from your story.");
  assert.equal(r.move.due_on, null);
  assert.equal(r.score, 72);
});

test("worked example, Aug 20: main ready → Finish Georgia Tech's essays (Oct 15), 85 + 0", () => {
  const p = progressOn("aug20");
  assert.equal(p.next?.unit_id, GT);
  assert.deepEqual(p.colleges.map((c) => c.name), ["Georgia Tech", "Duke", "Michigan", "Yale", "Elon"], "deadline order, Duke before Michigan on the same day by the list's order, Elon undated last");
  const r = rank(p, "2026-08-20");
  assert.equal(r.season, "senior_fall");
  assert.equal(r.move.title, "Finish Georgia Tech's essays");
  assert.equal(r.move.why, "2 of 2 to go for the EA deadline (Oct 15). Then Duke, Nov 1. 7 essays left across 3 colleges.");
  assert.equal(r.move.due_on, "2026-10-15");
  assert.equal(r.move.college, GT);
  assert.equal(r.score, 85);
});

test("worked example, Oct 3: Georgia Tech and two of Duke's ready → Finish Duke's essays, 85 + 5 = 90", () => {
  const p = progressOn("oct3");
  const duke = p.colleges.find((c) => c.unit_id === DUKE)!;
  assert.equal(duke.ready, 2);
  assert.equal(duke.total, 3);
  const r = rank(p, "2026-10-03");
  assert.equal(r.move.title, "Finish Duke's essays");
  assert.equal(r.move.why, "1 of 3 to go for the ED I deadline (Nov 1). Then Michigan, Nov 1. 3 essays left across 2 colleges.");
  assert.equal(r.score, 90);
});

test("worked example, Oct 25: Duke ready, Michigan 1 of 2 → Finish Michigan's essays (7 days out: +20, clamped at 100)", () => {
  const p = progressOn("oct25");
  assert.equal(p.remaining, 1);
  const r = rank(p, "2026-10-25");
  assert.equal(r.move.title, "Finish Michigan's essays");
  assert.equal(r.move.why, "1 of 2 to go for the EA deadline (Nov 1). 1 left.");
  // moves.md's table says 85 + 10 = 95; Nov 1 is 7 days after Oct 25, which ranking.md's rule boosts by 20.
  assert.equal(r.score, 100);
});

test("worked example, Nov 3: every known essay ready, Yale not on file → Check what Yale asks you to write (Jan 2), 85; not ticked", () => {
  const p = progressOn("nov3");
  assert.equal(p.remaining, 0);
  assert.equal(p.notOnFile, 1);
  assert.equal(allReady(p), false, "the store doesn't tick while a college's prompts are unknown");
  assert.equal(firstNotOnFile(p)?.unit_id, YALE);
  const r = rank(p, "2026-11-03");
  assert.equal(r.move.title, "Check what Yale asks you to write");
  assert.equal(r.move.why, "We haven't read Yale's essay page yet. Add what it asks for and write it here.");
  assert.equal(r.move.due_on, "2027-01-02");
  assert.equal(r.score, 85);
  assert.equal(essaysButton(p), "Write it");
});

test("worked example, Nov 20: Yale's two own drafts ready → Your essays are ready; all ready (the store ticks)", () => {
  const p = progressOn("nov20");
  const yale = p.colleges.find((c) => c.unit_id === YALE)!;
  assert.equal(yale.onFile, "refers_to_form");
  assert.equal(yale.own.length, 2);
  // moves.md says "All 9"; the example's own counts give 10 (main 1 + GT 2 + Duke 3 + Michigan 2 + Yale's 2).
  assert.equal(p.total, 10);
  assert.equal(p.remaining, 0);
  assert.equal(p.notOnFile, 0);
  assert.equal(allReady(p), true);
  const r = rank(p, "2026-11-20");
  assert.equal(r.move.title, "Your essays are ready");
  assert.equal(r.move.why, "All 10 ready. Paste each college's package into its form when you apply.");
  assert.equal(r.move.due_on, null);
  assert.equal(essaysButton(p), "See them");
  assert.equal(progressLine(p), "All 10 ready. Paste each college's package into its form when you apply.");
});

test("progressLine: the header in words (tab.md): counts and the next college; the summer's line with nothing on file", () => {
  assert.equal(progressLine(progressOn("oct3")), "5 of 8 ready · next: Duke, Nov 1");
  assert.equal(progressLine(progressOn("nov3")), "8 of 8 ready · next: Yale, Jan 2");
  const summer = essayProgress({ items: [item(ELON, 0, "rolling")], schools: { [ELON]: workedSchools()[ELON] }, essays: null });
  assert.equal(progressLine(summer), "Your colleges' prompts arrive by August; the personal essay is the summer's work.");
});

/* ------------------------------------------------------------------ */
/* The rules, one by one                                               */
/* ------------------------------------------------------------------ */

test("a choose set counts n slots, filled by any n ready drafts among its prompts; the members carry chooseGroup", () => {
  const schools = { [DUKE]: workedSchools()[DUKE] };
  const two = essayProgress({ items: [item(DUKE, 0, "ed")], schools, essays: essays([draft(DUKE_CHOOSE[0], "ready"), draft(DUKE_CHOOSE[4], "ready")]) });
  const duke = two.colleges[0];
  assert.equal(duke.total, 3, "2 required + 1 slot");
  assert.equal(duke.ready, 1, "two ready choose drafts fill the one slot, never more");
  assert.equal(duke.required.length, 7, "the five choose members sit in required, flagged");
  assert.equal(duke.required.filter((p) => p.chooseGroup).length, 5);
  assert.deepEqual(duke.required.find((p) => p.chooseGroup)!.chooseGroup, { n: 1, of: 5 });
  assert.equal(duke.optional.length, 0);
  // Broken rule: if each choose member counted on its own, Duke would ask for 7.
  assert.notEqual(duke.total, duke.required.length);
});

test("status none adds nothing beyond the platform's; refers_to_form and no page at all are unknown and flagged", () => {
  const schools = {
    [ELON]: workedSchools()[ELON],
    [YALE]: workedSchools()[YALE],
    "999999": school("999999", "Nowhere", null, { regular: "2027-01-15" }),
  };
  const p = essayProgress({ items: [item(ELON, 0, "rolling"), item(YALE, 1, "rd"), item("999999", 2, "rd")], schools, essays: null });
  const by = Object.fromEntries(p.colleges.map((c) => [c.unit_id, c]));
  assert.equal(by[ELON].onFile, "none");
  assert.equal(by[ELON].total, 0);
  assert.equal(by[YALE].onFile, "refers_to_form");
  assert.equal(by["999999"].onFile, "not_on_file");
  assert.equal(by[YALE].total + by["999999"].total, 0, "unknown: zero required");
  assert.equal(p.notOnFile, 2, "Elon (none) is known; Yale and the unread college are not");
  assert.equal(p.total, 1, "the personal essay alone");
});

test("a withdrawn college and a decided one the student isn't enrolling at are out; an enrolling one stays", () => {
  const schools = workedSchools();
  const items = [item(DUKE, 0, "ed", { withdrawn_on: "2026-10-01" }), item(MICH, 1, "ea", { outcome: "denied", status: "decided" }), item(GT, 2, "ea", { outcome: "admitted", status: "decided", enrolling: true })];
  const p = essayProgress({ items, schools, essays: null });
  assert.deepEqual(p.colleges.map((c) => c.unit_id), [GT]);
});

test("a draft linked to two prompts serves both; a draft written for a prompt decides before one linked to it", () => {
  const schools = { [MICH]: school(MICH, "Michigan", published([prompt(MICH, 1, "why_us"), prompt(MICH, 2, "essay")]), { ea: "2026-11-01" }) };
  const shared = draft(ref(MICH, 1), "ready");
  const p = essayProgress({ items: [item(MICH, 0, "ea")], schools, essays: essays([shared], [link(shared, ref(MICH, 2))]) });
  assert.equal(p.colleges[0].ready, 2);
  assert.equal(p.colleges[0].required[1].essayId, shared.id);
  // A draft of its own for prompt 2 (still a draft) wins over the linked one: the first serving draft decides.
  const own = draft(ref(MICH, 2), "draft");
  const q = essayProgress({ items: [item(MICH, 0, "ea")], schools, essays: essays([shared, own], [link(shared, ref(MICH, 2))]) });
  assert.equal(q.colleges[0].required[1].state, "draft");
  assert.equal(q.colleges[0].required[1].essayId, own.id);
});

test("submitted counts as ready; a linked main essay counts as the personal essay", () => {
  const schools = { [GT]: workedSchools()[GT] };
  const main = draft(ref(GT, 1), "submitted");
  const p = essayProgress({ items: [item(GT, 0, "ea")], schools, essays: essays([main, draft(ref(GT, 2), "submitted")], [link(main, MAIN)]) });
  assert.equal(p.colleges[0].ready, 2);
  assert.equal(p.main?.state, "ready");
  assert.equal(p.remaining, 0);
});

test("no Common App college: main is null and the personal essay never counts", () => {
  const schools = { [MICH]: school(MICH, "Michigan", published([prompt(MICH, 1, "why_us")]), { regular: "2027-02-01" }, false) };
  const p = essayProgress({ items: [item(MICH, 0, "rd")], schools, essays: essays([draft(MAIN, "draft")]) });
  assert.equal(p.main, null);
  assert.equal(p.total, 1);
  assert.equal(p.colleges[0].takesCommonApp, false);
  // The platform on the item decides first: a member applied to on its own form doesn't take the main essay.
  const own = essayProgress({ items: [item(GT, 0, "ea", { application_platform: "own" })], schools: { [GT]: workedSchools()[GT] }, essays: null });
  assert.equal(own.main, null);
});

test("an unfinished personal essay makes every Common App college work left: the earliest is named, 'including your personal essay'", () => {
  const p = essayProgress({ items: workedItems(), schools: workedSchools(), essays: essays([draft(MAIN, "draft", 300, "personal"), draft(ref(GT, 1), "ready"), draft(ref(GT, 2), "ready")]) });
  assert.equal(p.next?.unit_id, GT, "Georgia Tech's own essays are done, but the main essay counts there");
  const move = essaysMove(p, "senior_fall");
  assert.equal(move.title, "Finish Georgia Tech's essays");
  assert.match(move.why, /^Your personal essay is left for the EA deadline \(Oct 15\): 300 of 650 words\./);
});

test("program and transfer prompts are not required; an international one is optional", () => {
  const schools = { [MICH]: school(MICH, "Michigan", published([prompt(MICH, 1, "program", true, { program: "Engineering" }), prompt(MICH, 2, "essay", true, "transfer"), prompt(MICH, 3, "essay", true, "international"), prompt(MICH, 4, "why_us")]), { ea: "2026-11-01" }) };
  const c = essayProgress({ items: [item(MICH, 0, "ea")], schools, essays: null }).colleges[0];
  assert.equal(c.total, 1);
  assert.deepEqual(c.required.map((p) => p.ref), [ref(MICH, 4)]);
  assert.deepEqual(c.optional.map((p) => p.ref), [ref(MICH, 1), ref(MICH, 3)], "transfer left out");
});

/* ------------------------------------------------------------------ */
/* Own refs: a college's prompts the student adds                      */
/* ------------------------------------------------------------------ */

test("own refs: college:<unit>:<cycle>:own-<n>, parsed as the college's, resolved without a throw, numbered past the last", () => {
  const r = ownRef(YALE, CYCLE, 1);
  assert.equal(r, `college:${YALE}:${CYCLE}:own-1`);
  assert.deepEqual(parsePromptRef(r), { kind: "college", unitId: YALE, cycle: CYCLE, n: 1, promptId: `${YALE}:${CYCLE}:own-1`, own: true });
  for (const bad of [`college:${YALE}:${CYCLE}:own-0`, `college:${YALE}:${CYCLE}:own-`, `college:${YALE}:${CYCLE}:own-x`]) assert.equal(parsePromptRef(bad), null, bad);
  const resolved = resolvePrompt(r, { school: (id) => (id === YALE ? { unit_id: YALE, name: "Yale" } : null), platform: null });
  assert.equal(resolved.found, true);
  assert.equal(resolved.kind, "free");
  assert.deepEqual(resolved.college, { unit_id: YALE, name: "Yale" });
  const one = draft(r, "draft");
  const linked = draft("free", "ready");
  const plan = essays([one, linked], [link(linked, ownRef(YALE, CYCLE, 4))]);
  assert.equal(nextOwnRef(YALE, CYCLE, plan), ownRef(YALE, CYCLE, 5));
  assert.equal(nextOwnRef(DUKE, CYCLE, plan), ownRef(DUKE, CYCLE, 1));
  // The list groups an own draft under its college, not "Not for a college yet".
  const groups = groupEssays([one], [], [{ unit_id: YALE, name: "Yale" }], () => null);
  assert.deepEqual(groups.map((g) => g.key), [YALE]);
});

test("own drafts count at their college by their own status (a free draft linked to an own ref too); a plain free draft counts nowhere", () => {
  const schools = { [YALE]: workedSchools()[YALE] };
  const linked = draft("free", "ready");
  const p = essayProgress({
    items: [item(YALE, 0, "rd")],
    schools,
    essays: essays([draft(ownRef(YALE, CYCLE, 1), "draft"), linked, draft("free", "draft")], [link(linked, ownRef(YALE, CYCLE, 2))]),
  });
  const yale = p.colleges[0];
  assert.equal(yale.own.length, 2);
  assert.equal(yale.total, 2);
  assert.equal(yale.ready, 1);
  assert.equal(p.notOnFile, 0, "Yale has what the student added: no longer waiting");
  assert.equal(p.next?.unit_id, YALE);
});

test("no essay text: the reading carries titles by kind and counts, never a prompt's or a draft's words", () => {
  const p = progressOn("oct25");
  const json = JSON.stringify(p);
  assert.doesNotMatch(json, /A prompt\./, "the prompt text in the fixture never reaches the reading");
  assert.doesNotMatch(json, /"body"/);
});
