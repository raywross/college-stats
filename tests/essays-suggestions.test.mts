/**
 * Suggested changes (lib/essays/suggestions.ts; specs/product/essays/editors.md "The changes: how they are computed,
 * named, located and applied"): changes with stable keys, merged edits and dropped whitespace; finding a change in an
 * unchanged, shifted and rewritten draft; applying one and all from the end; the three renderings; the status rule;
 * the decision a Server Action makes; and the version list's line. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyChanges,
  asSuggested,
  changesBetween,
  locateChange,
  planDecision,
  renderWithChanges,
  statusAfter,
  suggestionLabel,
  viewChanges,
  type Change,
} from "../lib/essays/suggestions.ts";
import { shouldVersion, VERSION_PAUSE_MS, VERSION_SOURCES } from "../lib/essays/rows.ts";

const BASE = "My grandmother kept bees. Every summer I helped her lift the frames.\n\nThe hive taught me patience and a kind of quiet courage I still carry.";

const one = (base: string, proposed: string): Change => {
  const cs = changesBetween(base, proposed);
  assert.equal(cs.length, 1, `one change, got ${JSON.stringify(cs)}`);
  return cs[0];
};

/* ------------------------------------------------------------------ */
/* Computing                                                           */
/* ------------------------------------------------------------------ */

test("a changed word: removed, inserted, and three words of context either side", () => {
  const c = one(BASE, BASE.replace("lift", "raise"));
  assert.equal(c.removed, "lift");
  assert.equal(c.inserted, "raise");
  assert.equal(c.before, "I helped her ");
  assert.equal(c.after, " the frames. The");
  assert.match(c.key, /^[0-9a-f]{16}$/);
});

test("an inserted sentence, a deleted sentence, and a paragraph joined", () => {
  const ins = one(BASE, BASE.replace("bees. ", "bees. She called them her girls. "));
  assert.equal(ins.removed, "");
  assert.equal(ins.inserted.trim(), "She called them her girls.");
  const del = one(BASE, BASE.replace(" Every summer I helped her lift the frames.", ""));
  assert.equal(del.inserted, "");
  assert.equal(del.removed.trim(), "Every summer I helped her lift the frames.");
  const joined = one(BASE, BASE.replace("\n\n", " "));
  assert.equal(joined.removed, "\n\n");
  assert.equal(joined.inserted, " ");
});

test("edits fewer than three unchanged words apart join; three or more apart stay two changes", () => {
  const near = changesBetween("one two three four five six seven", "one TWO three FOUR five six seven");
  assert.equal(near.length, 1);
  assert.equal(near[0].removed, "two three four");
  assert.equal(near[0].inserted, "TWO three FOUR");
  const far = changesBetween("one two three four five six seven", "one TWO three four five SIX seven");
  assert.equal(far.length, 2);
});

test("whitespace inside a paragraph is dropped; nothing changed is no changes", () => {
  assert.deepEqual(changesBetween(BASE, BASE.replace("kept bees", "kept  bees")), []);
  assert.deepEqual(changesBetween(BASE, BASE), []);
  assert.deepEqual(changesBetween(BASE, BASE.replace(/\n/g, "\r\n")), [], "line endings are normalized first");
});

test("keys are stable across recomputation and distinct for two identical edits", () => {
  const base = "aa bb cc good dd ee ff aa bb cc good dd ee ff";
  const next = base.replace(/good/g, "great");
  const a = changesBetween(base, next);
  const b = changesBetween(base, next);
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((c) => c.key), b.map((c) => c.key));
  assert.equal(a[0].removed + a[0].before + a[0].after, a[1].removed + a[1].before + a[1].after, "the same four strings");
  assert.notEqual(a[0].key, a[1].key);
  // Each finds its own occurrence, in either order.
  assert.equal(applyChanges(base, [a[1]]).text, "aa bb cc good dd ee ff aa bb cc great dd ee ff");
  assert.equal(applyChanges(base, [a[0]]).text, "aa bb cc great dd ee ff aa bb cc good dd ee ff");
  assert.equal(applyChanges(applyChanges(base, [a[1]]).text, [a[0]]).text, next);
});

/* ------------------------------------------------------------------ */
/* Locating                                                            */
/* ------------------------------------------------------------------ */

test("locate: in the unchanged text, after an edit earlier (offsets shift), after an edit later", () => {
  const c = one(BASE, BASE.replace("lift", "raise"));
  const at = locateChange(BASE, c)!;
  assert.equal(BASE.slice(at.start, at.end), "lift");
  const earlier = "Long ago, " + BASE;
  const shifted = locateChange(earlier, c)!;
  assert.equal(shifted.start, at.start + 10);
  assert.equal(earlier.slice(shifted.start, shifted.end), "lift");
  const later = BASE + "\n\nA new last paragraph.";
  assert.deepEqual(locateChange(later, c), at);
});

test("locate: whitespace differences don't matter; a rewrite of the spot is stale", () => {
  const c = one(BASE, BASE.replace("lift", "raise"));
  const spaced = BASE.replace("her lift", "her   lift").replace("\n\n", "\n");
  assert.equal(spaced.slice(locateChange(spaced, c)!.start, locateChange(spaced, c)!.end), "lift");
  assert.equal(locateChange(BASE.replace("I helped her lift the frames", "we worked the hive together"), c), null);
});

test("locate: the removed words alone when they occur once, never inside another word", () => {
  const c = one(BASE, BASE.replace("patience", "endurance"));
  const moved = BASE.replace("taught me patience and", "gave me, slowly, patience as well as");
  const at = locateChange(moved, c)!;
  assert.equal(moved.slice(at.start, at.end), "patience");
  const twice = moved + " More patience here.";
  assert.equal(locateChange(twice, c), null, "twice is ambiguous: stale");
  const inside = one("a cat sat here today.", "a dog sat here today.");
  assert.equal(locateChange("the category sat, they said.", inside), null);
});

test("locate: a pure insertion is found by its neighbours side by side", () => {
  const c = one(BASE, BASE.replace("kept bees.", "kept many bees."));
  const at = locateChange(BASE, c)!;
  const applied = BASE.slice(0, at.start) + c.inserted + BASE.slice(at.end);
  assert.equal(applied, BASE.replace("kept bees.", "kept many bees."));
});

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

const PROPOSED = BASE.replace("kept bees", "kept honeybees").replace("lift the frames", "lift the heavy frames").replace("quiet courage", "stubborn courage");

test("apply one; apply all from the end gives the proposed text", () => {
  const cs = changesBetween(BASE, PROPOSED);
  assert.equal(cs.length, 3);
  const first = applyChanges(BASE, [cs[1]]);
  assert.deepEqual(first.applied, [cs[1].key]);
  assert.equal(first.text, BASE.replace("lift the frames", "lift the heavy frames"));
  const all = applyChanges(BASE, cs);
  assert.equal(all.text, PROPOSED);
  assert.deepEqual(all.applied, cs.map((c) => c.key));
  assert.deepEqual(all.stale, []);
});

test("apply after the student inserted a paragraph above and rewrote one spot", () => {
  const cs = changesBetween(BASE, PROPOSED);
  const now = "A first paragraph the student added.\n\n" + BASE.replace("quiet courage I still carry", "a courage I keep");
  const r = applyChanges(now, cs);
  assert.deepEqual(r.applied, [cs[0].key, cs[1].key]);
  assert.deepEqual(r.stale, [cs[2].key]);
  assert.equal(r.text, "A first paragraph the student added.\n\n" + BASE.replace("kept bees", "kept honeybees").replace("lift the frames", "lift the heavy frames").replace("quiet courage I still carry", "a courage I keep"));
});

test("random edits: accepting every change gives the proposed text (whitespace runs aside), nothing stale", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const vocab = "the bees hive summer frames honey smoke quiet my grandmother taught patience courage".split(" ");
  const squash = (s: string) => s.replace(/[^\S\n]+/g, " ");
  for (let n = 0; n < 150; n++) {
    const words = Array.from({ length: 20 + Math.floor(rand() * 60) }, (_, i) => pick(vocab) + (i % 9 === 8 ? "." : ""));
    const seps = words.map(() => (rand() < 0.06 ? "\n\n" : " "));
    const join = (ws: string[], ss: string[]) => ws.map((w, i) => w + (i < ws.length - 1 ? ss[i] : "")).join("");
    const base = join(words, seps);
    const w2 = [...words];
    const s2 = [...seps];
    for (let e = 0; e < 1 + Math.floor(rand() * 5); e++) {
      const at = Math.floor(rand() * w2.length);
      const r = rand();
      if (r < 0.4) w2[at] = pick(vocab);
      else if (r < 0.7) {
        w2.splice(at, 0, pick(vocab));
        s2.splice(at, 0, " ");
      } else if (r < 0.9 && w2.length > 2) {
        w2.splice(at, 1);
        s2.splice(at, 1);
      } else s2[at] = s2[at] === " " ? "\n\n" : " ";
    }
    const proposed = join(w2, s2);
    const cs = changesBetween(base, proposed);
    const r = applyChanges(base, cs);
    assert.deepEqual(r.stale, [], `case ${n}: stale`);
    assert.equal(squash(r.text), squash(proposed), `case ${n}`);
  }
});

test("two identical edits apply one by one: each finds its own spot", () => {
  const base = "It was good. Then more words came along here and there. It was good.";
  const next = base.replace(/good/g, "great");
  const [a, b] = changesBetween(base, next);
  const second = applyChanges(base, [b]);
  assert.equal(second.text, "It was good. Then more words came along here and there. It was great.");
  const then = applyChanges(second.text, [a]);
  assert.equal(then.text, next);
});

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

test("the three renderings: with changes, as suggested, original", () => {
  const views = viewChanges(BASE, BASE, { proposed_body: PROPOSED, decisions: {} });
  const segs = renderWithChanges(BASE, views);
  assert.equal(segs.filter((s) => s.kind !== "ins").map((s) => s.text).join(""), BASE, "text + del is the original");
  assert.equal(segs.filter((s) => s.kind !== "del").map((s) => s.text).join(""), PROPOSED, "text + ins is as suggested");
  assert.deepEqual(segs.filter((s) => s.kind === "del").map((s) => s.text), ["bees.", "quiet"], "a pure insertion strikes nothing");
  assert.equal(asSuggested(BASE, views), PROPOSED);
  assert.ok(segs.every((s) => s.kind === "text" || views.some((v) => v.key === s.key)));
});

test("decided changes leave the renderings; an accepted one is located by its new words", () => {
  const cs = changesBetween(BASE, PROPOSED);
  const now = applyChanges(BASE, [cs[0]]).text;
  const views = viewChanges(now, BASE, { proposed_body: PROPOSED, decisions: { [cs[0].key]: "accepted", [cs[2].key]: "rejected" } });
  assert.equal(views[0].decision, "accepted");
  assert.equal(now.slice(views[0].located!.start, views[0].located!.end), "honeybees.");
  assert.equal(views[2].located, null);
  const segs = renderWithChanges(now, views);
  assert.deepEqual(segs.filter((s) => s.kind !== "text").map((s) => s.key), [cs[1].key]);
  assert.equal(asSuggested(now, views), now.replace("lift the frames", "lift the heavy frames"));
});

test("a stale change is not drawn in the text", () => {
  const cs = changesBetween(BASE, PROPOSED);
  const now = BASE.replace("quiet courage I still carry", "a courage I keep");
  const views = viewChanges(now, BASE, { proposed_body: PROPOSED, decisions: {} });
  assert.equal(views[2].located, null);
  assert.ok(!renderWithChanges(now, views).some((s) => s.key === cs[2].key));
});

/* ------------------------------------------------------------------ */
/* Status, decisions, the label                                        */
/* ------------------------------------------------------------------ */

test("status: decided once every change has a decision", () => {
  const cs = changesBetween(BASE, PROPOSED);
  assert.equal(statusAfter(cs, {}), "open");
  assert.equal(statusAfter(cs, { [cs[0].key]: "accepted", [cs[1].key]: "rejected" }), "open");
  assert.equal(statusAfter(cs, { [cs[0].key]: "accepted", [cs[1].key]: "rejected", [cs[2].key]: "accepted" }), "decided");
});

test("a decision: merged over the stored ones, accepted changes applied, a stale accept left open, strangers ignored", () => {
  const cs = changesBetween(BASE, PROPOSED);
  const now = BASE.replace("quiet courage I still carry", "a courage I keep");
  const p = planDecision(now, BASE, PROPOSED, { [cs[0].key]: "rejected" }, { [cs[0].key]: "accepted", [cs[1].key]: "accepted", [cs[2].key]: "accepted", ffffffffffffffff: "accepted" });
  assert.equal(p.text, now.replace("lift the frames", "lift the heavy frames"), "a stored rejection stands; the new accept applies");
  assert.deepEqual(p.decisions, { [cs[0].key]: "rejected", [cs[1].key]: "accepted" });
  assert.deepEqual(p.applied, [cs[1].key]);
  assert.deepEqual(p.stale, [cs[2].key]);
  assert.equal(p.status, "open");
  assert.equal(p.all, true);
  const last = planDecision(p.text, BASE, PROPOSED, p.decisions, { [cs[2].key]: "rejected" });
  assert.equal(last.status, "decided");
  assert.equal(last.text, p.text);
  assert.deepEqual([last.accepted, last.total, last.all], [1, 3, false]);
});

test("accepted changes (source `suggested`) follow the ten-minute rule like typing; an import still always versions", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(shouldVersion({ lastVersionAt: ago(60_000), now, source: "suggested", mark: false, changed: true }), false);
  assert.equal(shouldVersion({ lastVersionAt: ago(VERSION_PAUSE_MS), now, source: "suggested", mark: false, changed: true }), true);
  assert.equal(shouldVersion({ lastVersionAt: ago(60_000), now, source: "suggested", mark: true, changed: false }), true, "the last decision's mark");
  assert.equal(shouldVersion({ lastVersionAt: ago(60_000), now, source: "pasted", mark: false, changed: true }), true);
  assert.ok(VERSION_SOURCES.includes("suggested"));
});

test("the version list's line", () => {
  assert.equal(suggestionLabel("Jane", 3, 4), "Accepted 3 of 4 changes from Jane");
  assert.equal(suggestionLabel("Jane", 1, 1), "Accepted 1 of 1 change from Jane");
  assert.ok(suggestionLabel("x".repeat(200), 1, 2).length <= 80);
});
