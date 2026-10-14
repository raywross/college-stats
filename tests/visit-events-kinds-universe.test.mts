/**
 * Event kinds (lib/visit-events/kinds.ts) on titles from the 795-host universe read on 2026-10-14
 * (scripts/visit-events-universe.mts) that the first rules, tuned on four colleges, got wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { kindOf } from "../lib/visit-events/kinds.ts";

const k = (title: string, place = "Gainesville, FL") => kindOf({ title, place, campusCity: "gainesville" });

test("plural tours are tours", () => {
  assert.equal(k("Daily Campus Tours"), "tour");
  assert.equal(k("Campus Tours"), "tour");
  assert.equal(k("Daily Campus Tours - Carrollton", "Carrollton, GA"), "tour");
});

test("course names with Materials are not staff logistics; materials pickups still are", () => {
  assert.equal(k("Earth Materials"), "other");
  assert.equal(k("AA-231: Animation 1 - Materials, Method"), "other");
  assert.equal(k("Materials Science & Engineering Session - Group A"), "info_session");
  assert.equal(k("NC DUML Materials pick up"), "staff");
  assert.equal(k("Asheville materials pickup"), "staff");
  assert.equal(k("CO (Denver) - Hotel Shipping", "Lakewood, CO"), "staff");
});

test("a school called Covenant is a rep visit; UNC's Carolina Covenant alumni event is not for applicants", () => {
  assert.equal(k("Covenant Classical School", "Charlotte, NC"), "travel");
  assert.equal(k("2026 Carolina Covenant Alumni Homecoming", "Chapel Hill, NC"), "staff");
});

test("graduate events stay out of an undergraduate calendar", () => {
  assert.equal(k("Graduate School of Education Admission Appointment"), "staff");
  assert.equal(k("Millersville University Graduate School Fair"), "staff");
});
