/**
 * The Steward's job review (specs/product/admin-redesign.md "What the Steward reviews"; lib/steward/job-review.ts,
 * scripts/lib/steward/review.mts, scripts/steward.mts mode review, lib/jobs/review-dispatch.ts, lib/jobs/record.ts's
 * after hook). The six recorded cases the spec names are files under tests/fixtures/steward/review/ (one more holds the
 * second half of the repairable failure); the script runs them as dry runs over a file store with the recorded notes
 * in tests/fixtures/steward/answers/. No network, no database, no model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOBS, jobById, type JobDef } from "../lib/jobs/registry.ts";
import { withJobRun, type RunRecorder } from "../lib/jobs/record.ts";
import { requestReview, reviewInputs, REVIEW_COLLAPSE_MS, STEWARD_WORKFLOW } from "../lib/jobs/review-dispatch.ts";
import { reviewForLastRun } from "../lib/jobs/reviews.ts";
import { inboxJob, REVIEW_WEEKLY_CAP_USD } from "../lib/admin/inbox.ts";
import { STEWARD_COLLECTIONS } from "../lib/admin/steward-reads.ts";
import {
  countOf,
  expectationLines,
  firingOf,
  githubStatus,
  githubTrigger,
  jobsWeek,
  PUBLISH_WINDOW_MS,
  repairLine,
  reviewKey,
  reviewRun,
  type ReviewContext,
  type RunView,
} from "../lib/steward/job-review.ts";
import type { AuditDoc, IssueDoc, ReviewDoc, RunDoc } from "../lib/steward/types.ts";
import { COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { fileStore, fileStoreChangeSets, type DataStore } from "../scripts/lib/data-platform/store.mts";
import { REVIEW_BUDGETS, reviewBudget, WEEKLY_CAP_USD } from "../scripts/lib/steward/budget.mts";
import { dispatchRefusal, githubRunView, performRepair, REPAIR_WORKFLOWS, storedRunView, type RepairTools, type ReviewSources, type RunFile } from "../scripts/lib/steward/review.mts";
import { StewardWriter } from "../scripts/lib/steward/writer.mts";
import { main, runSteward, writeJobsAudit } from "../scripts/steward.mts";

const FIXTURES = join(import.meta.dirname, "fixtures", "steward", "review");
const ANSWERS = join(import.meta.dirname, "fixtures", "steward", "answers");

interface Recorded extends RunFile {
  case: string;
  job: string;
  expect: { verdict: ReviewDoc["verdict"]; repair: ReviewDoc["repair"]; reasons: string[] };
}
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as Recorded;
const ctxOf = (r: Recorded): ReviewContext => ({ now: r.context?.now ? new Date(r.context.now) : undefined, lastRestartAt: r.context?.lastRestartAt ?? null, publishAfter: r.context?.publishAfter });
const job = (id: string) => jobById(id)!;
const at = (iso: string) => () => new Date(iso);

/* ------------------------------------------------------------------ */
/* The six recorded cases                                              */
/* ------------------------------------------------------------------ */

test("the recorded cases: a failed run, a slow run, an idle run on a working day, a collect that rightly did nothing, a repairable failure (restart, then a finding), a non-repairable one", () => {
  const names = readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  assert.deepEqual(names, ["1-failed", "2-slow", "3-idle", "4-collect-nothing", "5-repairable", "5-repairable-again", "6-not-repairable"]);
  for (const name of names) {
    const r = fixture(name);
    const got = reviewRun(job(r.job), r.run, ctxOf(r));
    assert.equal(got.verdict, r.expect.verdict, `${name}: verdict`);
    assert.equal(got.repair, r.expect.repair, `${name}: repair`);
    for (const re of r.expect.reasons) assert.ok(got.reasons.some((x) => new RegExp(re).test(x)), `${name}: a reason matching /${re}/ in ${JSON.stringify(got.reasons)}`);
  }
});

test("the collect firing is housekeeping; the Monday run beside it at 13:00 is the headline one", () => {
  const cr = job("college-reported");
  assert.equal(firingOf(cr, fixture("4-collect-nothing").run), "housekeeping");
  assert.equal(firingOf(cr, fixture("1-failed").run), "headline");
  // A Monday at 13:00 in December is out of the Monday schedule's season: it stops at once, and that is right.
  const offSeason: RunView = { ref: "1", trigger: "schedule", status: "ok", startedAt: "2026-12-07T13:00:30Z", finishedAt: "2026-12-07T13:01:00Z", steps: [{ name: "Run the ingestion pipeline", conclusion: "skipped" }], changeSets: [] };
  assert.equal(firingOf(cr, offSeason), "off-season");
  const r = reviewRun(cr, offSeason);
  assert.equal(r.verdict, "fine");
  assert.match(r.reasons[0], /out of season/);
});

/* ------------------------------------------------------------------ */
/* The rules beyond the six                                            */
/* ------------------------------------------------------------------ */

const syncHistory = (over: Partial<RunView> = {}): RunView => ({
  ref: "900",
  trigger: "schedule",
  status: "ok",
  startedAt: "2026-11-02T04:00:10Z",
  finishedAt: "2026-11-02T04:30:10Z",
  steps: [{ name: "Build the history", conclusion: "success" }],
  changeSets: [{ id: 51, source: "sync-history", status: "applied" }],
  ...over,
});

test("a run started by hand isn't held to its counts; a cancelled or unfinished run is flagged", () => {
  const weekly = job("weekly");
  const manual: RunView = { ...fixture("3-idle").run, trigger: "manual" };
  assert.equal(reviewRun(weekly, manual).verdict, "fine");
  assert.deepEqual(reviewRun(weekly, manual).reasons, ["It ran as expected."]);
  const vis = job("visit-events");
  assert.equal(reviewRun(vis, { ...fixture("2-slow").run, status: "cancelled", finishedAt: "2026-11-03T07:30:00Z" }).verdict, "flagged");
  assert.equal(reviewRun(vis, { ...fixture("2-slow").run, status: "running", finishedAt: null }).verdict, "flagged");
});

test("writesChange: a working run with no change is flagged; changes that weren't read are not held against it", () => {
  const sh = job("sync-history");
  const none = reviewRun(sh, syncHistory({ changeSets: [] }), { publishAfter: "2026-11-02T04:40:00Z" });
  assert.equal(none.verdict, "flagged");
  assert.match(none.reasons.join(" "), /wrote no change/);
  assert.equal(reviewRun(sh, syncHistory({ changeSets: undefined })).verdict, "fine");
});

test("publish: an applied change with no publish after two hours is the publish repair; a publish that followed, or a window still open, is fine", () => {
  const sh = job("sync-history");
  const late = new Date(Date.parse("2026-11-02T04:30:10Z") + PUBLISH_WINDOW_MS + 60_000);
  const r = reviewRun(sh, syncHistory(), { now: late, publishAfter: null });
  assert.equal(r.verdict, "flagged");
  assert.equal(r.repair, "publish");
  assert.equal(reviewRun(sh, syncHistory(), { now: late, publishAfter: "2026-11-02T05:00:00Z" }).repair, null);
  assert.equal(reviewRun(sh, syncHistory(), { now: new Date("2026-11-02T05:00:00Z"), publishAfter: null }).repair, null, "inside the window");
  assert.equal(reviewRun(sh, syncHistory(), { now: late, publishAfter: undefined }).repair, null, "a publish that can't be read isn't assumed missing");
  // A pipeline whose own "Ask for a snapshot" step didn't succeed gets the repair at once.
  const ask = syncHistory({ steps: [{ name: "Build the history", conclusion: "success" }, { name: "Ask for a snapshot", conclusion: "failure" }] });
  assert.equal(reviewRun(sh, ask, { now: new Date("2026-11-02T04:31:00Z") }).repair, "publish");
  // The publisher is never asked to publish after itself.
  assert.equal(reviewRun(job("publish-snapshot"), { ...syncHistory(), steps: [] }, { now: late, publishAfter: null }).repair, null);
});

test("hold-finding: a held change the run wrote is flagged with its reason and gets the finding repair, ahead of a restart", () => {
  const held = syncHistory({ changeSets: [{ id: 77, source: "sync-history", status: "held", held_reason: "Brand colors changed for 300 colleges" }] });
  const r = reviewRun(job("sync-history"), held);
  assert.equal(r.verdict, "flagged");
  assert.equal(r.repair, "hold-finding");
  assert.match(r.reasons.join(" "), /Change #77 is held: Brand colors changed for 300 colleges/);
  const failedToo = reviewRun(job("identity-refresh"), { ...held, status: "failed" });
  assert.equal(failedToo.verdict, "failed");
  assert.equal(failedToo.repair, "hold-finding");
});

test("GitHub's words: conclusions and events map to the review's; counts read numbers, lists and flags", () => {
  assert.equal(githubStatus("completed", "success"), "ok");
  assert.equal(githubStatus("completed", "failure"), "failed");
  assert.equal(githubStatus("completed", "timed_out"), "failed");
  assert.equal(githubStatus("completed", "cancelled"), "cancelled");
  assert.equal(githubStatus("completed", "skipped"), "skipped");
  assert.equal(githubStatus("in_progress", null), "running");
  assert.equal(githubTrigger("schedule"), "schedule");
  assert.equal(githubTrigger("workflow_run"), "pipeline");
  assert.equal(githubTrigger("workflow_dispatch"), "manual");
  assert.deepEqual([countOf(3), countOf([1, 2]), countOf(true), countOf("7"), countOf(null)], [3, 2, 1, 0, 0]);
});

/* ------------------------------------------------------------------ */
/* Expectations                                                        */
/* ------------------------------------------------------------------ */

test("every job has expectations; the money-spending pipeline and the Steward are never restartable; restartable GitHub jobs are the dispatch allowlist", () => {
  for (const j of JOBS) {
    assert.ok(j.expects, `${j.id} has expectations`);
    assert.equal(typeof j.expects.restartable, "boolean", `${j.id} says whether it is restartable`);
    if (j.expects.durationMs) assert.ok(j.expects.durationMs[0] <= j.expects.durationMs[1], `${j.id} duration range`);
    // A GitHub job's nonzero names are steps of its workflow.
    if (j.runner === "github" && j.expects.nonzero?.length) {
      const yml = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", j.workflow!), "utf8");
      for (const step of j.expects.nonzero) assert.ok(yml.includes(`name: ${step}`), `${j.id}: step "${step}" is in ${j.workflow}`);
    }
  }
  assert.equal(job("college-reported").expects!.restartable, false);
  assert.equal(job("data-steward").expects!.restartable, false);
  assert.equal(job("weekly").expects!.restartable, false);
  const allow = JOBS.filter((j) => j.runner === "github" && j.expects?.restartable).map((j) => j.workflow!);
  assert.deepEqual([...REPAIR_WORKFLOWS].sort(), [...new Set([...allow, "publish-snapshot.yml"])].sort());
  assert.ok(!REPAIR_WORKFLOWS.has("college-reported.yml") && !REPAIR_WORKFLOWS.has("steward.yml"));
});

test("expectations and repairs read as sentences, with no code names", () => {
  const lines = expectationLines(job("college-reported"));
  assert.ok(lines.some((l) => /^Doing nothing is right when: No open batch/.test(l)));
  assert.ok(lines.some((l) => /^Not started again by the Steward/.test(l)));
  assert.ok(expectationLines(job("digests")).some((l) => /at most once a day/.test(l)));
  for (const l of lines) assert.doesNotMatch(l, /nonzero|writesChange|restartable|durationMs/);
  assert.equal(repairLine({ repair: "restart", repaired: true }), "Started it again");
  assert.equal(repairLine({ repair: "publish", repaired: false }), "Wanted to: asked the publisher for a version (not done)");
  assert.equal(repairLine({ repair: null, repaired: false }), null);
});

/* ------------------------------------------------------------------ */
/* The fixed repair tools                                              */
/* ------------------------------------------------------------------ */

test("dispatch_workflow is restricted: a restart only of a restartable job's own workflow, a publish only of the publisher", () => {
  assert.equal(dispatchRefusal(job("visit-events"), "restart", "visit-events.yml"), null);
  assert.equal(dispatchRefusal(job("visit-events"), "publish", "publish-snapshot.yml"), null);
  assert.match(dispatchRefusal(job("college-reported"), "restart", "college-reported.yml")!, /not a workflow the Steward may start/);
  assert.match(dispatchRefusal(job("visit-events"), "restart", "identity-refresh.yml")!, /only the job's own workflow/);
  assert.match(dispatchRefusal(job("visit-events"), "publish", "visit-events.yml")!, /only the publisher/);
  assert.match(dispatchRefusal(job("sync-data"), "restart", "sync-data.yml")!, /not a workflow the Steward may start/);
});

/** Repair tools that record what they were asked and answer ok. */
function recordingTools(answer: { ok: true } | { ok: false; reason: string } = { ok: true }): RepairTools & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async dispatchWorkflow(file, inputs) {
      calls.push(`dispatch ${file} ${JSON.stringify(inputs)}`);
      return answer;
    },
    async callRoute(path) {
      calls.push(`route ${path}`);
      return answer;
    },
  };
}

async function freshStore(): Promise<{ dir: string; store: DataStore }> {
  const dir = mkdtempSync(join(tmpdir(), "steward-review-"));
  return { dir, store: fileStore(join(dir, "layers")) };
}

test("performRepair: each repair goes through its tool and is noted steward.repair; a refused one is not done", async () => {
  const { store } = await freshStore();
  const handle = await store.open("pipeline", "steward", "t-repair");
  const writer = new StewardWriter(store, handle, { run: "t-repair", now: at("2026-11-03T13:05:00Z") });
  const tools = recordingTools();
  const digests = fixture("5-repairable");
  const r1 = await performRepair({ job: job("digests"), run: digests.run, review: { verdict: "failed", reasons: [], repair: "restart" }, tools, writer, store });
  assert.equal(r1.repaired, true);
  const vis = fixture("2-slow").run;
  await performRepair({ job: job("visit-events"), run: vis, review: { verdict: "failed", reasons: [], repair: "restart" }, tools, writer, store });
  await performRepair({ job: job("sync-history"), run: syncHistory(), review: { verdict: "flagged", reasons: [], repair: "publish" }, tools, writer, store });
  assert.deepEqual(tools.calls, ["route /api/cron/digests", "dispatch visit-events.yml {}", "dispatch publish-snapshot.yml {}"]);
  // A non-restartable job is refused before any tool is called.
  const refused = await performRepair({ job: job("college-reported"), run: fixture("1-failed").run, review: { verdict: "failed", reasons: [], repair: "restart" }, tools, writer, store });
  assert.equal(refused.repaired, false);
  assert.equal(tools.calls.length, 3);
  // hold-finding: a finding on the held change, kind job, family the job.
  const held = syncHistory({ changeSets: [{ id: 77, source: "sync-history", status: "held", held_reason: "Brand colors changed for 300 colleges" }] });
  const h = await performRepair({ job: job("sync-history"), run: held, review: { verdict: "flagged", reasons: [], repair: "hold-finding" }, tools, writer, store });
  assert.equal(h.repaired, true);
  assert.deepEqual(writer.notes, [
    "steward.repair: restart for digests run 4131: done",
    "steward.repair: restart for visit-events run 19061127734: done",
    "steward.repair: publish for sync-history run 900: done",
    "steward.repair: restart for college-reported run 19034418201: not done (college-reported.yml is not a workflow the Steward may start)",
    "steward.repair: hold-finding for sync-history run 900: done",
  ]);
  await handle.close("applied");
  const issue = await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, "change|77");
  assert.equal(issue?.kind, "job");
  assert.equal(issue?.family, "sync-history");
  assert.match(issue!.hypothesis, /held: Brand colors changed for 300 colleges/);
});

/* ------------------------------------------------------------------ */
/* The script's review mode                                            */
/* ------------------------------------------------------------------ */

test("the review budget: $0.10 a run, cut by the week's $3 for reviews and the week's $40", () => {
  assert.deepEqual(REVIEW_BUDGETS, { run: 0.1, week: 3 });
  assert.equal(reviewBudget(0, 0), 0.1);
  assert.equal(reviewBudget(10, 2.95), 0.05);
  assert.equal(reviewBudget(WEEKLY_CAP_USD - 0.02, 0), 0.02);
  assert.equal(reviewBudget(0, 3), 0);
  assert.equal(reviewBudget(45, 0), 0);
  assert.equal(REVIEW_WEEKLY_CAP_USD, REVIEW_BUDGETS.week, "the console's $3 is the budget's");
});

test("review mode, dry run: an idle weekly run is flagged with the Haiku note, a finding (kind job), the review, and a run record inside $0.10", async () => {
  const { dir, store } = await freshStore();
  const r = fixture("3-idle");
  const res = await runSteward({ mode: "review", store, job: "weekly", runFile: r, runRef: "rev-1", dryRun: ANSWERS, now: at("2026-11-01T23:05:00Z"), env: {}, log: () => {} });
  assert.equal(res.exit, 0, res.message);
  const doc = await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, "weekly:4127");
  assert.ok(doc);
  assert.equal(doc.verdict, "flagged");
  assert.equal(doc.repair, null);
  assert.equal(doc.repaired, false);
  assert.match(doc.note!, /^Sunday's weekly emails counted no students/);
  assert.equal(doc.run_started, r.run.startedAt);
  const issue = await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, "job|weekly");
  assert.equal(issue?.kind, "job");
  assert.equal(issue?.family, "weekly");
  assert.equal(issue?.hypothesis, doc.note);
  assert.match(issue!.findings[0].shows, /^Run 4127, 2026-11-01 23:00 UTC: flagged\./);
  const run = await store.readOne<RunDoc>(COLLECTIONS.steward.runs, "rev-1");
  assert.equal(run?.mode, "review");
  assert.equal(run?.budget_usd, 0.1);
  assert.ok(run!.spent_usd > 0 && run!.spent_usd <= 0.1, `spent ${run!.spent_usd}`);
  const set = fileStoreChangeSets(join(dir, "layers")).find((c) => c.id === res.changeSet)!;
  assert.deepEqual([set.kind, set.source, set.status], ["pipeline", "steward", "applied"]);
  assert.equal(set.summary.verdict, "flagged");
  // A second review of the same run does nothing.
  const again = await runSteward({ mode: "review", store, job: "weekly", runFile: r, runRef: "rev-2", dryRun: ANSWERS, now: at("2026-11-01T23:10:00Z"), env: {}, log: () => {} });
  assert.equal(again.exit, 0);
  assert.equal(again.changeSet, null);
  assert.equal(again.run.stopped, "already reviewed");
});

test("review mode, dry run: every flagged or failed recorded case gets its recorded note (no answer file is stale)", async () => {
  for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))) {
    const r = fixture(name);
    if (r.expect.verdict === "fine") continue;
    const { store } = await freshStore();
    const res = await runSteward({ mode: "review", store, job: r.job, runFile: r, tools: recordingTools(), runRef: `all-${name}`, dryRun: ANSWERS, now: at(r.context!.now!), env: {}, log: () => {} });
    assert.equal(res.exit, 0, `${name}: ${res.message}`);
    const doc = await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, reviewKey(r.job, r.run.ref));
    assert.ok(doc?.note, `${name} has its note`);
  }
});

test("review mode: the repairable failure is restarted once; the second failure that day gets a finding only", async () => {
  const { dir, store } = await freshStore();
  const tools = recordingTools();
  const first = fixture("5-repairable");
  const r1 = await runSteward({ mode: "review", store, job: "digests", runFile: first, tools, runRef: "rev-d1", dryRun: ANSWERS, now: at("2026-11-03T13:05:00Z"), env: {}, log: () => {} });
  assert.equal(r1.exit, 0, r1.message);
  assert.deepEqual(tools.calls, ["route /api/cron/digests"]);
  const d1 = await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, "digests:4131");
  assert.deepEqual([d1?.verdict, d1?.repair, d1?.repaired], ["failed", "restart", true]);
  const set = fileStoreChangeSets(join(dir, "layers")).find((c) => c.id === r1.changeSet)!;
  assert.deepEqual(set.summary.notes, ["steward.repair: restart for digests run 4131: done"]);
  assert.equal((await store.readOne<RunDoc>(COLLECTIONS.steward.runs, "rev-d1"))?.repairs, 1);

  // The second failure: the restart history comes from the store's reviews, not from the file.
  const second = fixture("5-repairable-again");
  const r2 = await runSteward({ mode: "review", store, job: "digests", runFile: { run: second.run, context: { now: second.context!.now } }, tools, runRef: "rev-d2", dryRun: ANSWERS, now: at("2026-11-03T15:05:00Z"), env: {}, log: () => {} });
  assert.equal(r2.exit, 0, r2.message);
  assert.equal(tools.calls.length, 1, "no second restart");
  const d2 = await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, "digests:4135");
  assert.deepEqual([d2?.verdict, d2?.repair, d2?.repaired], ["failed", null, false]);
  assert.match(d2!.reasons.join(" "), /already started it again once in the last 24 hours/);
  const issue = await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, "job|digests");
  assert.equal(issue?.findings.length, 2, "one line per flagged or failed run");
});

test("review mode: a housekeeping firing that looked fine is not written; a non-repairable failure is a finding with no tool called", async () => {
  const { store } = await freshStore();
  const tools = recordingTools();
  const idle = await runSteward({ mode: "review", store, job: "college-reported", runFile: fixture("4-collect-nothing"), tools, runRef: "rev-c", dryRun: ANSWERS, now: at("2026-11-04T13:35:00Z"), env: {}, log: () => {} });
  assert.equal(idle.exit, 0);
  assert.equal(idle.changeSet, null);
  assert.equal((await store.read(COLLECTIONS.steward.reviews)).size, 0);
  const weekly = await runSteward({ mode: "review", store, job: "weekly", runFile: fixture("6-not-repairable"), tools, runRef: "rev-w", dryRun: ANSWERS, now: at("2026-11-08T23:05:00Z"), env: {}, log: () => {} });
  assert.equal(weekly.exit, 0, weekly.message);
  assert.deepEqual(tools.calls, []);
  const doc = await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, "weekly:4140");
  assert.deepEqual([doc?.verdict, doc?.repair], ["failed", null]);
  assert.match(doc!.note!, /text service refused the credentials/);
  assert.equal((await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, "job|weekly"))?.kind, "job");
});

test("review mode: past the week's $3 for reviews there is no note, and the review is still written", async () => {
  const { store } = await freshStore();
  const seed = await store.open("pipeline", "steward", "seed");
  const spent: RunDoc = { ...({} as RunDoc), key: "old-review", mode: "review", started: "2026-11-01T10:00:00Z", spent_usd: 3, budget_usd: 0.1 } as RunDoc;
  await seed.write(COLLECTIONS.steward.runs, [{ key: "old-review", body: spent }]);
  await seed.close("applied");
  const logs: string[] = [];
  const res = await runSteward({ mode: "review", store, job: "weekly", runFile: fixture("3-idle"), runRef: "rev-cap", dryRun: join(tmpdir(), "no-answers-here"), now: at("2026-11-01T23:05:00Z"), env: {}, log: (l) => logs.push(l) });
  assert.equal(res.exit, 0, res.message);
  const doc = await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, "weekly:4127");
  assert.equal(doc?.verdict, "flagged");
  assert.equal(doc?.note, null);
  assert.ok(logs.some((l) => /the review has no note/.test(l)));
  assert.equal(res.run.budget_usd, 0);
});

test("review mode reads the run through its sources: a held change gets the finding repair; an unknown job or run fails", async () => {
  const { store } = await freshStore();
  const view = syncHistory({ changeSets: [{ id: 77, source: "sync-history", status: "held", held_reason: "Brand colors changed for 300 colleges" }] });
  const sources: ReviewSources = { run: async (j, ref) => (j.id === "sync-history" && ref === "900" ? view : null), publishAfter: async () => null };
  const tools = recordingTools();
  const res = await runSteward({ mode: "review", store, job: "sync-history", jobRun: "900", sources, tools, runRef: "rev-h", now: at("2026-11-02T04:35:00Z"), env: {}, log: () => {} });
  assert.equal(res.exit, 0, res.message);
  const doc = await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, "sync-history:900");
  assert.deepEqual([doc?.verdict, doc?.repair, doc?.repaired, doc?.note], ["flagged", "hold-finding", true, null]);
  assert.equal((await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, "change|77"))?.family, "sync-history");
  assert.deepEqual(tools.calls, []);
  const missing = await runSteward({ mode: "review", store, job: "sync-history", jobRun: "901", sources, tools, runRef: "rev-x", now: at("2026-11-02T04:35:00Z"), env: {}, log: () => {} });
  assert.equal(missing.exit, 1);
  assert.match(missing.message!, /has no run 901/);
  const noJob = await runSteward({ mode: "review", store, job: "nope", jobRun: "1", sources, runRef: "rev-y", env: {}, log: () => {} });
  assert.match(noJob.message!, /needs --job <id>/);
});

test("the readers: a job_runs row and a workflow run with its jobs become RunViews", () => {
  const stored = storedRunView({ id: 4127, job: "weekly", trigger: "schedule", status: "ok", started_at: "2026-11-01T23:00:02Z", finished_at: "2026-11-01T23:00:09Z", summary: { students: 0 }, error: null });
  assert.deepEqual(stored, { ref: "4127", trigger: "schedule", status: "ok", startedAt: "2026-11-01T23:00:02Z", finishedAt: "2026-11-01T23:00:09Z", summary: { students: 0 }, error: null });
  assert.equal(storedRunView({ id: 1, job: "weekly", trigger: "manual", status: "running", started_at: "x", finished_at: null, summary: null, error: null }).status, "running");
  const gh = githubRunView(
    { id: 9, event: "schedule", status: "completed", conclusion: "failure", run_started_at: "2026-11-02T13:00:41Z", updated_at: "2026-11-02T13:52:10Z", html_url: "u" },
    { jobs: [{ name: "run", steps: [{ name: "Run the ingestion pipeline", conclusion: "failure" }] }] },
  );
  assert.deepEqual(gh, { ref: "9", trigger: "schedule", status: "failed", startedAt: "2026-11-02T13:00:41Z", finishedAt: "2026-11-02T13:52:10Z", steps: [{ job: "run", name: "Run the ingestion pipeline", conclusion: "failure" }], url: "u" });
});

test("the CLI: --mode review with --job, --run and a recorded run; bad ids refused", async () => {
  const { store, dir } = await freshStore();
  const code = await main(["--store", `file:${join(dir, "layers")}`, "--mode", "review", "--job", "weekly", "--run", "4127", "--run-file", join(FIXTURES, "3-idle.json"), "--dry-run", ANSWERS, "--run-ref", "cli-rev"], { GITHUB_OUTPUT: "" });
  assert.equal(code, 0);
  assert.equal((await store.readOne<ReviewDoc>(COLLECTIONS.steward.reviews, "weekly:4127"))?.verdict, "flagged");
  await assert.rejects(main(["--store", `file:${join(dir, "layers")}`, "--mode", "review", "--job", "Weekly!", "--run", "1"], {}), /--job Weekly!: a job id/);
  await assert.rejects(main(["--store", `file:${join(dir, "layers")}`, "--mode", "review", "--job", "weekly", "--run", "abc"], {}), /--run abc: a run id is digits/);
});

/* ------------------------------------------------------------------ */
/* The weekly summary                                                  */
/* ------------------------------------------------------------------ */

const review = (job: string, ref: string, verdict: ReviewDoc["verdict"], started: string, repaired = false): ReviewDoc => ({
  key: reviewKey(job, ref),
  job,
  run_ref: ref,
  verdict,
  reasons: [],
  repair: repaired ? "restart" : null,
  repaired,
  note: null,
  created: started,
  run_started: started,
});

test("jobsWeek: the week's reviews by job, failures first, the spend by mode, and the queue's trend", () => {
  const now = new Date("2026-11-08T09:00:00Z");
  const reviews = [
    review("digests", "1", "failed", "2026-11-03T13:00:00Z", true),
    review("digests", "2", "failed", "2026-11-03T15:00:00Z"),
    review("visit-events", "3", "flagged", "2026-11-04T07:00:00Z"),
    review("weekly", "4", "fine", "2026-11-02T23:00:00Z"),
    review("weekly", "5", "failed", "2026-10-25T23:00:00Z"), // before the week
  ];
  const runs = [
    { key: "a", mode: "review", started: "2026-11-03T13:05:00Z", spent_usd: 0.004 },
    { key: "b", mode: "run", started: "2026-11-02T14:00:00Z", spent_usd: 4.2 },
    { key: "c", mode: "run", started: "2026-10-20T14:00:00Z", spent_usd: 9 },
  ] as RunDoc[];
  const w = jobsWeek(reviews, runs, now, { open: 14_100, before: 14_568 });
  assert.deepEqual([w.reviewed, w.failed, w.flagged, w.repaired], [4, 2, 1, 1]);
  assert.deepEqual(w.byJob.map((r) => r.job), ["digests", "visit-events", "weekly"]);
  assert.deepEqual(w.byJob[0], { job: "digests", fine: 0, flagged: 0, failed: 2, repaired: 1 });
  assert.deepEqual(w.spendByMode, { review: 0.004, run: 4.2 });
  assert.deepEqual([w.queueOpen, w.queueOpenBefore], [14_100, 14_568]);
});

test("the Sunday audit writes the jobs summary as an audit of family jobs, with the last summary's queue as the trend", async () => {
  const { store } = await freshStore();
  const seed = await store.open("pipeline", "steward", "seed");
  await seed.write(COLLECTIONS.steward.reviews, [{ key: "digests:1", body: review("digests", "1", "failed", "2026-11-03T13:00:00Z", true) }]);
  await seed.write(COLLECTIONS.steward.audits, [{ key: "jobs-old", body: { key: "jobs-old", family: "jobs", checked: 0, wrong: [], rate: 0, run: "old", created: "2026-11-01T09:00:00Z", jobs: { queueOpen: 14_568 } } }]);
  await seed.close("applied");
  const handle = await store.open("pipeline", "steward", "audit-1");
  const writer = new StewardWriter(store, handle, { run: "audit-1", now: at("2026-11-08T09:00:00Z") });
  const doc = await writeJobsAudit(store, writer, "steward-123", new Date("2026-11-08T09:00:00Z"), 14_100);
  await handle.close("applied");
  assert.equal(doc.family, "jobs");
  assert.equal(doc.key, "jobs-steward-123");
  assert.equal(doc.checked, 1);
  assert.equal(doc.rate, 1);
  assert.deepEqual([doc.jobs?.queueOpen, doc.jobs?.queueOpenBefore], [14_100, 14_568]);
  assert.equal((await store.readOne<AuditDoc>(COLLECTIONS.steward.audits, "jobs-steward-123"))?.jobs?.repaired, 1);
});

/* ------------------------------------------------------------------ */
/* Asking for a review when a Vercel job finishes                      */
/* ------------------------------------------------------------------ */

const finish = (id: number, iso = "2026-11-03T13:00:19Z") => ({ id, status: "failed" as const, summary: {}, error: "x", httpStatus: 500, durationMs: 16_000, finishedAt: new Date(iso) });

test("requestReview: sends steward.yml mode review with the job and the row id; nothing without credentials; collapsed inside 10 minutes; never throws", async () => {
  const sent: unknown[] = [];
  const deps = {
    configured: async () => true,
    recentFinishes: async () => 0,
    dispatch: async (file: string, inputs: Record<string, string>, requestId: string) => {
      sent.push([file, inputs, requestId]);
      return { ok: true as const };
    },
    requestId: () => "req-1",
    log: () => {},
  };
  assert.equal(await requestReview("digests", finish(4131), deps), "sent");
  assert.deepEqual(sent, [[STEWARD_WORKFLOW, { mode: "review", job: "digests", run: "4131" }, "req-1"]]);
  assert.deepEqual(reviewInputs("weekly", 7), { mode: "review", job: "weekly", run: "7" });
  assert.equal(await requestReview("digests", finish(4132), { ...deps, configured: async () => false }), "not-configured");
  let since: Date | null = null;
  assert.equal(await requestReview("digests", finish(4133), { ...deps, recentFinishes: async (_j, s) => ((since = s), 1) }), "collapsed");
  assert.equal(since!.toISOString(), new Date(Date.parse("2026-11-03T13:00:19Z") - REVIEW_COLLAPSE_MS).toISOString());
  assert.equal(await requestReview("digests", finish(4134), { ...deps, recentFinishes: async () => { throw new Error("db down"); } }), "failed");
  assert.equal(await requestReview("digests", finish(4135), { ...deps, dispatch: async () => ({ ok: false as const, reason: "403" }) }), "failed");
  assert.equal(sent.length, 1);
});

function fakeRecorder(): RunRecorder & { finishes: number[] } {
  const finishes: number[] = [];
  return {
    finishes,
    async start() {
      return 41;
    },
    async finish(id: number) {
      finishes.push(id);
    },
  };
}
const SECRET = "cron-secret-abc123";
const req = () => ({ headers: new Headers({ authorization: `Bearer ${SECRET}`, "user-agent": "vercel-cron/1.0" }) }) as unknown as import("next/server").NextRequest;

test("withJobRun's after hook: called once the row is finished with the row id and outcome; a throw never reaches the caller; no default with an injected recorder", async () => {
  const rec = fakeRecorder();
  const seen: { job: string; id: number; status: string }[] = [];
  const handler = withJobRun("digests", async () => Response.json({ error: "boom" }, { status: 500 }), {
    recorder: rec,
    secret: () => SECRET,
    afterFinish: async (j, f) => {
      assert.deepEqual(rec.finishes, [41], "the row is finished first");
      seen.push({ job: j, id: f.id, status: f.status });
    },
  });
  assert.equal((await handler(req())).status, 500);
  assert.deepEqual(seen, [{ job: "digests", id: 41, status: "failed" }]);
  const throwing = withJobRun("digests", async () => Response.json({ publishes: [] }), { recorder: fakeRecorder(), secret: () => SECRET, afterFinish: async () => { throw new Error("GitHub down"); } });
  const res = await throwing(req());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { publishes: [] });
  // An injected recorder with no hook gets none (tests never dispatch).
  const quiet = withJobRun("digests", async () => Response.json({}), { recorder: fakeRecorder(), secret: () => SECRET });
  assert.equal((await quiet(req())).status, 200);
});

/* ------------------------------------------------------------------ */
/* The console's reads                                                 */
/* ------------------------------------------------------------------ */

const storedLast = (id: number, status: "ok" | "failed") => ({
  kind: "stored" as const,
  run: { id, job: "digests", trigger: "schedule" as const, status, startedAt: "2026-11-03T13:00:03Z", finishedAt: "2026-11-03T13:00:19Z", durationMs: 16_000, httpStatus: status === "ok" ? 200 : 500, summary: {}, error: status === "failed" ? "Resend answered 503" : null },
});

test("the Inbox reads the review's verdict when the last run has one, else the run's own outcome", () => {
  const def = job("digests");
  const flagged = { ...review("digests", "4131", "flagged", "2026-11-03T13:00:03Z"), note: "No publishes were counted.", reasons: ["It did nothing."] };
  const ok = inboxJob({ job: def, next: null, last: storedLast(4131, "ok"), review: { review: flagged, ofLastRun: true } });
  assert.deepEqual([ok.outcome, ok.note], ["flagged", "No publishes were counted."]);
  const fineButFailed = inboxJob({ job: def, next: null, last: storedLast(4131, "failed"), review: { review: review("digests", "4131", "fine", "x"), ofLastRun: true } });
  assert.equal(fineButFailed.outcome, "failed", "a fine review never hides a failed run");
  const old = inboxJob({ job: def, next: null, last: storedLast(4140, "ok"), review: { review: flagged, ofLastRun: false } });
  assert.deepEqual([old.outcome, old.note], ["ok", null], "a review of an earlier run doesn't decide");
  const plain = inboxJob({ job: def, next: null, last: storedLast(4141, "failed") });
  assert.deepEqual([plain.outcome, plain.note], ["failed", "Resend answered 503"]);
});

test("reviewForLastRun: the last run's own review, else the job's newest marked as of an earlier run", () => {
  const own = new Map([["digests:7", review("digests", "7", "fine", "a")]]);
  const latest = new Map([["digests", review("digests", "5", "flagged", "b")]]);
  assert.deepEqual(reviewForLastRun("digests", "7", own, latest), { review: own.get("digests:7"), ofLastRun: true });
  assert.deepEqual(reviewForLastRun("digests", "8", own, latest), { review: latest.get("digests"), ofLastRun: false });
  assert.equal(reviewForLastRun("weekly", null, own, new Map()), null);
});

test("the console reads steward.reviews from the same collection the script writes", () => {
  assert.equal(STEWARD_COLLECTIONS.reviews, COLLECTIONS.steward.reviews);
  assert.equal(COLLECTIONS.steward.reviews, "steward.reviews");
});

export type { JobDef };
