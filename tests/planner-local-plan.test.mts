/**
 * The signed-out plan kept in the browser (lib/planner/local-plan.ts; specs/planner/redesign/build-plan.md "U7
 * Signed-out Plan"): sanitizing untrusted `localStorage` JSON (capped, deduped, orphans dropped), the pure
 * transforms every tap on the page goes through, that storage errors never throw, and the import-selection logic
 * that decides what a sign-up carries onto the student's real list. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addLocalCollege,
  clearLocalPlan,
  emptyLocalPlan,
  getLocalPlan,
  localImportPlan,
  LOCAL_PLAN_KEY,
  MAX_LOCAL_COLLEGES,
  planItemsFor,
  removeLocalCollege,
  sanitizeLocalPlan,
  setLocalDream,
  setLocalGroup,
  setLocalPlan,
  setLocalRound,
  type LocalPlan,
} from "../lib/planner/local-plan.ts";

/* ------------------------------------------------------------------ */
/* sanitizeLocalPlan                                                   */
/* ------------------------------------------------------------------ */

test("sanitizeLocalPlan: not an object, or nothing at all, is the empty plan", () => {
  assert.deepEqual(sanitizeLocalPlan(null), emptyLocalPlan());
  assert.deepEqual(sanitizeLocalPlan(undefined), emptyLocalPlan());
  assert.deepEqual(sanitizeLocalPlan("garbage"), emptyLocalPlan());
  assert.deepEqual(sanitizeLocalPlan(42), emptyLocalPlan());
  assert.deepEqual(sanitizeLocalPlan([]), emptyLocalPlan());
});

test("sanitizeLocalPlan: dedupes unitIds, keeping the first occurrence's position", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654", "100724", "100654", "100724"] });
  assert.deepEqual(plan.unitIds, ["100654", "100724"]);
});

test("sanitizeLocalPlan: drops anything that isn't a unit id", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654", "not-a-unit-id", null, 42, "", "100724"] });
  assert.deepEqual(plan.unitIds, ["100654", "100724"]);
});

test("sanitizeLocalPlan: caps the list at MAX_LOCAL_COLLEGES", () => {
  const ids = Array.from({ length: MAX_LOCAL_COLLEGES + 10 }, (_, i) => String(100000 + i));
  const plan = sanitizeLocalPlan({ unitIds: ids });
  assert.equal(plan.unitIds.length, MAX_LOCAL_COLLEGES);
  assert.deepEqual(plan.unitIds, ids.slice(0, MAX_LOCAL_COLLEGES));
});

test("sanitizeLocalPlan: dream only counts when it's one of the kept unitIds", () => {
  assert.equal(sanitizeLocalPlan({ unitIds: ["100654"], dream: "100654" }).dream, "100654");
  assert.equal(sanitizeLocalPlan({ unitIds: ["100654"], dream: "999999" }).dream, null);
  assert.equal(sanitizeLocalPlan({ unitIds: ["100654"], dream: 42 }).dream, null);
  assert.equal(sanitizeLocalPlan({ unitIds: [] }).dream, null);
});

test("sanitizeLocalPlan: groups and rounds keep only valid values for a kept unitId", () => {
  const plan = sanitizeLocalPlan({
    unitIds: ["100654", "100724"],
    groups: { "100654": "reach", "100724": "not-a-group", "999999": "likely" },
    rounds: { "100654": "ed", "100724": "nope" },
  });
  assert.deepEqual(plan.groups, { "100654": "reach" });
  assert.deepEqual(plan.rounds, { "100654": "ed" });
});

test("sanitizeLocalPlan: malformed groups/rounds (not an object) are dropped, not thrown on", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654"], groups: "nope", rounds: ["also", "nope"] });
  assert.deepEqual(plan.groups, {});
  assert.deepEqual(plan.rounds, {});
});

/* ------------------------------------------------------------------ */
/* Pure transforms                                                     */
/* ------------------------------------------------------------------ */

test("addLocalCollege: appends a new id, refuses a duplicate, refuses at the cap", () => {
  let plan = emptyLocalPlan();
  plan = addLocalCollege(plan, "100654");
  assert.deepEqual(plan.unitIds, ["100654"]);
  const same = addLocalCollege(plan, "100654");
  assert.equal(same, plan); // unchanged reference: nothing to do

  const full: LocalPlan = { ...emptyLocalPlan(), unitIds: Array.from({ length: MAX_LOCAL_COLLEGES }, (_, i) => String(100000 + i)) };
  assert.equal(addLocalCollege(full, "200000"), full);
});

test("addLocalCollege: refuses anything that isn't a unit id", () => {
  const plan = emptyLocalPlan();
  assert.equal(addLocalCollege(plan, "not-a-unit-id"), plan);
});

test("removeLocalCollege: drops the id, its group, its round, and clears the Dream if it was it", () => {
  let plan = sanitizeLocalPlan({ unitIds: ["100654", "100724"], dream: "100654", groups: { "100654": "reach" }, rounds: { "100654": "ed" } });
  plan = removeLocalCollege(plan, "100654");
  assert.deepEqual(plan, { unitIds: ["100724"], dream: null, groups: {}, rounds: {} });
});

test("removeLocalCollege: a college not on the list is a no-op", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654"] });
  assert.equal(removeLocalCollege(plan, "999999"), plan);
});

test("setLocalDream: sets, clears, and refuses a college not on the list", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654", "100724"] });
  const withDream = setLocalDream(plan, "100724");
  assert.equal(withDream.dream, "100724");
  assert.equal(setLocalDream(withDream, null).dream, null);
  assert.equal(setLocalDream(plan, "999999"), plan);
});

test("setLocalGroup: sets a group as the visitor's own, null returns it to the suggestion", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654"] });
  const picked = setLocalGroup(plan, "100654", "reach");
  assert.deepEqual(picked.groups, { "100654": "reach" });
  assert.deepEqual(setLocalGroup(picked, "100654", null).groups, {});
  assert.equal(setLocalGroup(plan, "999999", "reach"), plan);
});

test("setLocalRound: sets a round as the visitor's own, null returns it to the starting round", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654"] });
  const picked = setLocalRound(plan, "100654", "ea");
  assert.deepEqual(picked.rounds, { "100654": "ea" });
  assert.deepEqual(setLocalRound(picked, "100654", null).rounds, {});
  assert.equal(setLocalRound(plan, "999999", "ea"), plan);
});

/* ------------------------------------------------------------------ */
/* Storage: every call wrapped, a throwing or missing store never breaks the page */
/* ------------------------------------------------------------------ */

function withFakeWindow<T>(storage: Storage, run: () => T): T {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
  try {
    return run();
  } finally {
    if (original === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = original;
  }
}

function throwingStorage(): Storage {
  return {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {
      throw new Error("storage blocked");
    },
    removeItem() {
      throw new Error("storage blocked");
    },
    clear() {},
    key() {
      return null;
    },
    length: 0,
  };
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return data.has(k) ? data.get(k)! : null;
    },
    setItem(k, v) {
      data.set(k, v);
    },
    removeItem(k) {
      data.delete(k);
    },
    clear() {
      data.clear();
    },
    key(i) {
      return [...data.keys()][i] ?? null;
    },
    get length() {
      return data.size;
    },
  };
}

test("getLocalPlan: no window (server render) is the empty plan, no throw", () => {
  assert.deepEqual(getLocalPlan(), emptyLocalPlan());
});

test("getLocalPlan: a storage that throws on read returns the empty plan, not an exception", () => {
  withFakeWindow(throwingStorage(), () => {
    assert.deepEqual(getLocalPlan(), emptyLocalPlan());
  });
});

test("getLocalPlan: bad JSON in storage returns the empty plan, not an exception", () => {
  withFakeWindow(memoryStorage({ [LOCAL_PLAN_KEY]: "{not json" }), () => {
    assert.deepEqual(getLocalPlan(), emptyLocalPlan());
  });
});

test("getLocalPlan: valid JSON round-trips through setLocalPlan", () => {
  withFakeWindow(memoryStorage(), () => {
    const plan = sanitizeLocalPlan({ unitIds: ["100654"], dream: "100654" });
    setLocalPlan(plan);
    assert.deepEqual(getLocalPlan(), plan);
  });
});

test("setLocalPlan: a storage that throws on write doesn't throw itself", () => {
  withFakeWindow(throwingStorage(), () => {
    assert.doesNotThrow(() => setLocalPlan(sanitizeLocalPlan({ unitIds: ["100654"] })));
  });
});

test("clearLocalPlan: no window, and a throwing store, are both safe", () => {
  assert.doesNotThrow(() => clearLocalPlan());
  withFakeWindow(throwingStorage(), () => {
    assert.doesNotThrow(() => clearLocalPlan());
  });
});

/* ------------------------------------------------------------------ */
/* planItemsFor                                                        */
/* ------------------------------------------------------------------ */

test("planItemsFor: considering status, position order, auto/student source split", () => {
  const plan = sanitizeLocalPlan({ unitIds: ["100654", "100724"], dream: "100724", groups: { "100654": "reach" }, rounds: { "100724": "ed" } });
  const items = planItemsFor(plan, () => "2026-10-10");
  assert.equal(items.length, 2);
  assert.equal(items[0].unit_id, "100654");
  assert.equal(items[0].position, 0);
  assert.equal(items[0].status, "considering");
  assert.equal(items[0].category, "reach");
  assert.equal(items[0].category_source, "student");
  assert.equal(items[0].round, null);
  assert.equal(items[0].round_source, "auto");
  assert.equal(items[0].dream, false);
  assert.equal(items[1].category, "unsorted");
  assert.equal(items[1].category_source, "auto");
  assert.equal(items[1].round, "ed");
  assert.equal(items[1].round_source, "student");
  assert.equal(items[1].dream, true);
});

/* ------------------------------------------------------------------ */
/* localImportPlan (the import-selection logic)                        */
/* ------------------------------------------------------------------ */

test("localImportPlan: adds only colleges not already on the real list", () => {
  const local = sanitizeLocalPlan({ unitIds: ["100654", "100724", "100730"] });
  const plan = localImportPlan(local, ["100724"]);
  assert.deepEqual(plan.toAdd, ["100654", "100730"]);
});

test("localImportPlan: carries the Dream, drops one that's no longer on the (trimmed) list", () => {
  const local = sanitizeLocalPlan({ unitIds: ["100654"], dream: "100654" });
  assert.equal(localImportPlan(local, []).dreamUnitId, "100654");
  assert.equal(localImportPlan({ ...local, dream: "999999" }, []).dreamUnitId, null);
  assert.equal(localImportPlan({ ...emptyLocalPlan() }, []).dreamUnitId, null);
});

test("localImportPlan: only the groups/rounds the visitor actually picked become writes; an auto one stays untouched", () => {
  const local = sanitizeLocalPlan({ unitIds: ["100654", "100724"], groups: { "100654": "reach" }, rounds: { "100724": "ea" } });
  const plan = localImportPlan(local, []);
  assert.deepEqual(plan.groupWrites, [{ unitId: "100654", group: "reach" }]);
  assert.deepEqual(plan.roundWrites, [{ unitId: "100724", round: "ea" }]);
});

test("localImportPlan: an empty local plan imports nothing", () => {
  const plan = localImportPlan(emptyLocalPlan(), ["100724"]);
  assert.deepEqual(plan, { toAdd: [], dreamUnitId: null, groupWrites: [], roundWrites: [] });
});
