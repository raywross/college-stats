/**
 * The reader's rubric and its guidance (lib/essays/rubric.ts, lib/essays/guidance.ts; specs/product/essays/reviewer.md
 * "What a note is", "The guidance corpus"): the eight categories agree everywhere they are named, the rubric states
 * every rule and refusal, the spec's own example notes pass the guard, the corpus's thirteen contract sections load by
 * heading, the owner's section never reaches the reader, each kind gets its sections, and the browser's notes list
 * imports none of it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { citedUrls, GUIDANCE_HEADINGS, guidanceText, loadGuidance, missingSections, OWNER_SECTION, parseGuidance, sectionsFor } from "../lib/essays/guidance.ts";
import { ESSAY_KINDS } from "../lib/essays/prompts.ts";
import { givesInstruction, hasGradeWord, hasPrediction, sentenceCount } from "../lib/essays/review-guard.ts";
import { CATEGORY_LABEL, CATEGORY_RULES, FIX_MAX_WORDS, MAX_NOTES, NOTE_CATEGORIES, QUOTE_RUN_MAX, REFUSALS, REVIEW_CAPS, REVIEW_METHOD, REVIEW_MODEL, rubricText } from "../lib/essays/rubric.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const GUIDANCE_MD = read("data/reference/essay-guidance/guidance.md");

test("REVIEW_METHOD is a dotted date edition and the model is Opus 5", () => {
  assert.match(REVIEW_METHOD, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
  assert.equal(REVIEW_MODEL, "claude-opus-5");
});

test("the eight categories, in the list's order (mechanics first), match the migration's check", () => {
  assert.deepEqual([...NOTE_CATEGORIES], ["mechanics", "prompt", "specific", "structure", "voice", "care", "showcase", "interest"]);
  const sql = read("supabase/migrations/20261029130000_essay_reviews.sql");
  const check = /category\s+text not null check \(category in \(([^)]*)\)\)/.exec(sql);
  assert.ok(check, "the notes table checks its category");
  assert.deepEqual(check[1].split(",").map((s) => s.trim().replace(/'/g, "")), [...NOTE_CATEGORIES]);
  for (const c of NOTE_CATEGORIES) {
    assert.ok(CATEGORY_RULES[c].looksFor && CATEGORY_RULES[c].example, c);
    assert.ok(CATEGORY_LABEL[c], c);
  }
});

test("the caps match the migration's numbers", () => {
  const sql = read("supabase/migrations/20261029130000_essay_reviews.sql");
  assert.match(sql, new RegExp(`v_draft_day < ${REVIEW_CAPS.perDraftPerDay} and v_student_day < ${REVIEW_CAPS.perStudentPerDay} and v_draft_cycle < ${REVIEW_CAPS.perDraftPerCycle}`));
  assert.match(sql, new RegExp(`jsonb_array_length\\(p_notes\\) > ${MAX_NOTES}`));
});

test("the rubric states every category, every rule, and every refusal, with the guard's numbers", () => {
  const text = rubricText();
  for (const c of NOTE_CATEGORIES) assert.ok(text.includes(`### ${c}`), c);
  for (const r of REFUSALS) assert.ok(text.includes(r), r);
  assert.ok(text.includes(`At most ${MAX_NOTES} notes`));
  assert.ok(text.includes(`at most ${FIX_MAX_WORDS} words`));
  assert.ok(/eight consecutive words/.test(text) && QUOTE_RUN_MAX === 8);
  assert.ok(/never write any part of it/i.test(text), "the reader never writes the essay");
  assert.ok(/not instructions to you/.test(text), "a request hidden in the draft is material, not an instruction");
  assert.equal(rubricText(), text, "the same bytes every time (the cached prefix)");
});

test("the spec's example notes pass the guard's word rules (a note the rubric shows is one the guard keeps)", () => {
  for (const c of NOTE_CATEGORIES) {
    const ex = CATEGORY_RULES[c].example;
    assert.equal(hasGradeWord(ex), false, `${c}: ${ex}`);
    assert.equal(hasPrediction(ex), false, `${c}: ${ex}`);
    assert.ok(sentenceCount(ex) <= 2, `${c}: ${ex}`);
    if (c === "care") {
      assert.ok(ex.includes("?"));
      assert.equal(givesInstruction(ex), false);
    }
  }
});

test("labels and the rubric carry no grade words and never say AI", () => {
  for (const label of Object.values(CATEGORY_LABEL)) {
    assert.equal(hasGradeWord(label), false, label);
    assert.doesNotMatch(label, /\bAI\b/);
  }
});

/* ------------------------------------------------------------------ */
/* The guidance                                                        */
/* ------------------------------------------------------------------ */

test("the corpus has all thirteen contract sections, and the owner's section is never parsed", () => {
  const sections = parseGuidance(GUIDANCE_MD);
  assert.deepEqual(missingSections(sections), []);
  assert.deepEqual(Object.keys(sections).sort(), [...GUIDANCE_HEADINGS].sort());
  assert.ok(GUIDANCE_MD.includes(`## ${OWNER_SECTION}`), "the file has the owner's section");
  const ownerBody = GUIDANCE_MD.slice(GUIDANCE_MD.indexOf(`## ${OWNER_SECTION}`));
  const ownerLine = ownerBody.split("\n").find((l) => l.startsWith("1. "));
  assert.ok(ownerLine);
  for (const kind of ESSAY_KINDS) {
    const text = guidanceText(sections, kind);
    assert.ok(!text.includes(OWNER_SECTION), kind);
    assert.ok(!text.includes(ownerLine), `${kind}: the owner's questions stay out`);
    assert.ok(!text.includes("DRAFT for the owner's review"), `${kind}: the preamble stays out`);
  }
  assert.deepEqual(loadGuidance(), sections, "the runtime loader reads the same file");
});

test("each kind gets its sections: interest only for a why-us or program prompt, short answers only for short ones", () => {
  for (const kind of ESSAY_KINDS) {
    const picked = sectionsFor(kind);
    for (const craft of ["mechanics", "prompt", "specific", "structure", "voice", "care", "showcase"] as const) assert.ok(picked.includes(craft), `${kind} ${craft}`);
    const interest = kind === "why_us" || kind === "program";
    assert.equal(picked.includes("interest"), interest, kind);
    assert.equal(picked.includes("approach: showing interest"), interest, kind);
    assert.equal(picked.includes("approach: short answers"), kind === "short_answer" || kind === "activity", kind);
  }
  const sections = parseGuidance(GUIDANCE_MD);
  assert.equal(guidanceText(sections, "why_us"), guidanceText(sections, "program"), "one prefix per kind group, so it caches");
});

test("every url the reader may cite is one sources.json holds", () => {
  const file = JSON.parse(read("data/reference/essay-guidance/sources.json")) as { sources: { url: string }[] };
  const norm = (u: string) => u.replace(/\/+$/, "");
  const known = new Set(file.sources.map((s) => norm(s.url)));
  const sections = parseGuidance(GUIDANCE_MD);
  for (const kind of ESSAY_KINDS) {
    const urls = citedUrls(guidanceText(sections, kind));
    assert.ok(urls.size > 10, kind);
    for (const u of urls) assert.ok(known.has(norm(u)), `${kind}: ${u}`);
  }
});

test("guard: a file without a section is caught, and an unknown heading is ignored", () => {
  const broken = GUIDANCE_MD.replace("## care\n", "## carefulness\n");
  const sections = parseGuidance(broken);
  assert.deepEqual(missingSections(sections), ["care"]);
  assert.ok(!("carefulness" in sections));
  const extra = parseGuidance(`${GUIDANCE_MD}\n\n## notes to self\n\nSecret.\n`);
  assert.ok(!Object.values(extra).some((t) => t?.includes("Secret.")));
});

/* ------------------------------------------------------------------ */
/* The browser gets none of it                                         */
/* ------------------------------------------------------------------ */

test("the notes list imports only types from the reader and nothing from the rubric, guard, or guidance", () => {
  const src = read("components/essays/Notes.tsx");
  assert.match(src, /^import type \{[^}]*\} from "@\/lib\/essays\/review";$/m);
  assert.doesNotMatch(src, /from "@\/lib\/essays\/(rubric|review-guard|guidance|review-context)"/);
  assert.doesNotMatch(src, /^import \{[^}]*\} from "@\/lib\/essays\/review";$/m);
  assert.match(read("lib/essays/review.ts"), /^import "server-only";/);
  assert.match(read("lib/essays/notes-view.ts"), /^import type \{ NoteCategory \} from "\.\/rubric\.ts";$/m, "notes-view takes only a type from the rubric");
});
