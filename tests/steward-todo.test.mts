/**
 * The To do rows from the engines' records (lib/steward/todo-sources.ts; specs/product/data-steward.md "Documents a
 * person has to fetch"), on the real `reported.failures` sample in tests/fixtures/steward/failures-sample.json plus
 * planted queue items and blocked directories: only what a person can act on becomes a row, `why` follows the reason
 * and its words, rows are one per key and start open, and stored rows win over generated ones. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckId, ReviewItem } from "../lib/reported.ts";
import { ACQUISITION_REASONS, compareTodo, hostOf, mergeTodo, slug, todoKey, todoRows, whyFromWords, whyOfFailure, type BlockedDirectoryLike, type FailureRowLike } from "../lib/steward/todo-sources.ts";
import type { TodoDoc } from "../lib/steward/types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "steward");
const FAILURES = Object.values(JSON.parse(readFileSync(join(FIXTURES, "failures-sample.json"), "utf8")) as Record<string, FailureRowLike[]>).flat();
const QUEUE = Object.values(JSON.parse(readFileSync(join(FIXTURES, "review-queue-sample.json"), "utf8")) as Record<string, ReviewItem>);

const queueItem = (unit: string, check: string, detail: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({
  unit_id: unit,
  name: `College ${unit}`,
  urls: [`https://ir.example${unit}.edu/cds-2025-26.pdf`],
  entering_term: null,
  failures: [{ check: check as CheckId, detail }],
  queued: "2026-10-20",
  run: "r1",
  ...extra,
});

test("the failures sample: only discovery and fetch reasons a person can act on become rows, each open with reach 1 and demand 0", () => {
  const rows = todoRows({ failures: FAILURES, queueItems: [], blockedDirectories: [] });
  const acting = FAILURES.filter((f) => ACQUISITION_REASONS.has(f.reason_code));
  assert.ok(acting.length > 20 && acting.length < FAILURES.length, "the sample has both kinds");
  assert.equal(rows.length, new Set(acting.map((f) => todoKey("cds", { unit_id: f.unit_id, name: f.name }, f.edition))).size);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, "one row per key");
  for (const r of rows) {
    assert.deepEqual([r.status, r.reach, r.demand, r.kind, r.document_url], ["open", 1, 0, "cds", null]);
    assert.match(r.key, /^cds:\d+:(-|\d{4}-\d{2})$/);
    assert.ok(r.attempts.length >= 1);
    assert.equal(r.updated, r.attempts.map((a) => a.at).sort().at(-1));
  }
  // Read and check failures (failed_checks, never_read, edition_unknown, …) are the pipeline's, not To do rows.
  const checksOnly = FAILURES.filter((f) => f.reason_code === "failed_checks").map((f) => f.unit_id);
  for (const unit of checksOnly) if (!acting.some((f) => f.unit_id === unit)) assert.ok(!rows.some((r) => r.unit_id === unit), unit);
  // The order: reach, then demand, then subject.
  assert.deepEqual(rows, [...rows].sort(compareTodo));
});

test("why: mapped from the reason and its words", () => {
  const rows = todoRows({ failures: FAILURES, queueItems: [], blockedDirectories: [] });
  const byUnit = (unit: string) => rows.find((r) => r.unit_id === unit)!;
  const challenge = FAILURES.find((f) => f.reason_code === "host_blocked" && /bot challenge/.test(f.detail))!;
  assert.equal(byUnit(challenge.unit_id).why, "challenge");
  assert.equal(byUnit(challenge.unit_id).host, challenge.url ? hostOf(challenge.url) : /refused by (\S+)/.exec(challenge.detail)![1]);
  const forbidden = FAILURES.find((f) => f.reason_code === "host_blocked" && /HTTP 403/.test(f.detail))!;
  assert.equal(whyOfFailure(forbidden), "bot-check");
  const notFound = FAILURES.find((f) => f.reason_code === "no_document_found")!;
  assert.equal(whyOfFailure(notFound), "not-found");
  const gone = FAILURES.find((f) => f.reason_code === "unreachable")!;
  assert.equal(whyOfFailure(gone), "not-found");
  assert.equal(whyOfFailure({ reason_code: "robots_disallowed", detail: "robots.txt disallows the document", url: null }), "robots-path");
  assert.equal(whyOfFailure({ reason_code: "class_profile_only", detail: "only class profile(s) found (1), no Common Data Set", url: null }), "no-document");
  assert.equal(whyFromWords("Sign in to SharePoint to view"), "login");
  assert.equal(whyFromWords("https://drive.google.com/file/d/x/view"), "viewer");
  assert.equal(whyFromWords("the site's terms of use forbid automated access"), "terms");
  assert.equal(whyFromWords("something odd"), "unknown");
});

test("the queue's unreachable and not-a-url items are rows; other checks and resolved items aren't", () => {
  const rows = todoRows({
    failures: [],
    queueItems: [
      queueItem("1", "unreachable", "HTTP 404 https://ir.example1.edu/cds-2025-26.pdf", { edition: "2025-26" }),
      queueItem("2", "not-a-url", 'G.001 "89*--31" isn\'t a URL', { code: "G.001", edition: "2025-26" }),
      queueItem("3", "unreachable", "HTTP 403", { resolved: "rejected" }),
      ...QUEUE.slice(0, 50),
    ],
    blockedDirectories: [],
  });
  assert.deepEqual(rows.map((r) => [r.key, r.kind, r.why]), [
    ["cds:1:2025-26", "cds", "not-found"],
    ["other:2:2025-26", "other", "unknown"],
  ]);
  assert.equal(rows[0].host, "ir.example1.edu");
  assert.equal(rows[0].attempts[0].route, "queue");
  assert.match(rows[0].attempts[0].result, /1\|2025-26\|/);
});

test("blocked directories are campus-page rows keyed by the organization's slug; a terms or login block is 'ask'", () => {
  const blocked: BlockedDirectoryLike[] = [
    { org: "Gamma Rho Lambda", url: "https://grl.org/chapters", reason: "challenge", first_seen: "2026-09-01", last_seen: "2026-10-01" },
    { org: "Gamma Rho Lambda", url: "https://grl.org/chapters?page=2", reason: "terms", detail: "terms forbid crawling", first_seen: "2026-09-01", last_seen: "2026-10-02" },
    { org: "Hillel International", url: "https://hillel.org/colleges", reason: "robots", first_seen: "2026-09-01", last_seen: "2026-09-15" },
  ];
  const rows = todoRows({ failures: [], queueItems: [], blockedDirectories: blocked });
  assert.deepEqual(rows.map((r) => r.key), ["campus-page:gamma-rho-lambda:-", "campus-page:hillel-international:-"]);
  const grl = rows[0];
  assert.deepEqual([grl.why, grl.route, grl.unit_id, grl.landing, grl.host, grl.updated, grl.attempts.length], ["terms", "ask", null, "https://grl.org/chapters", "grl.org", "2026-10-02", 2]);
  assert.equal(rows[1].why, "robots-path");
  assert.equal(slug("Café Société!"), "cafe-societe");
});

test("two sources for one key are one row: the more specific why, every attempt oldest first", () => {
  const f = (reason_code: string, detail: string, last_run: string): FailureRowLike => ({ unit_id: "9", name: "Nine College", reason_code, stage: "fetch", detail, url: "https://nine.edu/cds.pdf", edition: null, last_run });
  const rows = todoRows({ failures: [f("no_document_found", "nothing found", "2026-10-11"), f("host_blocked", "refused by nine.edu (bot challenge)", "2026-10-01")], queueItems: [], blockedDirectories: [] });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].why, rows[0].attempts.map((a) => a.at), rows[0].updated], ["challenge", ["2026-10-01", "2026-10-11"], "2026-10-11"]);
});

test("mergeTodo: a stored row wins over the generated one with its key; demand fills colleges; the order is reach, then demand", () => {
  const generated = todoRows({ failures: FAILURES, queueItems: [], blockedDirectories: [] });
  const first = generated[0];
  const stored: TodoDoc = { ...first, status: "found", document_url: "https://found.example/cds.pdf", attempts: [], note: "found it in a browser", updated: "2026-11-01" };
  const extra: TodoDoc = { ...first, key: "hs-profile:sc-123:-", kind: "hs-profile", unit_id: null, subject: "A High School", reach: 3, attempts: [] };
  const other = generated[1];
  const rows = mergeTodo(generated, [stored, extra], new Map([[other.unit_id!, 4]]));
  assert.equal(rows.length, generated.length + 1);
  assert.equal(rows[0].key, extra.key, "highest reach first");
  assert.equal(rows[1].key, other.key, "then demand");
  const merged = rows.find((r) => r.key === first.key)!;
  assert.deepEqual([merged.status, merged.document_url, merged.note], ["found", "https://found.example/cds.pdf", "found it in a browser"]);
  assert.deepEqual(merged.attempts, first.attempts, "a stored row without attempts keeps the generated ones");
});
