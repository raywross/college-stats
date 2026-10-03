/**
 * The college-reported workflow's PR body and release note generator (scripts/college-reported-pr-body.mts), against
 * fixture run-summary and review-queue files (tests/fixtures/college-reported/). `npm test`.
 * See .github/workflows/college-reported.yml and specs/college-reported-data.md#publishing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewQueueFile, RunSummary } from "../lib/reported.ts";
import { itemsForRun, prBody, releaseNote, releaseNoteSlug, totalCost } from "../scripts/college-reported-pr-body.mts";
import { parseReleaseNote } from "../lib/release-notes.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "college-reported");
const summary: RunSummary = JSON.parse(readFileSync(join(FIXTURES, "run-summary.json"), "utf8"));
const queue: ReviewQueueFile = JSON.parse(readFileSync(join(FIXTURES, "review-queue.json"), "utf8"));

test("totalCost sums every model job's cost", () => {
  assert.equal(Math.round(totalCost(summary) * 100), Math.round((0.87 + 0.14 + 0.33) * 100));
});

test("itemsForRun keeps only this run's queue items", () => {
  const items = itemsForRun(queue, summary.run);
  assert.equal(items.length, 1);
  assert.equal(items[0].unit_id, "999001");
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

test("prBody lists unreachable colleges apart from check failures, and counts guesses", () => {
  const withCounts: RunSummary = { ...summary, unreachable: 1, guessed: 3 };
  const blocked = { ...queue.items[0], unit_id: "999777", name: "Blocked State", urls: ["https://blocked.edu/cds.pdf"], failures: [{ check: "unreachable" as const, detail: "HTTP 403 at https://blocked.edu/cds.pdf" }] };
  const body = prBody(withCounts, { ...queue, items: [...queue.items, blocked] });
  assert.match(body, /Unreachable \(site blocks us or file missing; no model call\) \| 1 \|/);
  assert.match(body, /Next CDS edition guessed \(no model call\) \| 3 \|/);
  const [review, rest] = body.split("## Unreachable");
  assert.doesNotMatch(review, /Blocked State/, "not in the review-queue table");
  assert.match(rest, /Blocked State \(999777\) \| HTTP 403 at https:\/\/blocked\.edu\/cds\.pdf/);
  assert.doesNotMatch(prBody(summary, queue), /## Unreachable/, "no section when nothing was unreachable");
});

test("a run that stopped early says so, with how far it got and why, in the PR body and the release note", () => {
  const stopped: RunSummary = { ...summary, status: "stopped", stopped_reason: "the Anthropic account's spend limit or credit balance was reached", done: 31, total: 50 };
  assert.match(prBody(stopped, queue), /Stopped early\*\* after 31 of 50 colleges: the Anthropic account's spend limit/);
  assert.match(releaseNote(stopped, queue, 48, "2026-10-02"), /Stopped early after 31 of 50 colleges/);
  assert.doesNotMatch(prBody(summary, queue), /Stopped early/, "a finished run has no notice");
});
