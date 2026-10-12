/**
 * The per-college hooks the plan sends with its estimates (lib/planner/hooks.ts): legacy and recruited from the row's
 * toggles, and demonstrated interest from a visit, an information request, or a follow on social (the capture panel,
 * owner 2026-10-12). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hooksFromPlan, showsInterest, type HooksItem } from "../lib/planner/hooks.ts";

const item = (over: Partial<HooksItem> = {}): HooksItem => ({
  id: "i1",
  unit_id: "100",
  legacy: false,
  recruited: "none",
  visited_on: null,
  info_requested_on: null,
  followed_networks: [],
  follows_social: false,
  ...over,
});

test("a college with nothing set is left out of the map", () => {
  assert.deepEqual(hooksFromPlan([item()]), {});
});

test("legacy and recruited come from the row's toggles", () => {
  assert.deepEqual(hooksFromPlan([item({ legacy: true })]), { "100": { legacy: true, recruited: "none", interest: false } });
  assert.deepEqual(hooksFromPlan([item({ recruited: "pre_read" })]), { "100": { legacy: false, recruited: "pre_read", interest: false } });
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
    "200": { legacy: false, recruited: "none", interest: true },
    "300": { legacy: false, recruited: "none", interest: true },
  });
});
