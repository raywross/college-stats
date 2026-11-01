/**
 * Event kinds (lib/visit-events/kinds.ts; specs/product/visit-events.md "Model") on every title the 2026-10-13 desktop
 * harvest read from UF, Duke, UNC, and UT Austin (tests/fixtures/visit-events/harvest-uf-duke-unc-ut.json; the
 * harvest calls staff rows "noise"), plus the harvest script's title patterns as single cases, the away-from-campus
 * rule, and the planner's visit-log kind.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAwayFromCampus, kindOf, planVisitKind, staffReason } from "../lib/visit-events/kinds.ts";
import type { VisitEventKind } from "../lib/visit-events/types.ts";

interface Harvest {
  colleges: Record<string, { unit_id: string; home: string; events: { title: string; place: string; online: boolean; kind: string }[] }>;
}
const harvest = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "visit-events", "harvest-uf-duke-unc-ut.json"), "utf8")) as Harvest;
const campusCity = (home: string) => home.split(",")[0].toLowerCase();

for (const [key, college] of Object.entries(harvest.colleges)) {
  test(`kindOf: every ${key.toUpperCase()} title is tagged as the harvest tagged it`, () => {
    const wrong: string[] = [];
    for (const e of college.events) {
      const want = e.kind === "noise" ? "staff" : e.kind;
      const got = kindOf({ title: e.title, online: e.online, place: e.place, campusCity: campusCity(college.home) });
      if (got !== want) wrong.push(`${e.title} @ ${e.place}: ${got}, harvest ${want}`);
    }
    assert.deepEqual(wrong, []);
  });
}

test("kindOf: the harvest's counts per college (UF 528, Duke 131, UNC 819, UT 554)", () => {
  const counts = (key: string) => {
    const c: Record<string, number> = {};
    const college = harvest.colleges[key];
    for (const e of college.events) {
      const k = kindOf({ title: e.title, online: e.online, place: e.place, campusCity: campusCity(college.home) });
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  };
  assert.deepEqual(counts("uf"), { travel: 340, online: 9, info_session: 40, tour: 132, open_house: 3, staff: 4 });
  assert.deepEqual(counts("duke"), { staff: 40, tour: 75, travel: 15, online: 1 });
  assert.equal(harvest.colleges.unc.events.length, 819);
  assert.equal(counts("unc").staff, 12);
  assert.equal(counts("ut").staff, 1);
});

test("kindOf: the harvest script's staff patterns, one case each", () => {
  const staff = [
    "CO (Denver) - Hotel Shipping",
    "NC DUML Materials pick up",
    "Materials Pickup",
    "Requested Group / Filled",
    "No Activity",
    "Request a Group Tour Appointment",
    "Travel Shipment - Atlanta",
    "Placeholder",
    "Test event",
    "DO NOT USE - old session",
    "Hold - Charlotte",
  ];
  for (const t of staff) assert.equal(kindOf({ title: t }), "staff", t);
});

test("kindOf: online, open house, tour before travel, travel, session, other, and away-from-campus travel", () => {
  const cases: [Parameters<typeof kindOf>[0], VisitEventKind][] = [
    [{ title: "Prospective Information Session", online: true }, "online"],
    [{ title: "Campus Tour (Virtual)" }, "online"],
    [{ title: "Info Session", place: "Online" }, "online"],
    [{ title: "Open House - October 12, 2026" }, "open_house"],
    [{ title: "Admitted Student Day" }, "open_house"],
    [{ title: "Pratt School of Engineering Campus Tour" }, "tour"],
    [{ title: "Campus Tour" }, "tour"],
    [{ title: "High School Tour Night" }, "travel"],
    [{ title: "Marietta High School" }, "travel"],
    [{ title: "Seattle National College Fair (2 of 2)" }, "travel"],
    [{ title: "Seattle NACAC" }, "travel"],
    [{ title: "Discover Duke - Denver" }, "travel"],
    [{ title: "Admissions Drop-In" }, "info_session"],
    [{ title: "Campus Visit" }, "info_session"],
    [{ title: "Homewood-Flossmoor", place: "Flossmoor, IL", campusCity: "gainesville" }, "travel"],
    [{ title: "Homewood-Flossmoor", place: "Gainesville, FL", campusCity: "gainesville" }, "other"],
  ];
  for (const [input, want] of cases) assert.equal(kindOf(input), want, input.title);
});

test("staffReason: logistics, non-admissions, or null; every staff title has a reason", () => {
  assert.equal(staffReason("CO (Denver) - Hotel Shipping"), "logistics");
  assert.equal(staffReason("Requested Group / Filled"), "logistics");
  assert.equal(staffReason("Visit Materials Pick-Up"), "logistics");
  assert.equal(staffReason("Graduate Admissions Virtual Office Hours"), "not_admissions");
  assert.equal(staffReason("Clarkson Graduate Programs: Partner Drop-In Hours"), "not_admissions");
  assert.equal(staffReason("Alumni Council Meeting"), "not_admissions");
  assert.equal(staffReason("Campus Tour"), null);
  assert.equal(staffReason("Covenant Classical School"), null);
  // A title that is both is logistics first (the failure rule's side), as kindOf checks STAFF first.
  assert.equal(staffReason("Graduate School Fair Materials Pick-Up"), "logistics");
  for (const title of ["Hotel Shipping", "Graduate Student Welcome", "Reunion Weekend", "placeholder", "Homecoming Tailgate"]) {
    assert.equal(kindOf({ title }), "staff", title);
    assert.notEqual(staffReason(title), null, title);
  }
});

test("isAwayFromCampus and planVisitKind", () => {
  assert.equal(isAwayFromCampus("travel", "Gainesville, FL", "gainesville"), true);
  assert.equal(isAwayFromCampus("online", "Online", "gainesville"), false);
  assert.equal(isAwayFromCampus("tour", "Gainesville, FL", "Gainesville"), false);
  assert.equal(isAwayFromCampus("other", "Ocala, FL", "gainesville"), true);
  assert.equal(isAwayFromCampus("tour", null, "gainesville"), false);
  assert.equal(planVisitKind("tour"), "campus_tour");
  assert.equal(planVisitKind("travel"), "fair");
  assert.equal(planVisitKind("online"), "virtual");
  assert.equal(planVisitKind("info_session"), "info_session");
  assert.equal(planVisitKind("open_house"), "open_house");
  assert.equal(planVisitKind("staff"), "other");
});
