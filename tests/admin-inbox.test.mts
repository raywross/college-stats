/**
 * The Steward's Inbox (specs/product/admin-redesign.md "The home: Steward › Inbox"; lib/admin/inbox.ts): Needs you over
 * fixtures (a decision, a failed job, a deletion inside the 30 days, a held change, a waiting invitation, nothing at
 * all), its order (consequence, then age), the six tiles, and the empty line. Pure: no database, no network. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INBOX_TODO_LIMIT,
  STEWARD_WEEKLY_CAP_USD,
  decisionAnchor,
  lastRunsByMode,
  needsYou,
  nothingNeedsYou,
  runWrote,
  tiles,
  weeklySpend,
  type InboxInput,
} from "../lib/admin/inbox.ts";
import { isHelpKey } from "../lib/admin/help.ts";
import type { DecisionDoc, ProposalDoc, RunDoc, TodoDoc } from "../lib/steward/types.ts";

const ROOT = join(import.meta.dirname, "..");
const NOW = new Date("2026-11-08T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const empty = (over: Partial<InboxInput> = {}): InboxInput => ({
  now: NOW,
  decisions: [],
  proposals: [],
  todo: [],
  jobs: [],
  deletions: [],
  invitations: [],
  heldChanges: [],
  runs: [],
  counts: { people: 120, households: 40, organizations: 3 },
  lastPublished: { id: 41, created_at: daysAgo(1), colleges: 1903 },
  queue: { open: 14568, newThisWeek: 212 },
  health: { fresh: 1500, watch: 200, stale: 150, failing: 53 },
  ...over,
});

const decision = (over: Partial<DecisionDoc> = {}): DecisionDoc => ({
  key: "policy:aid-year",
  question: "Which aid year should the grids show?",
  recommends: "The newest year a college reports",
  options: [{ answer: "Newest", effect: "Shows the newest" }],
  answer: null,
  note: null,
  decided_by: null,
  decided_at: null,
  run: "r1",
  created: daysAgo(3),
  ...over,
});

const proposal = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({
  key: "value:cornell",
  kind: "correct",
  cause: null,
  status: "open",
  summary: "Correct Cornell's applicants",
  evidence: [],
  rows: [{} as ProposalDoc["rows"][number], {} as ProposalDoc["rows"][number]],
  run: "r1",
  created: daysAgo(2),
  ...over,
});

const todo = (i: number, over: Partial<TodoDoc> = {}): TodoDoc => ({
  key: `cds:${100000 + i}:2025-26`,
  kind: "cds",
  unit_id: String(100000 + i),
  subject: `College ${i}`,
  edition: "2025-26",
  landing: null,
  document_url: null,
  host: null,
  why: "challenge",
  reach: 10 - i,
  demand: 0,
  status: "open",
  route: null,
  attempts: [],
  note: null,
  updated: daysAgo(i),
  ...over,
});

const run = (over: Partial<RunDoc> = {}): RunDoc => ({
  key: "run-1",
  mode: "run",
  started: daysAgo(1),
  finished: daysAgo(1),
  budget_usd: 5,
  spent_usd: 2.5,
  clusters: 10,
  issues: 3,
  proposals: 2,
  todo: 0,
  decisions: 0,
  audits: 0,
  stopped: null,
  request_id: null,
  ...over,
});

test("nothing waiting: Needs you is empty, and the line says when the Steward last looked", () => {
  assert.deepEqual(needsYou(empty()), []);
  assert.match(nothingNeedsYou([run({ finished: "2026-11-07T14:00:00Z" })]), /^Nothing needs you\. The Steward last looked at Nov 7, 2026, 9:00 AM\.$/);
  assert.equal(nothingNeedsYou([]), "Nothing needs you. The Steward last looked at nothing yet.");
  assert.equal(nothingNeedsYou(null), "Nothing needs you. The Steward last looked at nothing yet.");
});

test("a decision waiting is listed with the Steward's recommendation and opens on the Decisions page; an answered one is not", () => {
  const items = needsYou(empty({ decisions: [decision(), decision({ key: "policy:done", answer: "Newest" })] }));
  assert.equal(items.length, 1);
  assert.deepEqual(
    { kind: items[0].kind, action: items[0].action, href: items[0].href, severity: items[0].severity },
    { kind: "decision", action: "Decide", href: `/admin/steward/decisions#${decisionAnchor("policy:aid-year")}`, severity: 2 },
  );
  assert.match(items[0].why, /^The Steward recommends: The newest year/);
  assert.equal(items[0].raw, undefined, "nothing to put in words: no raw copy");
  const coded = needsYou(empty({ decisions: [decision({ question: "Hold every C7 grid until loan_no_pell is fixed?", recommends: "Hold B4–B5" })] }))[0];
  assert.equal(coded.title, "Hold every C7 (admission factors) grid until “loan no pell” is fixed?");
  assert.equal(coded.why, "The Steward recommends: Hold B4–B5 (graduation rates; graduation rates, Pell recipients)");
  assert.equal(coded.raw, "Hold every C7 grid until loan_no_pell is fixed? — The Steward recommends: Hold B4–B5");
  assert.equal(decisionAnchor("policy:aid-year"), "decision-policy-aid-year");
  assert.match(read("app/admin/steward/decisions/page.tsx"), /id=\{decisionAnchor\(d\.key\)\}/, "the Decisions page carries the anchor");
});

test("a failed job comes first; a job that ran fine or never ran is not listed", () => {
  const items = needsYou(
    empty({
      decisions: [decision()],
      jobs: [
        { id: "digests", name: "Update digest", outcome: "failed", at: daysAgo(0.5), note: "Reading publishes failed: timeout" },
        { id: "weekly", name: "Weekly emails and texts", outcome: "ok", at: daysAgo(1) },
        { id: "coalition", name: "Coalition", outcome: "none", at: null },
      ],
    }),
  );
  assert.deepEqual(
    items.map((i) => i.kind),
    ["job", "decision"],
  );
  assert.equal(items[0].title, "Update digest: the last run failed");
  assert.equal(items[0].why, "Reading publishes failed: timeout", "the run's own error, when it has one");
  assert.equal(items[0].href, "/admin/steward/jobs/digests");
  assert.equal(items[0].severity, 1);
});

test("a flagged job (the Steward's review) is listed after the failures", () => {
  const items = needsYou(empty({ jobs: [{ id: "identity-refresh", name: "Identity refresh", outcome: "flagged", at: daysAgo(1) }, { id: "digests", name: "Update digest", outcome: "failed", at: daysAgo(2) }] }));
  assert.deepEqual(
    items.map((i) => [i.title, i.severity]),
    [
      ["Update digest: the last run failed", 1],
      ["Identity refresh: the Steward flagged the last run", 2],
    ],
  );
});

test("an account being deleted inside the 30 days is listed with its date; one past its purge date is not", () => {
  const items = needsYou(
    empty({
      deletions: [
        { id: "u1", name: "Jordan Rivera", deletedAt: daysAgo(25) },
        { id: "u2", name: null, deletedAt: daysAgo(31) },
      ],
    }),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "deletion");
  assert.equal(items[0].title, "Jordan Rivera is being deleted");
  assert.match(items[0].why, /^Deleting in 5 days, on Nov 13, 2026\./);
  assert.equal(items[0].href, "/admin/people/u1");
});

test("a held change stops every publish, so it leads; it opens the change", () => {
  const items = needsYou(empty({ decisions: [decision()], heldChanges: [{ id: 7, kind: "pipeline", source: "college-reported", held_reason: "The breaker tripped: 412 values changed.", created_at: daysAgo(1) }] }));
  assert.equal(items[0].kind, "held-change");
  assert.equal(items[0].title, "Change #7 is held");
  assert.equal(items[0].why, "The breaker tripped: 412 values changed. A held change stops every publish.");
  assert.equal(items[0].href, "/admin/data/changes/7");
  assert.equal(items[0].action, "Review");
});

test("proposals: systemic before value; only open ones; To do capped at the highest reach; invitations only past 7 days", () => {
  const items = needsYou(
    empty({
      proposals: [proposal(), proposal({ key: "systemic:grid", kind: "systemic", summary: "Read C7 grids by row", created: daysAgo(1) }), proposal({ key: "value:done", status: "applied" })],
      todo: Array.from({ length: INBOX_TODO_LIMIT + 3 }, (_, i) => todo(i)),
      invitations: [
        { id: "i1", householdId: "h1", email: "kid@example.com", created: daysAgo(9) },
        { id: "i2", householdId: "h2", email: "new@example.com", created: daysAgo(2) },
      ],
    }),
  );
  const kinds = items.map((i) => i.kind);
  assert.equal(kinds.filter((k) => k === "proposal").length, 2, "the applied one is not listed");
  assert.equal(items[0].title, "Read C7 (admission factors) grids by row", "the systemic proposal comes first (severity 2), its code named");
  assert.equal(kinds.filter((k) => k === "todo").length, INBOX_TODO_LIMIT);
  assert.equal(kinds.filter((k) => k === "invitation").length, 1);
  const inv = items.find((i) => i.kind === "invitation")!;
  assert.equal(inv.href, "/admin/households/h1");
  assert.match(inv.why, /9 days ago/);
  const firstTodo = items.find((i) => i.kind === "todo")!;
  assert.equal(firstTodo.href, "/admin/data/colleges/100000/review", "a To do row opens the college's Review page");
  assert.match(firstTodo.why, /a bot challenge.*Covers 10 colleges/);
});

test("order: severity first, then the oldest; a read that failed (null) leaves its rows out", () => {
  const items = needsYou(
    empty({
      decisions: [decision({ key: "a", created: daysAgo(1) }), decision({ key: "b", question: "Older question", created: daysAgo(5) })],
      deletions: null,
      jobs: null,
      todo: null,
    }),
  );
  assert.deepEqual(
    items.map((i) => i.title),
    ["Older question", "Which aid year should the grids show?"],
  );
  for (const i of items) assert.ok([1, 2, 3].includes(i.severity));
});

test("guard: the order check fails when items come out by age alone", () => {
  const items = needsYou(empty({ heldChanges: [{ id: 1, kind: "pipeline", source: "x", held_reason: null, created_at: daysAgo(0) }], decisions: [decision({ created: daysAgo(10) })] }));
  const byAge = [...items].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  assert.notDeepEqual(
    byAge.map((i) => i.kind),
    items.map((i) => i.kind),
    "a newer held change still leads an older decision",
  );
});

test("the six tiles: live version, review queue, data health, jobs, people, the Steward's spend against $40; each links into its door with a help key", () => {
  const t = tiles(
    empty({
      jobs: [
        { id: "a", name: "A", outcome: "ok", at: daysAgo(1) },
        { id: "b", name: "B", outcome: "failed", at: daysAgo(2) },
        { id: "c", name: "C", outcome: "ok", at: daysAgo(30) },
      ],
      runs: [run({ spent_usd: 12.5 }), run({ key: "old", started: daysAgo(9), spent_usd: 30 })],
    }),
  );
  assert.equal(t.length, 6);
  assert.deepEqual(
    t.map((x) => [x.label, x.value]),
    [
      ["Live version", "#41"],
      ["Review queue", "14,568"],
      ["Data health", "1,500 fresh"],
      ["Jobs, last 7 days", "1 ok"],
      ["People", "120"],
      ["Steward spend, 7 days", "$12.50"],
    ],
  );
  assert.match(t[0].note!, /1,903 colleges/);
  assert.equal(t[1].note, "212 new in 7 days");
  assert.equal(t[2].note, "200 watch · 150 stale · 53 failing");
  assert.equal(t[3].note, "1 failed · 3 jobs in all");
  assert.equal(t[4].note, "40 households · 3 organizations");
  assert.equal(t[5].note, `of the $${STEWARD_WEEKLY_CAP_USD.toFixed(2)} weekly budget`);
  for (const x of t) {
    assert.ok(isHelpKey(x.help), x.label);
    assert.match(x.href, /^\/admin\//);
  }
  const unread = tiles(empty({ lastPublished: undefined, queue: null, health: null, jobs: null, counts: null, runs: null }));
  assert.deepEqual(
    unread.map((x) => x.value),
    Array(6).fill("Couldn't read"),
  );
  assert.equal(tiles(empty({ lastPublished: null }))[0].value, "None yet");
});

test("the weekly spend uses the Steward's own window (the last seven days) and its cap", () => {
  assert.equal(weeklySpend([run({ spent_usd: 1.234 }), run({ key: "x", started: daysAgo(6.9), spent_usd: 2 }), run({ key: "y", started: daysAgo(7.1), spent_usd: 50 })], NOW), 3.23);
  assert.match(read("scripts/lib/steward/budget.mts"), new RegExp(`WEEKLY_CAP_USD = ${STEWARD_WEEKLY_CAP_USD};`), "the same cap the budget guard enforces");
});

test("The Steward did: the newest run of each mode, with what it wrote", () => {
  const runs = [run({ key: "r3", mode: "audit", audits: 1, issues: 0, proposals: 0 }), run({ key: "r2" }), run({ key: "r1", mode: "run" })];
  assert.deepEqual(
    lastRunsByMode(runs).map((r) => r.key),
    ["r3", "r2"],
  );
  assert.equal(runWrote(run()), "Wrote 3 findings, 2 proposals");
  assert.equal(runWrote(run({ issues: 0, proposals: 0 })), "Wrote nothing new");
});

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
