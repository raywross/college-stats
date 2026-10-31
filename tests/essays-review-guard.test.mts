/**
 * The guard (lib/essays/review-guard.ts; specs/product/essays/reviewer.md "The guard"): every rule has a planted
 * violation here that the guard drops, beside a note that passes so the drop is the rule's doing and nothing else's.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkNote,
  givesInstruction,
  guardNotes,
  hasGradeWord,
  hasPrediction,
  orderNotes,
  resolveSpan,
  sentenceCount,
  wordsOf,
  type DropReason,
  type RawNote,
} from "../lib/essays/review-guard.ts";
import { spanOffsets } from "../lib/essays/notes-view.ts";
import { paragraphsOf } from "../lib/essays/normalize.ts";

const DRAFT = [
  "The summer I turned fifteen I worked at my uncle's bike shop on Delmar Avenue, truing wheels and sweeping up spokes.",
  "Their was a customer named Mr. Okafor who came in every Saturday with the same flat tire and the same story about his daughter.",
  "I learned leadership and responsibility and the value of hard work.",
  "Now I want to study mechanical engineering, because I like knowing how things fit together.",
].join("\n\n");
const PROMPT = "Describe a weakness and how you have worked on it.";

const ok = (over: Partial<RawNote> = {}): RawNote => ({
  category: "specific",
  paragraph: 2,
  quote: "I learned leadership and responsibility",
  observation: "This sentence names three lessons without a moment behind any of them.",
  why: "Admissions readers remember a scene more than a list of virtues.",
  source: "https://writingcenter.unc.edu/tips-and-tools/application-essays/",
  ask: "What happened in the shop on the day you learned one of them?",
  fix: null,
  ...over,
});

function reason(note: RawNote, opts: { promptText?: string } = {}): DropReason | "kept" {
  const r = guardNotes([note], DRAFT, { promptText: opts.promptText ?? PROMPT });
  return r.kept.length ? "kept" : r.dropped[0].reason;
}

test("a note that follows every rule is kept, with its span found in the draft", () => {
  const r = guardNotes([ok()], DRAFT, { promptText: PROMPT });
  assert.equal(r.dropped.length, 0);
  assert.equal(r.kept.length, 1);
  const n = r.kept[0];
  assert.deepEqual(n.span, { paragraph: 2, start: 0, end: "I learned leadership and responsibility".length });
  assert.equal(n.fix, null);
  assert.equal(n.source, "https://writingcenter.unc.edu/tips-and-tools/application-essays/");
});

/* ------------------------------------------------------------------ */
/* 1. The fix                                                          */
/* ------------------------------------------------------------------ */

test("rule 1: a mechanics note may carry a short fix; a longer fix, or a fix on any other note, is dropped", () => {
  const mech = ok({ category: "mechanics", paragraph: 1, quote: "Their was", observation: "'Their' here should be 'There'.", why: "A wrong word that is still a word slips past spell check and distracts a reader.", ask: "Did you mean 'There was'?", fix: "There was" });
  assert.equal(reason(mech), "kept");
  assert.equal(reason({ ...mech, fix: "There was once a customer who came in every week" }), "fix", "nine words");
  assert.equal(reason(ok({ fix: "On a Saturday in July" })), "fix", "a fix on a specific note");
  assert.equal(reason(ok({ category: "voice", fix: "x" })), "fix");
  assert.equal(reason(ok({ fix: "" })), "kept", "an empty fix is no fix");
});

/* ------------------------------------------------------------------ */
/* 2. No run of more than eight of the draft's words                   */
/* ------------------------------------------------------------------ */

test("rule 2: a field repeating nine of the draft's words in a row is dropped; eight is allowed; the span may hold them", () => {
  const nine = "who came in every Saturday with the same flat tire";
  assert.equal(wordsOf(nine).length, 10);
  assert.equal(reason(ok({ observation: `You write that Mr. Okafor ${nine}; that's a vivid start to a paragraph.` })), "quote_run");
  const eight = "came in every Saturday with the same flat";
  assert.equal(wordsOf(eight).length, 8);
  assert.equal(reason(ok({ observation: `He ${eight} bike, it seems, which is the most specific thing here.` })), "kept", "eight in a row, then a word the draft doesn't have there");
  assert.equal(reason(ok({ ask: `What did he say about his daughter when he ${"came in every Saturday with the same flat tire"}?` })), "quote_run", "in the ask too");
  assert.equal(reason(ok({ paragraph: 1, quote: "Their was a customer named Mr. Okafor who came in every Saturday with the same flat tire" })), "kept", "the span may quote any length");
  assert.equal(reason(ok({ why: "Curly quotes don’t hide it: who came in every Saturday with the same flat tire." })), "quote_run");
});

/* ------------------------------------------------------------------ */
/* 3. Grade words and predictions                                      */
/* ------------------------------------------------------------------ */

test("rule 3: grade words are dropped", () => {
  for (const bad of [
    "This is a strong opening.",
    "The ending is weak.",
    "This paragraph is excellent.",
    "I'd grade this draft a B+.",
    "Overall it's a good essay.",
    "I'd rate it 7/10.",
    "This topic is overdone.",
    "Grandparent stories are a cliché.",
    "This is your best writing.",
  ]) {
    assert.equal(reason(ok({ observation: bad })), "grade_word", bad);
  }
});

test("rule 3: school years, the prompt's own words, and the draft's quoted words are not grades", () => {
  assert.equal(hasGradeWord("The story starts in ninth grade and again in 10th grade."), false);
  assert.equal(hasGradeWord("By grade 11 you were running the shop."), false);
  assert.equal(reason(ok({ observation: "The prompt asks about a weakness; the draft never names one." })), "kept", "'weakness' is the prompt's word");
  assert.equal(reason(ok({ observation: "The prompt asks about a weakness; the draft never names one." }), { promptText: "Tell us about yourself." }), "grade_word", "without the prompt's word it grades");
  const draftWithStrong = `${DRAFT}\n\nI am strong.`;
  const r = guardNotes([ok({ observation: "You call yourself 'strong' in the last line; what showed you that?" })], draftWithStrong, { promptText: PROMPT });
  assert.equal(r.kept.length, 1, "quoting the student's own word back is not grading");
});

test("rule 3: predictions about admission are dropped; other senses of the words pass", () => {
  for (const bad of [
    "This raises your chances.",
    "Your odds improve with a clearer ending.",
    "About 80% of readers stop here.",
    "This could get you accepted.",
    "They would admit you on this alone.",
    "This is what gets you in.",
    "This helps you get in at selective colleges.",
    "Colleges will love this detail.",
    "This might hurt your application.",
    "Their acceptance rate makes interest matter.",
  ]) {
    assert.equal(hasPrediction(bad), true, bad);
    assert.equal(reason(ok({ why: bad })), "prediction", bad);
  }
  for (const fine of ["You admit you were scared; what did you do next?", "Accepting help from Mr. Okafor seems to matter here.", "Get into the scene sooner.", "A reader wants to know what happened."]) {
    assert.equal(hasPrediction(fine), false, fine);
  }
});

/* ------------------------------------------------------------------ */
/* 4. One or two sentences                                             */
/* ------------------------------------------------------------------ */

test("rule 4: observation, why, and ask are each one or two sentences", () => {
  assert.equal(sentenceCount("One. Two."), 2);
  assert.equal(sentenceCount("Mr. Okafor came in, e.g. on Saturdays. Then what?"), 2, "abbreviations don't end a sentence");
  assert.equal(sentenceCount("You wrote 'It broke. I fixed it.' and moved on."), 1, "a quoted passage's periods are its own");
  assert.equal(reason(ok({ observation: "One thing. Another thing. A third thing." })), "sentences");
  assert.equal(reason(ok({ why: "First. Second. Third." })), "sentences");
  assert.equal(reason(ok({ ask: "Which day? Which customer? What changed?" })), "sentences");
  assert.equal(reason(ok({ ask: "   " })), "shape", "an empty field");
});

/* ------------------------------------------------------------------ */
/* 5. Care                                                             */
/* ------------------------------------------------------------------ */

test("rule 5: a care note asks a question and never instructs", () => {
  const care = ok({ category: "care", paragraph: 1, quote: "his daughter", observation: "You mention Mr. Okafor's daughter, who isn't part of your story.", why: "A detail about someone else is theirs to share.", ask: "Is that detail yours to share, and does the essay need it?" });
  assert.equal(reason(care), "kept");
  assert.equal(reason({ ...care, ask: "Think about whether that detail is yours to share." }), "care_question", "no question");
  assert.equal(reason({ ...care, ask: "Remove his daughter from the essay. Is it needed?" }), "care_instruction");
  assert.equal(reason({ ...care, why: "You should leave out details about other people." }), "care_instruction");
  assert.equal(reason({ ...care, observation: "Don't name other people's families." }), "care_instruction");
  assert.equal(givesInstruction("Is that yours to share?"), false);
  assert.equal(givesInstruction("Share it?"), false, "a question that opens on a verb is still a question");
  assert.equal(givesInstruction("Make sure he is comfortable with this."), true);
});

/* ------------------------------------------------------------------ */
/* 6. No wording offered (beyond the spec's list)                      */
/* ------------------------------------------------------------------ */

test("rule 6: offered wording is dropped, quoting the draft or the prompt is not", () => {
  for (const bad of [
    "Try writing 'The shop smelled of rubber and oil' as your first line.",
    "You could open with the flat tire instead.",
    "Something like 'I learned to listen' would be clearer.",
    "Here's a version that works better.",
    "A tighter opening would start in the shop.",
    "Rewrite this as a scene.",
    "Try: 'I swept up spokes.'",
  ]) {
    assert.equal(reason(ok({ ask: bad.endsWith("?") ? bad : bad.replace(/\.$/, "?") })), "prose", bad);
  }
  assert.equal(reason(ok({ observation: "A phrase like 'the value of hard work' could close almost any essay." })), "kept", "the draft's own four words");
  assert.equal(reason(ok({ observation: "The prompt says 'how you have worked on it'; this paragraph doesn't get there." })), "kept", "the prompt's own words");
  assert.equal(reason(ok({ observation: "A line such as 'every Saturday I learned patience' would fit here." })), "prose", "a quoted passage of four new words");
});

/* ------------------------------------------------------------------ */
/* 7. Shape and spans; 8. at most eight                                */
/* ------------------------------------------------------------------ */

test("rule 7: an unknown category, a missing field, or a quote that isn't in the draft is dropped", () => {
  assert.equal(reason(ok({ category: "grade" })), "category");
  assert.equal(reason({ ...ok(), observation: undefined } as unknown as RawNote), "shape");
  assert.equal(reason(ok({ quote: "words the student never wrote" })), "span");
  assert.equal(reason(ok({ paragraph: 9, quote: null })), "span", "a paragraph that doesn't exist");
  assert.equal(guardNotes(null, DRAFT).kept.length, 0, "not an array: nothing, no throw");
  assert.equal(guardNotes(["a string", 3, null], DRAFT).dropped.every((d) => d.reason === "shape"), true);
});

test("spans: the quote found in its paragraph, another paragraph when the number is off, a whole paragraph, the whole draft", () => {
  const paras = paragraphsOf(DRAFT);
  assert.deepEqual(resolveSpan(paras, 1, "Their was"), { ok: true, span: { paragraph: 1, start: 0, end: 9 } });
  assert.deepEqual(resolveSpan(paras, 0, "Their was"), { ok: true, span: { paragraph: 1, start: 0, end: 9 } }, "found in the next paragraph");
  assert.deepEqual(resolveSpan(paras, 3, null), { ok: true, span: { paragraph: 3, start: 0, end: paras[3].length } });
  assert.deepEqual(resolveSpan(paras, null, null), { ok: true, span: null });
  assert.deepEqual(resolveSpan(paras, 0, "uncle’s bike shop"), { ok: true, span: { paragraph: 0, start: paras[0].indexOf("uncle's"), end: paras[0].indexOf("uncle's") + "uncle's bike shop".length } }, "curly and straight apostrophes match");
  assert.deepEqual(resolveSpan(paras, 2, "i LEARNED   leadership"), { ok: true, span: { paragraph: 2, start: 0, end: "I learned leadership".length } }, "case and spacing");
});

test("rule 8: at most eight notes (MAX_NOTES); the rest are dropped as over the limit", () => {
  const r = guardNotes(Array.from({ length: 10 }, () => ok()), DRAFT, { promptText: PROMPT });
  assert.equal(r.kept.length, 8);
  assert.deepEqual(r.dropped.map((d) => d.reason), ["over_limit", "over_limit"]);
});

test("a source outside the guidance sent is cleared, not dropped", () => {
  const r = guardNotes([ok({ source: "https://example.com/coaching" })], DRAFT, { promptText: PROMPT, allowedSources: new Set(["https://writingcenter.unc.edu/tips-and-tools/application-essays/"]) });
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].source, null);
  const ok2 = guardNotes([ok()], DRAFT, { promptText: PROMPT, allowedSources: new Set(["https://writingcenter.unc.edu/tips-and-tools/application-essays/"]) });
  assert.equal(ok2.kept[0].source, "https://writingcenter.unc.edu/tips-and-tools/application-essays/");
});

test("the dropped list names each note's category and reason, never its text", () => {
  const r = guardNotes([ok({ observation: "A strong start." }), ok({ category: "care", ask: "Remove it." })], DRAFT, { promptText: PROMPT });
  assert.deepEqual(r.dropped, [{ category: "specific", reason: "grade_word" }, { category: "care", reason: "care_question" }]);
  for (const d of r.dropped) assert.deepEqual(Object.keys(d).sort(), ["category", "reason"]);
});

test("order: mechanics first, then draft order, whole-draft notes after", () => {
  const notes = [
    { category: "voice" as const, span: { paragraph: 2, start: 0, end: 3 } },
    { category: "prompt" as const, span: null },
    { category: "mechanics" as const, span: { paragraph: 3, start: 0, end: 3 } },
    { category: "specific" as const, span: { paragraph: 0, start: 5, end: 9 } },
    { category: "mechanics" as const, span: { paragraph: 1, start: 0, end: 3 } },
  ];
  assert.deepEqual(orderNotes(notes).map((n) => `${n.category}:${n.span?.paragraph ?? "all"}`), ["mechanics:1", "mechanics:3", "specific:0", "voice:2", "prompt:all"]);
});

test("spanOffsets: a stored span back to the field's offsets, or null when the draft changed under it", () => {
  const text = "  First paragraph here.\n\nSecond one, with words.\n";
  assert.deepEqual(spanOffsets(text, { paragraph: 1, start: 0, end: 6 }), { start: text.indexOf("Second"), end: text.indexOf("Second") + 6 });
  assert.equal(text.slice(spanOffsets(text, { paragraph: 0, start: 6, end: 15 })!.start, spanOffsets(text, { paragraph: 0, start: 6, end: 15 })!.end), "paragraph");
  assert.equal(spanOffsets(text, { paragraph: 2, start: 0, end: 1 }), null);
  assert.equal(spanOffsets(text, { paragraph: 1, start: 0, end: 999 }), null);
});

/* ------------------------------------------------------------------ */
/* The guard is live: each rule, switched off, lets its violation through */
/* ------------------------------------------------------------------ */

test("guard: checkNote with an empty draft run set lets a nine-word copy through (rule 2 is what stops it)", () => {
  const paragraphs = paragraphsOf(DRAFT);
  const note = ok({ observation: "You write that Mr. Okafor who came in every Saturday with the same flat tire, which is vivid." });
  const strict = checkNote(note, { paragraphs, draftGrams: new Set(guardGrams(DRAFT)), ownWords: ` ${wordsOf(DRAFT).join(" ")} | `, promptWords: new Set(), allowedSources: null });
  const blind = checkNote(note, { paragraphs, draftGrams: new Set(), ownWords: ` ${wordsOf(DRAFT).join(" ")} | `, promptWords: new Set(), allowedSources: null });
  assert.deepEqual(strict, { ok: false, reason: "quote_run" });
  assert.equal(blind.ok, true, "the quote-run assertion would fail without the draft's runs");
});

function guardGrams(text: string): string[] {
  const w = wordsOf(text);
  const out: string[] = [];
  for (let i = 0; i + 9 <= w.length; i++) out.push(w.slice(i, i + 9).join(" "));
  return out;
}
