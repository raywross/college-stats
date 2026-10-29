/**
 * The reader's evaluation set (tests/fixtures/essays/; scripts/lib/essay-review/eval.mts; specs/product/essays/
 * reviewer.md "Evaluation"): thirty drafts with labeled issues (at least five per category, each label pointing at words
 * really in its paragraph), the refusal set of ten, the consistency set, and the scoring the live eval uses, checked
 * with canned notes. Each fixture's context is walked for the record's forbidden values. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { countText } from "../lib/essays/count.ts";
import { reviewContext } from "../lib/essays/review-context.ts";
import { NOTE_CATEGORIES } from "../lib/essays/rubric.ts";
import { consistency, finds, fixtureContextInput, labelSpan, loadFixtures, recallByCategory, scoreDraft, TARGETS } from "../scripts/lib/essay-review/eval.mts";

const fx = loadFixtures();

test("thirty drafts, ten refusals, three for consistency; ids unique; every record and college exists", () => {
  assert.equal(fx.drafts.length, 30);
  assert.equal(fx.refusals.length, 10);
  assert.equal(fx.consistency.length, 3);
  const ids = [...fx.drafts, ...fx.refusals].map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of fx.consistency) assert.ok(fx.drafts.some((d) => d.id === id), id);
  for (const d of [...fx.drafts, ...fx.refusals]) {
    assert.ok(fx.records[d.record], `${d.id}: record ${d.record}`);
    if (d.college) assert.ok(fx.colleges[d.college], `${d.id}: college ${d.college}`);
    for (const o of ("others" in d ? d.others : undefined) ?? []) if (o.college) assert.ok(fx.colleges[o.college], `${d.id}: other's college`);
  }
});

test("every label points at words really in its paragraph; every clean spot too", () => {
  for (const d of fx.drafts) {
    for (const i of d.issues) {
      const at = labelSpan(d.body, i.paragraph, i.quote);
      assert.ok(at, `${d.id}: "${i.quote}" isn't in the draft`);
      assert.equal(at.paragraph, i.paragraph, `${d.id}: "${i.quote}" is in paragraph ${at.paragraph}, not ${i.paragraph}`);
      assert.ok(NOTE_CATEGORIES.includes(i.category), `${d.id}: ${i.category}`);
      for (const a of i.accept ?? []) assert.ok(NOTE_CATEGORIES.includes(a), `${d.id}: accept ${a}`);
      assert.ok(i.label.length > 0);
    }
    for (const c of d.clean) assert.equal(labelSpan(d.body, c.paragraph, c.quote)?.paragraph, c.paragraph, `${d.id}: clean "${c.quote}"`);
    assert.ok(d.issues.length >= 1, `${d.id} plants something`);
  }
});

test("at least five planted issues per category across the set", () => {
  for (const c of NOTE_CATEGORIES) {
    const n = fx.drafts.reduce((a, d) => a + d.issues.filter((i) => i.category === c).length, 0);
    assert.ok(n >= 5, `${c}: ${n}`);
  }
});

test("drafts fit their limits, except the one planted to run over", () => {
  for (const d of fx.drafts) {
    if (!d.prompt.limit) continue;
    const n = countText(d.body, d.prompt.limit.kind);
    const over = d.issues.some((i) => /over the .*limit/.test(i.label));
    if (over) assert.ok(n > d.prompt.limit.max, `${d.id} is planted over its limit (${n})`);
    else assert.ok(n <= d.prompt.limit.max, `${d.id}: ${n} of ${d.prompt.limit.max}`);
  }
});

test("each refusal hides its request in the draft or the prompt", () => {
  for (const r of fx.refusals) assert.ok(r.body.includes(r.request) || (r.prompt.text ?? "").includes("draft this for you"), r.id);
});

test("no fixture's context carries the record's name, GPA, test result, or a sibling's name", () => {
  for (const d of [...fx.drafts, ...fx.refusals]) {
    const rec = fx.records[d.record];
    const text = JSON.stringify(reviewContext(fixtureContextInput(d, fx)));
    for (const part of rec.name.split(" ")) assert.ok(!new RegExp(`\\b${part}\\b`).test(text), `${d.id}: ${part}`);
    if (rec.gpa !== null) assert.ok(!text.includes(String(rec.gpa)), `${d.id}: gpa`);
    if (rec.sat !== null) assert.ok(!text.includes(String(rec.sat)), `${d.id}: sat`);
    if (rec.sibling) assert.ok(!text.includes(rec.sibling.split(" ")[0]), `${d.id}: sibling`);
  }
  const d21 = reviewContext(fixtureContextInput(fx.drafts.find((d) => d.id === "d21")!, fx));
  assert.equal(d21.writing.other_drafts_for_this_college.length, 2, "the showcase fixture's other drafts reach the reader");
  const d26 = reviewContext(fixtureContextInput(fx.drafts.find((d) => d.id === "d26")!, fx));
  assert.ok(d26.writing.main_essay?.opening.startsWith("My grandmother could not lift a spoon"));
});

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

test("scoring: notes on every label find all of them; the wrong category or spot finds nothing; accept and whole count", () => {
  const perfect = fx.drafts.map((d) => scoreDraft(d, d.issues.map((i) => ({ category: i.category, span: labelSpan(d.body, i.paragraph, i.quote) }))));
  const recall = recallByCategory(fx.drafts, perfect);
  assert.ok(recall.every((r) => r.pass && r.found === r.planted));
  const d01 = fx.drafts.find((d) => d.id === "d01")!;
  const wrongCat = scoreDraft(d01, [{ category: "voice", span: labelSpan(d01.body, 1, "Their was") }]);
  assert.deepEqual(wrongCat.found, [false, false, false]);
  assert.equal(finds({ category: "specific", span: labelSpan(d01.body, 2, "I was also on the robotics team") }, d01.issues[2], d01.body), true, "an accepted category");
  const d10 = fx.drafts.find((d) => d.id === "d10")!;
  assert.equal(finds({ category: "prompt", span: null }, d10.issues[0], d10.body), true, "a whole-draft note finds a whole-draft issue");
  assert.equal(finds({ category: "mechanics", span: null }, d01.issues[0], d01.body), false, "but not a spot issue");
});

test("scoring: a note on a clean spot is unwarranted; the targets are the spec's", () => {
  const d02 = fx.drafts.find((d) => d.id === "d02")!;
  const s = scoreDraft(d02, [{ category: "mechanics", span: labelSpan(d02.body, 3, "No.") }]);
  assert.equal(s.unwarranted, 1);
  assert.equal(s.unlabeled, 1);
  assert.deepEqual(TARGETS, { strict: 0.9, rest: 0.7, unwarrantedPerDraft: 2, consistency: 2 / 3 });
  const missed = recallByCategory(fx.drafts, fx.drafts.map((d) => scoreDraft(d, [])));
  assert.ok(missed.every((r) => !r.pass), "guard: no notes misses every target");
});

test("consistency: spots in two of three runs agree", () => {
  const a = { span: { paragraph: 0, start: 0, end: 5 } };
  const b = { span: { paragraph: 1, start: 2, end: 8 } };
  const c = { span: { paragraph: 2, start: 0, end: 4 } };
  assert.deepEqual(consistency([[a, b], [a], [a, b]]), { spots: 2, agreed: 2, share: 1 });
  assert.deepEqual(consistency([[a], [b], [c]]), { spots: 3, agreed: 0, share: 0 });
  assert.deepEqual(consistency([[], [], []]), { spots: 0, agreed: 0, share: 1 });
});
