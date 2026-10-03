/**
 * The college-reported workflow's PR body and release note generator (scripts/college-reported-pr-body.mts), against
 * fixture run-summary and review-queue files (tests/fixtures/college-reported/). `npm test`.
 * See .github/workflows/college-reported.yml and specs/college-reported-data.md#publishing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportedFile, ReviewQueueFile, RunSummary } from "../lib/reported.ts";
import { entriesForRun, itemsForRun, prBody, releaseNote, releaseNoteSlug, totalCost } from "../scripts/college-reported-pr-body.mts";
import { parseReleaseNote } from "../lib/release-notes.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "college-reported");
const summary: RunSummary = JSON.parse(readFileSync(join(FIXTURES, "run-summary.json"), "utf8"));
const queue: ReviewQueueFile = JSON.parse(readFileSync(join(FIXTURES, "review-queue.json"), "utf8"));
const reported: ReportedFile = JSON.parse(readFileSync(join(FIXTURES, "reported.json"), "utf8"));
const names = new Map([
  ["999010", "Fixture Newly Published University"],
  ["999011", "Fixture Older Published College"],
]);

test("totalCost sums every model job's cost", () => {
  assert.equal(Math.round(totalCost(summary) * 100), Math.round((0.87 + 0.14 + 0.33) * 100));
});

test("itemsForRun keeps only this run's queue items", () => {
  const items = itemsForRun(queue, summary.run);
  assert.equal(items.length, 2); // a check failure (999001) and an unreachable site (999003)
  assert.ok(items.some((i) => i.unit_id === "999001"));
  assert.ok(items.some((i) => i.unit_id === "999003"));
  // The fixture also has an older item from a previous run, to prove it's excluded.
  assert.ok(queue.items.some((i) => i.run !== summary.run));
});

test("prBody includes the counts, cost, circuit-breaker status, and this run's review-queue table", () => {
  const body = prBody(summary, queue);
  assert.match(body, /Colleges attempted \| 50/);
  assert.match(body, /\$1\.34/); // 0.87 + 0.14 + 0.33
  assert.match(body, /Not tripped/);
  assert.match(body, /Fixture State University/);
  assert.match(body, /cohort-and-scope/);
  // The other run's item must not appear.
  assert.doesNotMatch(body, /Older Fixture College/);
  assert.match(body, /npm run sync-college-reported -- --college/);
});

test("prBody reports a tripped circuit breaker instead of 'Not tripped'", () => {
  const tripped: RunSummary = { ...summary, tripped: "failure share 14% > 10%" };
  const body = prBody(tripped, queue);
  assert.match(body, /Tripped:\*\* failure share 14% > 10%/);
  assert.doesNotMatch(body, /Not tripped/);
});

test("prBody says so when nothing is in the review queue", () => {
  const empty: ReviewQueueFile = { updated: queue.updated, items: [] };
  const body = prBody(summary, empty);
  assert.match(body, /Nothing from this run needs a person/);
});

test("releaseNote parses as a valid note (specs/release-notes.md)", () => {
  const text = releaseNote(summary, queue, 48, "2026-10-02");
  const slug = releaseNoteSlug(summary.run);
  const note = parseReleaseNote(`release-notes/${slug}.md`, text);
  assert.equal(note.pr, 48);
  assert.equal(note.date, "2026-10-02");
  assert.equal(note.kind, "data");
  assert.ok(note.summary.length > 0);
  assert.doesNotMatch(text, /^#\s/m);
});

test("releaseNote mentions the review queue when this run has items", () => {
  const text = releaseNote(summary, queue, 48, "2026-10-02");
  assert.match(text, /waiting for a person/);
});

test("entriesForRun keeps only this run's published entries", () => {
  const entries = entriesForRun(reported, summary.run);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].unit_id, "999010");
  assert.ok(reported.entries.some((e) => e.run !== summary.run));
});

test("prBody adds a 'Published this run' table when given the reported file, with the college's name when given names", () => {
  const body = prBody(summary, queue, reported, names);
  assert.match(body, /## Published this run/);
  assert.match(body, /Fixture Newly Published University/);
  assert.match(body, /class-profile/);
  assert.match(body, /46,618/);
  assert.match(body, /4\.0%/);
  assert.match(body, /https:\/\/fixture\.edu\/class-of-2030/);
  // The other run's entry must not appear.
  assert.doesNotMatch(body, /Fixture Older Published College/);
});

test("prBody falls back to the unit id when no names are given, and omits the section when reported is omitted", () => {
  const withoutNames = prBody(summary, queue, reported);
  assert.match(withoutNames, /999010/);
  const withoutReported = prBody(summary, queue);
  assert.doesNotMatch(withoutReported, /## Published this run/);
});

test("prBody lists an unreachable item separately from the check-failure review queue", () => {
  const body = prBody(summary, queue);
  assert.match(body, /## Unreachable/);
  assert.match(body, /Fixture Blocked College/);
  assert.match(body, /403/);
  // It must not also appear in the ordinary review-queue table's check-failure list.
  const reviewSection = body.slice(body.indexOf("## Review queue"));
  assert.doesNotMatch(reviewSection, /Fixture Blocked College/);
  // The other failing item (a real check failure) still appears in the review-queue table.
  assert.match(reviewSection, /Fixture State University/);
  assert.match(reviewSection, /cohort-and-scope/);
});

test("prBody shows the guessed-URL and unreachable rows only when the summary has them", () => {
  assert.doesNotMatch(prBody(summary, queue), /guessed/i);
  const withCounts: RunSummary = { ...summary, guessed: 7, unreachable: 2 };
  assert.match(prBody(withCounts, queue), /Next-edition URL guessed.*\| 7 \|/);
  assert.match(prBody(withCounts, queue), /Unreachable \(site blocks us or file missing; no model call\) \| 2 \|/);
});

test("a run that stopped early says so, with how far it got and why, in the PR body and the release note", () => {
  const stopped: RunSummary = { ...summary, status: "stopped", stopped_reason: "the Anthropic account's spend limit or credit balance was reached", done: 31, total: 50 };
  assert.match(prBody(stopped, queue), /Stopped early\*\* after 31 of 50 colleges: the Anthropic account's spend limit/);
  assert.match(releaseNote(stopped, queue, 48, "2026-10-02"), /Stopped early after 31 of 50 colleges/);
  assert.doesNotMatch(prBody(summary, queue), /Stopped early/, "a finished run has no notice");
});
