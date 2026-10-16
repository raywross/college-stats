/**
 * The per-college hooks the plan sends with its estimates (lib/planner/hooks.ts): legacy, sibling, and recruited
 * from the student's profile connections (plan v3, connections.md), and demonstrated interest from a visit, an
 * information request, or a follow on social (the capture panel, owner 2026-10-12). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hooksFromPlan, showsInterest, type HooksItem } from "../lib/planner/hooks.ts";
import { connectionFor, emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import type { ConnectionEntry } from "../lib/student-profile.ts";

const item = (over: Partial<HooksItem> = {}): HooksItem => ({
  id: "i1",
  unit_id: "100",
  visited_on: null,
  info_requested_on: null,
  followed_networks: [],
  follows_social: false,
  ...over,
});

const profileWith = (connections: ConnectionEntry[]): Pick<StudentProfileData, "academics"> => {
  const p = emptyProfile();
  return { academics: { ...p.academics, connections } };
};

test("a college with nothing set is left out of the map", () => {
  assert.deepEqual(hooksFromPlan([item()]), {});
});

test("a planted row column (legacy, recruited) no longer influences hooks", () => {
  // The columns still exist on the row (read-plan.ts reads them harmlessly), but hooksFromPlan never looks at them.
  const withColumns = { ...item(), legacy: true, recruited: "pre_read" } as HooksItem;
  assert.deepEqual(hooksFromPlan([withColumns]), {}, "no profile, no connection: nothing, even with row columns set");
});

test("hooks from connections: parent and grandparent are legacy, sibling is its own, recruited is the pick", () => {
  const parent: ConnectionEntry = { id: "c1", unitId: "100", family: ["parent"], recruited: "none" };
  assert.deepEqual(hooksFromPlan([item()], [], profileWith([parent])), { "100": { legacy: true, sibling: false, recruited: "none", interest: false } });

  const grandparent: ConnectionEntry = { id: "c2", unitId: "100", family: ["grandparent"], recruited: "none" };
  assert.deepEqual(hooksFromPlan([item()], [], profileWith([grandparent])), { "100": { legacy: true, sibling: false, recruited: "none", interest: false } });

  const sibling: ConnectionEntry = { id: "c3", unitId: "100", family: ["sibling"], recruited: "none" };
  assert.deepEqual(hooksFromPlan([item()], [], profileWith([sibling])), { "100": { legacy: false, sibling: true, recruited: "none", interest: false } });

  const recruited: ConnectionEntry = { id: "c4", unitId: "100", family: [], recruited: "pre_read" };
  assert.deepEqual(hooksFromPlan([item()], [], profileWith([recruited])), { "100": { legacy: false, sibling: false, recruited: "pre_read", interest: false } });
});

test("a connection on a college not on the list is ignored by hooksFromPlan (it only walks the list's own rows); connectionFor still finds it", () => {
  const elsewhere: ConnectionEntry = { id: "c5", unitId: "999", family: ["parent"], recruited: "none" };
  const profile = profileWith([elsewhere]);
  assert.deepEqual(hooksFromPlan([item()], [], profile), {});
  assert.deepEqual(connectionFor(profile, "999"), elsewhere);
  assert.equal(connectionFor(profile, "100"), null, "no connection for a college that isn't the elsewhere one");
});

test("without a profile, nothing from connections", () => {
  assert.deepEqual(hooksFromPlan([item()], [], null), {});
});

test("interest: a visit date, a logged visit, an information request, or a follow each count", () => {
  const none = new Set<string>();
  assert.equal(showsInterest(item(), none), false);
  assert.equal(showsInterest(item({ visited_on: "2026-09-01" }), none), true);
  assert.equal(showsInterest(item(), new Set(["i1"])), true, "a plan_visits entry");
  assert.equal(showsInterest(item(), new Set(["other"])), false, "another college's visit doesn't count");
  assert.equal(showsInterest(item({ info_requested_on: "2026-09-01" }), none), true);
  assert.equal(showsInterest(item({ followed_networks: ["instagram"] }), none), true);
  assert.equal(showsInterest(item({ follows_social: true }), none), true, "the older tracking row's switch");
  // Rows read before the follow columns were selected leave them undefined: no interest from them, no crash.
  assert.equal(showsInterest({ ...item(), followed_networks: undefined, follows_social: undefined }, none), false);
});

test("hooksFromPlan reads visits by item id and keys the map by unit id", () => {
  const items = [item(), item({ id: "i2", unit_id: "200" }), item({ id: "i3", unit_id: "300", followed_networks: ["x"] })];
  assert.deepEqual(hooksFromPlan(items, [{ item_id: "i2" }]), {
    "200": { legacy: false, sibling: false, recruited: "none", interest: true },
    "300": { legacy: false, sibling: false, recruited: "none", interest: true },
  });
});
