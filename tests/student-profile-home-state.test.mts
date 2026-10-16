/**
 * Residency for the estimate (owner, 2026-10-16: "Household address should be the priority but if it's not there it
 * should fall back to high school"): the state entered on the record, else the household's address, else the high
 * school's state (the model's own fallback, lib/chances/model.ts ownerReading).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stateOfHome } from "../lib/home.ts";
import { estimateInputFromProfile } from "../lib/chances/estimate-input.ts";
import { emptyProfile, residencyState, sanitizeProfile, withHomeState } from "../lib/student-profile.ts";

test("stateOfHome reads the state from the tidied label or the place", () => {
  assert.equal(stateOfHome({ label: "155 Ash Dr, Roslyn, NY 11576", place: "Roslyn, NY" }), "NY");
  assert.equal(stateOfHome({ label: "", place: "Marietta, GA" }), "GA");
  assert.equal(stateOfHome({ label: "1 Main St, Austin, TX 78701-1234", place: "" }), "TX");
  assert.equal(stateOfHome({ label: "ZIP 11576", place: "ZIP 11576" }), null, "a ZIP-only home names no state");
  assert.equal(stateOfHome(null), null);
});

test("residency order: the record's entered state, then the household's address, then nothing (the model's high-school fallback)", () => {
  const empty = emptyProfile();
  const entered = { ...empty, basics: { ...empty.basics, stateOfResidence: "TX" } };
  assert.deepEqual(residencyState(withHomeState(entered, "NY")), { state: "TX", source: "record" }, "an entered state wins");
  assert.deepEqual(residencyState(withHomeState(empty, "NY")), { state: "NY", source: "home" }, "else the household's address");
  assert.deepEqual(residencyState(withHomeState(empty, null)), { state: null, source: null }, "else the model falls back to the high school");
});

test("the estimate's input carries that state; with neither, it's null so the model uses the high school's", () => {
  const empty = emptyProfile();
  assert.equal(estimateInputFromProfile(withHomeState(empty, "NY"), "228778", null).student.state, "NY");
  assert.equal(estimateInputFromProfile(withHomeState(empty, null), "228778", null).student.state, null);
  const model = readFileSync(new URL("../lib/chances/model.ts", import.meta.url), "utf8");
  assert.match(model, /const stateFromSchool = !s\.state && school \? school : null;/, "the model's high-school fallback is still there");
});

test("the household's state is never stored: the record's own field stays empty and a save drops it", () => {
  const read = withHomeState(emptyProfile(), "NY");
  assert.equal(read.basics.stateOfResidence, null);
  assert.ok(!("homeState" in sanitizeProfile(read)), "sanitizeProfile drops the read-only field");
});

test("every profile reader attaches it: the store, the estimate snapshot, and the admin standing view", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(read("lib/student-profile-store.ts"), /withHomeState\(profileForViewer\(sanitizeProfile\(raw\), a\.relation\), homeState\)/);
  assert.match(read("lib/chances/snapshot-write.ts"), /withHomeState\(sanitizeProfile\(raw\), await homeStateForStudent\(supabase, studentId\)\)/);
  assert.match(read("lib/admin/standing.ts"), /withHomeState\(sanitizeProfile\(.*\), await homeStateForStudent\(supabase, studentId\)\)/);
});
