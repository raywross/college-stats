/**
 * lib/admin/record-words.ts (specs/product/admin-redesign.md "People": "Plain fields"): a student's numbers, offers,
 * snapshots, and notification preferences read with the site's own labels instead of a raw KeyValues dump, with
 * unknown keys left for Details. Pure module, no fakes needed. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationPrefs, offers, snapshot, studentNumbers } from "../lib/admin/record-words.ts";

test("studentNumbers: known fields get the site's own labels, in plain words", () => {
  const { fields, details } = studentNumbers({
    basics: { gradYear: 2027, stateOfResidence: "TN", highSchool: "Lincoln High", feeWaiverEligible: true },
    academics: { gpa: 3.8, gpaScale: "4.0", classStanding: "top10", activities: [1, 2], awards: [1], firstGeneration: false },
    tests: { satTotal: 1420, focus: "sat", plansTestOptional: false },
    plans: { intendedMajors: ["11"], earlyRoundInterest: "ed" },
    preferences: { sizes: ["small"], maxAverageCost: 30000 },
  });
  const byLabel = new Map(fields.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Graduation year"), "2027");
  assert.equal(byLabel.get("State of residence"), "TN");
  assert.equal(byLabel.get("High school"), "Lincoln High");
  assert.equal(byLabel.get("Fee-waiver eligible"), "Yes");
  assert.equal(byLabel.get("GPA"), "3.8 (4.0 scale)");
  assert.equal(byLabel.get("Class standing"), "Top 10%");
  assert.equal(byLabel.get("Activities"), "2");
  assert.equal(byLabel.get("Awards"), "1");
  assert.equal(byLabel.get("First generation"), "No");
  assert.equal(byLabel.get("SAT total"), "1420");
  assert.equal(byLabel.get("Test focus"), "SAT");
  assert.equal(byLabel.get("Intended majors"), "Computer science");
  assert.equal(byLabel.get("Early round interest"), "Early Decision");
  assert.equal(byLabel.get("Preferred sizes"), "Small (under 5K)");
  assert.equal(byLabel.get("Most they'll pay a year"), "$30,000");
  // Nothing from these groups is an unknown key, so they don't carry over into Details.
  assert.equal(details.basics, undefined);
});

test("studentNumbers: OUTSIDE_US reads as words, and 'Outside the U.S.' never shows a raw code", () => {
  const { fields } = studentNumbers({ basics: { stateOfResidence: "OUTSIDE_US" } });
  assert.equal(fields.find((f) => f.label === "State of residence")?.value, "Outside the U.S.");
});

test("studentNumbers: a key this formatter doesn't know falls back under details", () => {
  const { details } = studentNumbers({ basics: { highSchoolId: "100000100001" }, somethingNew: { a: 1 } });
  assert.deepEqual(details.somethingNew, { a: 1 });
  assert.deepEqual(details.basics, { highSchoolId: "100000100001" });
});

test("studentNumbers: a written story reads 'Written', never the text itself", () => {
  const written = studentNumbers({ story: { narrative: "", updatedAt: "2026-10-01", written: true } });
  assert.equal(written.fields.find((f) => f.label === "Your story")?.value, "Written");
  const notWritten = studentNumbers({ story: { narrative: "", updatedAt: null, written: false } });
  assert.equal(notWritten.fields.find((f) => f.label === "Your story")?.value, "Not written yet");
});

test("offers: the COA parts, gifts, loans, and work-study read with offers.md's own labels and usd()", () => {
  const { fields, details } = offers({
    award_year: 2027,
    letter_date: "2027-01-15",
    source: "upload",
    coa: { tuition_fees: 40000, housing_food: 12000, total: 55000 },
    gift: [{ kind: "federal", name: "Pell Grant", amount: 5000, renewable: true }],
    work_study: 2000,
    loans: [{ kind: "direct_sub", amount: 3500 }],
    confirmed_at: null,
    created_at: "2027-01-20T00:00:00Z",
  });
  const byLabel = new Map(fields.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Award year"), "2027–28");
  assert.equal(byLabel.get("Letter date"), "Jan 15, 2027");
  assert.equal(byLabel.get("Source"), "Uploaded letter");
  assert.equal(byLabel.get("Tuition and fees"), "$40,000");
  assert.equal(byLabel.get("Total cost of attendance"), "$55,000");
  assert.equal(byLabel.get("Work-study"), "$2,000");
  assert.equal(byLabel.get("Gift 1: Pell Grant"), "$5,000 (Federal grants (Pell, SEOG)), renews");
  assert.equal(byLabel.get("Loan 1"), "$3,500 (Federal Direct Subsidized)");
  assert.equal(byLabel.get("Confirmed"), "Not confirmed (notes only)");
  assert.deepEqual(details, {});
});

test("snapshot: the estimate's group and label read with lib/chances/levels.ts's own words, never the raw keys", () => {
  const { fields, details } = snapshot({
    applied_on: "2027-11-01",
    round: "ed",
    gpa: 3.9,
    gpa_scale: "4.0",
    test_kind: "sat",
    test_score: 1480,
    state: "TN",
    majors: ["11"],
    estimate_group: "target",
    estimate_label: "reach-for-everyone",
    note_keys: ["some_internal_key"],
    model_version: "v3.2",
  });
  const byLabel = new Map(fields.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Round"), "Early Decision");
  assert.equal(byLabel.get("SAT"), "1480");
  assert.equal(byLabel.get("Majors"), "Computer science");
  assert.equal(byLabel.get("Estimate shown"), "Target");
  assert.equal(byLabel.get("Estimate label"), "A reach for everyone");
  // Internal keys never get a word; they fall back to Details rather than showing on screen.
  assert.deepEqual(details.note_keys, ["some_internal_key"]);
  assert.equal(details.model_version, "v3.2");
});

test("notificationPrefs: each switch reads by the name a person sets it under, not its column name", () => {
  const { fields, details } = notificationPrefs({ email_updates: true, your_week: false, parent_summary: true, nudge_emails: true, updated: "2026-10-01T00:00:00Z" });
  const byLabel = new Map(fields.map((f) => [f.label, f.value]));
  assert.equal(byLabel.get("Update emails"), "On");
  assert.equal(byLabel.get("Your week"), "Off");
  assert.equal(byLabel.get("Weekly summary (parent)"), "On");
  assert.equal(byLabel.get("Nudge emails"), "On");
  assert.deepEqual(details, {});
});

test("notificationPrefs: an unknown column stays under details, never shown as a raw key on screen", () => {
  const { fields, details } = notificationPrefs({ email_updates: true, some_future_switch: true });
  assert.equal(fields.some((f) => f.label === "some_future_switch"), false);
  assert.deepEqual(details, { some_future_switch: true });
});
