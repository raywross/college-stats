/**
 * The word diff behind suggested changes (lib/essays/diff.ts; specs/product/essays/editors.md "The changes"): tokens
 * that join back to the text, a shortest edit script that never splits a word, the pinned cases (a changed word, an
 * inserted sentence, a deleted sentence, a moved paragraph break, two identical edits), and the speed of a 650-word
 * draft against a rewrite. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tokenize, wordDiff, type Op, type Token } from "../lib/essays/diff.ts";
import { changesBetween, sha256Hex } from "../lib/essays/suggestions.ts";

/** The edit script replayed on `a` gives `b`; the equal and deleted tokens give `a`. */
function replay(a: Token[], b: Token[], ops: Op[]) {
  assert.deepEqual(ops.flatMap((o) => (o.kind === "insert" ? [] : o.tokens)), a, "equal + delete rebuild a");
  assert.deepEqual(ops.flatMap((o) => (o.kind === "delete" ? [] : o.tokens)), b, "equal + insert rebuild b");
}

const edits = (ops: Op[]) => ops.filter((o) => o.kind !== "equal").reduce((n, o) => n + o.tokens.length, 0);

test("tokens are words, whitespace runs and line breaks, and join back to the normalized text", () => {
  assert.deepEqual(tokenize("Hi  there.\r\n\nNew"), ["Hi", "  ", "there.", "\n", "\n", "New"]);
  assert.deepEqual(tokenize(""), []);
  for (const t of ["A b c", " lead and trail ", "one\n \ntwo", "smart “quotes” — dash", "zero​width"]) {
    assert.equal(tokenize(t).join(""), t.replace(/\r\n?/g, "\n").replace(/​/g, ""));
  }
});

test("the diff: equal texts are one equal run; an empty side is all insert or all delete", () => {
  const a = tokenize("The cat sat.");
  assert.deepEqual(wordDiff(a, a), [{ kind: "equal", tokens: a }]);
  assert.deepEqual(wordDiff([], a), [{ kind: "insert", tokens: a }]);
  assert.deepEqual(wordDiff(a, []), [{ kind: "delete", tokens: a }]);
  assert.deepEqual(wordDiff([], []), []);
});

test("pinned: a changed word is one delete and one insert, never a split word", () => {
  const a = tokenize("The cat sat on the mat.");
  const b = tokenize("The dog sat on the mat.");
  const ops = wordDiff(a, b);
  replay(a, b, ops);
  assert.deepEqual(ops.filter((o) => o.kind !== "equal"), [{ kind: "delete", tokens: ["cat"] }, { kind: "insert", tokens: ["dog"] }]);
});

test("pinned: an inserted sentence and a deleted sentence", () => {
  const a = tokenize("I ran. I fell. I rose.");
  const ins = tokenize("I ran. I tripped hard. I fell. I rose.");
  const opsIns = wordDiff(a, ins);
  replay(a, ins, opsIns);
  assert.equal(opsIns.filter((o) => o.kind === "delete").length, 0, "nothing deleted");
  assert.equal(edits(opsIns), 6, "three words and three spaces inserted");
  const del = tokenize("I ran. I rose.");
  const opsDel = wordDiff(a, del);
  replay(a, del, opsDel);
  assert.equal(opsDel.filter((o) => o.kind === "insert").length, 0, "nothing inserted");
  assert.equal(edits(opsDel), 4);
});

test("pinned: a moved paragraph break is a change", () => {
  const a = tokenize("One two.\nThree four.");
  const b = tokenize("One two. Three\nfour.");
  const ops = wordDiff(a, b);
  replay(a, b, ops);
  assert.ok(ops.some((o) => o.kind === "delete" && o.tokens.includes("\n")));
  assert.ok(ops.some((o) => o.kind === "insert" && o.tokens.includes("\n")));
  assert.equal(changesBetween("One two.\nThree four.", "One two. Three\nfour.").length, 1);
});

test("pinned: two identical edits are two edits, and the diff is the same every run", () => {
  const base = "It was good. Then more words came along here. It was good.";
  const next = "It was great. Then more words came along here. It was great.";
  const a = tokenize(base);
  const b = tokenize(next);
  const ops = wordDiff(a, b);
  replay(a, b, ops);
  assert.equal(ops.filter((o) => o.kind === "delete").length, 2);
  assert.deepEqual(wordDiff(a, b), ops, "deterministic");
});

test("the shortest script: a random edit's distance is no more than the edits made", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const words = "a b c d e f g h".split(" ");
  for (let n = 0; n < 200; n++) {
    const a: Token[] = Array.from({ length: Math.floor(rand() * 30) }, () => words[Math.floor(rand() * words.length)]);
    const b = [...a];
    let made = 0;
    for (let e = 0; e < 4; e++) {
      const at = Math.floor(rand() * (b.length + 1));
      if (rand() < 0.5 && b.length > 0 && at < b.length) b.splice(at, 1);
      else b.splice(at, 0, words[Math.floor(rand() * words.length)]);
      made++;
    }
    const ops = wordDiff(a, b);
    replay(a, b, ops);
    assert.ok(edits(ops) <= made, `case ${n}: ${edits(ops)} > ${made}`);
  }
});

test("a 650-word draft against a full rewrite runs in well under 50 ms", () => {
  const vocab = "the of and to in a is that for it as was with be by on not he this are or his from at which but have".split(" ");
  const draft = (salt: number) =>
    Array.from({ length: 650 }, (_, i) => `${vocab[(i * 7 + salt) % vocab.length]}${i % 11 === 0 ? "." : ""}${i % 90 === 89 ? "\n" : ""}`).join(" ");
  const a = tokenize(draft(0));
  const b = tokenize(draft(3).split(" ").reverse().join(" "));
  // This process's CPU time, the best of five runs: the test files run side by side, so wall time measures the others.
  const cpuMs = (fn: () => unknown) => {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t = process.cpuUsage();
      fn();
      const d = process.cpuUsage(t);
      best = Math.min(best, (d.user + d.system) / 1000);
    }
    return best;
  };
  replay(a, b, wordDiff(a, b));
  const ms = cpuMs(() => wordDiff(a, b));
  assert.ok(ms < 50, `${ms.toFixed(1)} ms`);
  const changes = cpuMs(() => changesBetween(draft(0), draft(3).split(" ").reverse().join(" ")));
  assert.ok(changes < 100, `changes: ${changes.toFixed(1)} ms`);
});

test("the in-house SHA-256 matches Node's", () => {
  for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "café — “quoted”\u0000x"]) {
    assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"), JSON.stringify(s.slice(0, 10)));
  }
});
