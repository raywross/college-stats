/** Scoring a pilot run against the answer key (lib/reported-score.ts). `npm test`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePilot, summarize, type AnswerKeyEntry, type PilotCollege } from "../lib/reported-score.ts";
import type { ReportedEntry, ReviewItem } from "../lib/reported.ts";

const pilot: PilotCollege[] = [
  { unit_id: "1", name: "Found Right", tier: "very-selective", sector: "private-nonprofit" },
  { unit_id: "2", name: "Found Wrong", tier: "very-selective", sector: "private-nonprofit" },
  { unit_id: "3", name: "Missed", tier: "selective", sector: "public" },
  { unit_id: "4", name: "Quiet", tier: "open-admission", sector: "public" },
  { unit_id: "5", name: "Unexpected", tier: "open-admission", sector: "public" },
  { unit_id: "6", name: "Unchecked", tier: "selective", sector: "public" },
];
const keyEntry = (unit_id: string, extra: Partial<AnswerKeyEntry> = {}): AnswerKeyEntry => ({
  unit_id,
  entering_term: "Fall 2026",
  applicants: 46618,
  admitted: null,
  enrolled: 1414,
  acceptance_rate: 0.04,
  url: "https://example.edu/class-of-2030",
  quote: "4.0% of 46,618",
  checked: "2026-10-02",
  kind: "class-profile",
  ...extra,
});
const key: AnswerKeyEntry[] = [
  keyEntry("1"),
  keyEntry("2"),
  keyEntry("3"),
  keyEntry("4", { none_found: true, entering_term: null, applicants: null, enrolled: null, acceptance_rate: null, quote: null }),
  keyEntry("5", { none_found: true, entering_term: null, applicants: null, enrolled: null, acceptance_rate: null, quote: null }),
];
const entry = (unit_id: string, applicants: number, rate: number): ReportedEntry => ({
  unit_id,
  admissions: { entering_term: "Fall 2026", year: 2026, applicants, admitted: null, enrolled: 1414, acceptance_rate: rate, source_kind: "class-profile" },
  lineage: {},
  run: "r1",
});
const published = [entry("1", 46618, 0.04), entry("2", 40000, 0.04), entry("5", 9000, 0.9)];
const queue: ReviewItem[] = [{ unit_id: "3", name: "Missed", urls: [], entering_term: "Fall 2026", extraction: {} as ReviewItem["extraction"], failures: [], queued: "", run: "r1" }];

test("each pilot college gets the right outcome", () => {
  const byId = Object.fromEntries(scorePilot(pilot, key, published, queue).map((s) => [s.unit_id, s]));
  assert.equal(byId["1"].outcome, "correct");
  assert.equal(byId["2"].outcome, "wrong");
  assert.match(byId["2"].detail, /applicants 40000 vs 46618/);
  assert.equal(byId["3"].outcome, "missed");
  assert.equal(byId["3"].queued, true);
  assert.equal(byId["4"].outcome, "quiet");
  assert.equal(byId["5"].outcome, "unexpected");
  assert.equal(byId["6"].outcome, "unchecked");
});

test("a different published term is reported as such, and tolerances hold", () => {
  const other = { ...entry("1", 46618, 0.04), admissions: { ...entry("1", 46618, 0.04).admissions, entering_term: "Fall 2025" } };
  assert.equal(scorePilot(pilot.slice(0, 1), key, [other], [])[0].outcome, "other-term");
  // Within 0.5% on counts and 0.1 pt on rates still counts as correct.
  assert.equal(scorePilot(pilot.slice(0, 1), key, [entry("1", 46700, 0.0405)], [])[0].outcome, "correct");
  assert.equal(scorePilot(pilot.slice(0, 1), key, [entry("1", 46618, 0.045)], [])[0].outcome, "wrong");
});

test("the per-tier summary counts findable, found, correct, and unexpected", () => {
  const t = summarize(scorePilot(pilot, key, published, queue));
  assert.deepEqual(t["very-selective"], { colleges: 2, findable: 2, found: 2, correct: 1, unexpected: 0 });
  assert.deepEqual(t["selective"], { colleges: 2, findable: 1, found: 0, correct: 0, unexpected: 0 });
  assert.deepEqual(t["open-admission"], { colleges: 2, findable: 0, found: 0, correct: 0, unexpected: 1 });
});
