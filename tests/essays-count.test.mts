/**
 * The count rule and the normalizer (lib/essays/count.ts, lib/essays/normalize.ts; specs/product/essays/workspace.md
 * "The editor", "The round trip"): words are whitespace-separated tokens after trimming (the Common App's rule),
 * characters are code points, and text pasted from Word or a phone counts the way the form counts it. The forms'
 * examples are pinned here; each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AMBER_AT, countCharacters, countLabel, countState, countStateLine, countText, countWords } from "../lib/essays/count.ts";
import { anchorFor, anchoredText, normalizeForCount, normalizeLineEndings, normalizeText, paragraphsOf } from "../lib/essays/normalize.ts";

const ch = (code: number) => String.fromCodePoint(code);
const NBSP = ch(0xa0);
const EM = ch(0x2014);
const EN = ch(0x2013);
const ZWSP = ch(0x200b);
const BOM = ch(0xfeff);
const LSQUO = ch(0x2018);
const RSQUO = ch(0x2019);
const LDQUO = ch(0x201c);
const RDQUO = ch(0x201d);
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

test("words are whitespace-separated tokens after trimming", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n\t "), 0);
  assert.equal(countWords("one"), 1);
  assert.equal(countWords("  one   two\tthree\n\nfour  "), 4);
  assert.equal(countWords("Hello, world."), 2);
});

test("the Common App's examples: a hyphenated word is one word", () => {
  assert.equal(countWords("a well-known fact"), 3);
  assert.equal(countWords("my mother-in-law's recipe"), 3);
});

test("the Common App's examples: an em dash with spaces is a separator, not a word", () => {
  assert.equal(countWords(`this ${EM} that`), 2);
  assert.equal(countWords(`this ${EN} that`), 2);
  assert.equal(countWords("this -- that"), 2);
  // Without spaces the dash joins the words into one token, as the form counts it.
  assert.equal(countWords(`this${EM}that`), 1);
});

test("the Common App's examples: 650 of 650 is allowed, 651 is over", () => {
  const limit = { kind: "words" as const, max: 650, min: 250 };
  assert.equal(countWords(words(650)), 650);
  assert.notEqual(countState(650, limit), "over");
  assert.equal(countState(651, limit), "over");
  assert.equal(countLabel(650, limit), "650 of 650 words");
});

test("text from Word or a phone counts as the form counts it: non-breaking spaces, CRLF, zero-width characters", () => {
  assert.equal(countWords(`one${NBSP}two`), 2, "a non-breaking space separates words");
  assert.equal(countWords("one\r\ntwo\r\n\r\nthree"), 3);
  assert.equal(countWords(`${BOM}one${ZWSP} two`), 2, "invisible characters are not words");
  assert.equal(countWords(`${LDQUO}Quoted,${RDQUO} she said. It${RSQUO}s ${LSQUO}fine${RSQUO}.`), 5, "smart punctuation is part of its word");
});

test("guard: splitting on spaces only (not all whitespace) miscounts a pasted line break", () => {
  const naive = (t: string) => t.trim().split(" ").filter(Boolean).length;
  assert.notEqual(naive("one\ntwo"), countWords("one\ntwo"), "the rule's pinned example would catch the regression");
  const noDashRule = (t: string) => t.trim().split(/\s+/).length;
  assert.notEqual(noDashRule(`this ${EM} that`), countWords(`this ${EM} that`), "the em dash example would catch a count that keeps dashes");
});

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

test("characters are code points: an emoji is one, a CRLF is one line break", () => {
  assert.equal(countCharacters("abc"), 3);
  assert.equal(countCharacters(ch(0x1f600)), 1);
  assert.equal(ch(0x1f600).length, 2, "UTF-16 length would say two");
  assert.equal(countCharacters("a\r\nb"), 3);
  assert.equal(countCharacters(`a${ZWSP}b`), 2);
  assert.equal(countText("a b", "characters"), 3);
  assert.equal(countText("a b"), 2, "words by default");
});

/* ------------------------------------------------------------------ */
/* The bar's thresholds                                                */
/* ------------------------------------------------------------------ */

test("amber from 95%, red over, short of a minimum, nothing without a limit", () => {
  const limit = { kind: "words" as const, max: 650, min: 250 };
  assert.equal(AMBER_AT, 0.95);
  assert.equal(countState(100, null), "none");
  assert.equal(countState(0, limit), "ok", "an empty draft isn't 'short' yet");
  assert.equal(countState(249, limit), "under");
  assert.equal(countState(250, limit), "ok");
  assert.equal(countState(617, limit), "ok");
  assert.equal(countState(618, limit), "near", "95% of 650 rounds up to 618");
  assert.equal(countState(650, limit), "near");
  assert.equal(countState(651, limit), "over");
  assert.equal(countStateLine("over", 655, limit), "5 words over the limit");
  assert.equal(countStateLine("under", 240, limit), "10 words short of the 250 minimum");
  assert.equal(countStateLine("ok", 400, limit), null);
  assert.equal(countLabel(1180, { kind: "characters", max: 1500 }), "1,180 of 1,500 characters");
  assert.equal(countLabel(412, null), "412 words");
  assert.equal(countLabel(1, null), "1 word");
});

/* ------------------------------------------------------------------ */
/* Normalize                                                           */
/* ------------------------------------------------------------------ */

test("normalizeText unifies line endings and drops invisible characters, leaving smart punctuation and NBSPs as typed", () => {
  assert.equal(normalizeLineEndings("a\r\nb\rc"), "a\nb\nc");
  assert.equal(normalizeLineEndings(`a${ch(0x2029)}b`), "a\nb");
  const typed = `${BOM}${LDQUO}Hi${RDQUO}${NBSP}there${ZWSP} ${EM} ok\r\n`;
  assert.equal(normalizeText(typed), `${LDQUO}Hi${RDQUO}${NBSP}there ${EM} ok\n`);
  assert.equal(normalizeForCount(typed), `${LDQUO}Hi${RDQUO} there ${EM} ok\n`, "the count reads the NBSP as a space");
});

test("paragraphs and comment anchors", () => {
  const text = "First paragraph here.\n\n  Second one, indented.\nThird.";
  assert.deepEqual(paragraphsOf(text), ["First paragraph here.", "Second one, indented.", "Third."]);
  const start = text.indexOf("one");
  const a = anchorFor(text, start, start + 3);
  assert.deepEqual(a, { paragraph: 1, start: 7, end: 10 });
  assert.equal(anchoredText(text, a!), "one");
  assert.equal(anchorFor(text, 5, 5), null, "an empty selection is no anchor");
  // A selection running past its paragraph is cut at the paragraph's end.
  const cut = anchorFor(text, text.indexOf("here"), text.length);
  assert.equal(anchoredText(text, cut!), "here.");
  assert.equal(anchoredText("Changed.", { paragraph: 3, start: 0, end: 2 }), null, "an anchor into text that's gone");
});
