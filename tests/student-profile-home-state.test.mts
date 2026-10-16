/**
 * A record with no state of residence reads the household's address (owner, 2026-10-16), before the estimate's own
 * fallback to the high school's state.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stateOfHome } from "../lib/home.ts";
import { emptyProfile, withHomeState } from "../lib/student-profile.ts";

test("stateOfHome reads the state from the tidied label or the place", () => {
  assert.equal(stateOfHome({ label: "155 Ash Dr, Roslyn, NY 11576", place: "Roslyn, NY" }), "NY");
  assert.equal(stateOfHome({ label: "", place: "Marietta, GA" }), "GA");
  assert.equal(stateOfHome({ label: "1 Main St, Austin, TX 78701-1234", place: "" }), "TX");
  assert.equal(stateOfHome({ label: "ZIP 11576", place: "ZIP 11576" }), null, "a ZIP-only home names no state");
  assert.equal(stateOfHome(null), null);
});

test("withHomeState fills an empty state and never overrides one the student entered", () => {
  const empty = emptyProfile();
  assert.equal(withHomeState(empty, "NY").basics.stateOfResidence, "NY");
  const entered = { ...empty, basics: { ...empty.basics, stateOfResidence: "TX" } };
  assert.equal(withHomeState(entered, "NY").basics.stateOfResidence, "TX");
  assert.equal(withHomeState(empty, null).basics.stateOfResidence, null);
});

test("the profile read applies it, so every reader of the record gets the household's state", () => {
  const src = readFileSync(new URL("../lib/student-profile-store.ts", import.meta.url), "utf8");
  assert.match(src, /withHomeState\(profileForViewer\(sanitizeProfile\(raw\), a\.relation\), homeState\)/);
});
