/**
 * The admin console's Jobs section (specs/product/admin-jobs.md): the cron parser and its words, the job table held
 * to vercel.json and the workflows' schedules, the run recorder around a cron route (no row without the secret, the
 * outcome read off the response, a job that still runs when the table can't be written), the view helpers, and the
 * pages' guards. No network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describeCron, matches, nextRun, nextRuns, parseCron } from "../lib/jobs/cron.ts";
import { JOBS, githubWorkflows, jobById, jobByWorkflow, nextJobRun, nextScheduleRun, scheduleOfRun } from "../lib/jobs/registry.ts";
import { KEEP_DAYS, outcomeOf, supabaseRecorder, triggerOf, withJobRun, type RunFinish, type RunRecorder } from "../lib/jobs/record.ts";
import { jobHref, jobsViewHref, lastOutcome, outcomeCounts, parseJobsView, parseRunId, relativeLabel, runHref, sortJobs, sortJobsByOutcome, storedOutcome, summaryLine } from "../lib/jobs/view.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const at = (iso: string) => new Date(iso);

/* ------------------------------------------------------------------ */
/* The cron parser                                                     */
/* ------------------------------------------------------------------ */

test("parseCron reads stars, lists, ranges, and steps; Sunday is 0 or 7; nonsense is refused", () => {
  const s = parseCron("0 13 * * 1-6");
  assert.deepEqual([...s.hours], [13]);
  assert.deepEqual([...s.daysOfWeek].sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(s.anyDayOfMonth, true);
  assert.equal(s.anyDayOfWeek, false);
  assert.deepEqual([...parseCron("*/30 * * * *").minutes], [0, 30]);
  assert.deepEqual([...parseCron("5,35 1-3/2 * * *").minutes], [5, 35]);
  assert.deepEqual([...parseCron("5,35 1-3/2 * * *").hours], [1, 3]);
  assert.deepEqual([...parseCron("0 0 * * 7").daysOfWeek], [0]);
  assert.throws(() => parseCron("0 13 * *"), /five fields/);
  assert.throws(() => parseCron("60 13 * * *"), /outside/);
  assert.throws(() => parseCron("0 13 * * MON"), /can't read/);
  assert.throws(() => parseCron("0 13 * * */0"), /step/);
});

test("nextRun: strictly after `from`, in UTC, skipping to the schedule's day, hour, and month", () => {
  const from = at("2026-11-01T12:00:00Z"); // a Sunday
  const next = (expr: string) => nextRun(parseCron(expr), from)?.toISOString();
  assert.equal(next("0 13 * * *"), "2026-11-01T13:00:00.000Z");
  assert.equal(next("0 23 * * 0"), "2026-11-01T23:00:00.000Z");
  assert.equal(next("0 23 * * 1-6"), "2026-11-02T23:00:00.000Z");
  assert.equal(next("0 13 1 * *"), "2026-11-01T13:00:00.000Z");
  assert.equal(next("0 9 3 * *"), "2026-11-03T09:00:00.000Z");
  assert.equal(next("*/30 * * * *"), "2026-11-01T12:30:00.000Z");
  assert.equal(next("0 6 * 2 *"), "2027-02-01T06:00:00.000Z");
  // A firing at `from` itself is not "next".
  assert.equal(nextRun(parseCron("0 12 * * *"), from)?.toISOString(), "2026-11-02T12:00:00.000Z");
  // Both day fields restricted: either matches (Vixie's rule, which GitHub follows). The 1st of the month is a Sunday
  // in Nov 2026 and the next Monday is the 2nd: the first firing is the 1st.
  assert.equal(nextRun(parseCron("0 13 1 * 1"), at("2026-10-31T00:00:00Z"))?.toISOString(), "2026-11-01T13:00:00.000Z");
  assert.equal(nextRun(parseCron("0 13 1 * 1"), at("2026-11-01T14:00:00Z"))?.toISOString(), "2026-11-02T13:00:00.000Z");
  assert.equal(nextRun(parseCron("0 0 30 2 *"), from), null); // never
  assert.equal(nextRuns(parseCron("0 13 * * 1"), from, 3).map((d) => d.toISOString()).join(","), "2026-11-02T13:00:00.000Z,2026-11-09T13:00:00.000Z,2026-11-16T13:00:00.000Z");
  assert.equal(matches(parseCron("0 13 * * 1"), at("2026-11-02T13:00:30Z")), true);
  assert.equal(matches(parseCron("0 13 * * 1"), at("2026-11-03T13:00:00Z")), false);
});

test("describeCron puts the site's schedules into words and leaves anything odd as written", () => {
  assert.equal(describeCron("0 13 * * *"), "Every day at 13:00 UTC");
  assert.equal(describeCron("30 13 * * *"), "Every day at 13:30 UTC");
  assert.equal(describeCron("0 23 * * 0"), "Sundays at 23:00 UTC");
  assert.equal(describeCron("0 23 * * 1-6"), "Monday to Saturday at 23:00 UTC");
  assert.equal(describeCron("0 13 * * 1"), "Mondays at 13:00 UTC");
  assert.equal(describeCron("0 13 * * 1,4"), "Mondays, Thursdays at 13:00 UTC");
  assert.equal(describeCron("0 13 1 * *"), "The 1st of every month at 13:00 UTC");
  assert.equal(describeCron("0 9 3 * *"), "The 3rd of every month at 09:00 UTC");
  assert.equal(describeCron("0 9 22 * *"), "The 22nd of every month at 09:00 UTC");
  assert.equal(describeCron("*/30 * * * *"), "Every 30 minutes");
  assert.equal(describeCron("*/15 * * * *"), "Every 15 minutes");
  assert.equal(describeCron("0 6 * 2 *"), "0 6 * 2 *"); // a month filter: as written
  assert.equal(describeCron("0 13 1 * 1"), "0 13 1 * 1"); // both day fields: as written
  assert.equal(describeCron("nonsense"), "nonsense");
});

/* ------------------------------------------------------------------ */
/* The job table, held to vercel.json and the workflows                */
/* ------------------------------------------------------------------ */

/** Every `cron:` line of a workflow's `on.schedule`. */
function workflowCrons(file: string): string[] {
  const src = read(join(".github/workflows", file));
  return [...src.matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm)].map((m) => m[1]);
}

test("every Vercel cron in vercel.json is a job with that path and schedule, and no job claims a cron that isn't there", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  const fromConfig = vercel.crons.map((c) => `${c.path} ${c.schedule}`).sort();
  const fromTable = JOBS.filter((j) => j.runner === "vercel")
    .flatMap((j) => j.schedules.map((s) => `${j.path} ${s.cron}`))
    .sort();
  assert.deepEqual(fromTable, fromConfig);
  for (const j of JOBS.filter((j) => j.runner === "vercel")) assert.ok(existsSync(join(ROOT, "app", j.path!, "route.ts")), `${j.path} has a route`);
});

test("every scheduled workflow is a job with exactly its crons; every GitHub job names a workflow that exists", () => {
  const files = readdirSync(join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"));
  for (const file of files) {
    const crons = workflowCrons(file).sort();
    const job = jobByWorkflow(file);
    if (crons.length) assert.ok(job, `${file} has a schedule but no job in lib/jobs/registry.ts`);
    if (job) assert.deepEqual(job.schedules.map((s) => s.cron).sort(), crons, `${file}: the job's crons are the workflow's`);
  }
  for (const file of githubWorkflows()) assert.ok(files.includes(file), `${file} exists`);
  // Verify is CI, not a batch job.
  assert.equal(jobByWorkflow("verify.yml"), null);
});

test("every job has a unique URL-safe id, a spec that exists, and a dispatch row that exists when it names one", () => {
  const ids = JOBS.map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length);
  const workflows = read("lib/admin/workflows.ts");
  for (const j of JOBS) {
    assert.match(j.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(existsSync(join(ROOT, j.spec)), `${j.id}: ${j.spec} exists`);
    if (j.dispatch) assert.match(workflows, new RegExp(`id: "${j.dispatch}"`), `${j.id}: DISPATCHABLE_RUNS has "${j.dispatch}"`);
    for (const s of j.schedules) parseCron(s.cron);
  }
  assert.equal(jobById("digests")?.name, "Update digest");
  assert.equal(jobById("../etc"), null);
  assert.equal(jobById("nope"), null);
});

test("the gated schedules: the next college-reported run is the next firing in season; the collect firing never counts", () => {
  const cr = jobById("college-reported")!;
  // November 1, 2026 is a Sunday: the Monday cron fires the 2nd (in season, Aug–Nov); the monthly cron's next in-season
  // firing is December 1.
  assert.equal(nextJobRun(cr, at("2026-11-01T12:00:00Z"))?.toISOString(), "2026-11-02T13:00:00.000Z");
  const monthly = cr.schedules.find((s) => s.cron === "0 13 1 * *")!;
  assert.equal(nextScheduleRun(monthly, at("2026-11-01T12:00:00Z"))?.toISOString(), "2026-12-01T13:00:00.000Z");
  // In December the Monday cron is out of season until August.
  const monday = cr.schedules.find((s) => s.cron === "0 13 * * 1")!;
  assert.equal(nextScheduleRun(monday, at("2026-12-10T12:00:00Z"))?.toISOString(), "2027-08-02T13:00:00.000Z");
  assert.equal(nextJobRun(cr, at("2026-12-10T12:00:00Z"))?.toISOString(), "2027-01-01T13:00:00.000Z");
  // A hand-run job has no next run.
  assert.equal(nextJobRun(jobById("common-app")!, at("2026-11-01T12:00:00Z")), null);
});

test("scheduleOfRun names the schedule that fired a run from its start time, with slack for GitHub's lateness", () => {
  const cr = jobById("college-reported")!;
  assert.equal(scheduleOfRun(cr, at("2026-11-02T13:04:00Z"))?.cron, "0 13 * * 1"); // Monday, four minutes late
  assert.equal(scheduleOfRun(cr, at("2026-11-02T13:31:00Z"))?.cron, "*/30 * * * *");
  assert.equal(scheduleOfRun(cr, at("2026-11-02T14:10:00Z"))?.cron, "*/30 * * * *");
  assert.equal(scheduleOfRun(cr, at("2026-11-02T14:25:00Z")), null); // 25 minutes after any firing
  assert.equal(scheduleOfRun(jobById("weekly")!, at("2026-11-01T23:02:00Z"))?.cron, "0 23 * * 0");
  assert.equal(scheduleOfRun(jobById("common-app")!, at("2026-11-01T23:02:00Z")), null);
});

/* ------------------------------------------------------------------ */
/* The run recorder                                                    */
/* ------------------------------------------------------------------ */

test("triggerOf: Vercel Cron's user agent is the schedule; anything else is a person", () => {
  assert.equal(triggerOf("vercel-cron/1.0"), "schedule");
  assert.equal(triggerOf("Vercel-Cron/1.0"), "schedule");
  assert.equal(triggerOf("curl/8.4"), "manual");
  assert.equal(triggerOf(null), "manual");
});

test("outcomeOf: a 4xx or 5xx failed (with the body's error), configured:false skipped, anything else ok", () => {
  assert.deepEqual(outcomeOf(200, { sent: 3 }), { status: "ok", summary: { sent: 3 }, error: null });
  assert.deepEqual(outcomeOf(200, { configured: false }), { status: "skipped", summary: { configured: false }, error: null });
  assert.deepEqual(outcomeOf(500, { error: "Reading consents failed" }), { status: "failed", summary: { error: "Reading consents failed" }, error: "Reading consents failed" });
  assert.deepEqual(outcomeOf(502, "bad"), { status: "failed", summary: { value: "bad" }, error: "HTTP 502" });
  assert.deepEqual(outcomeOf(200, undefined), { status: "ok", summary: {}, error: null });
});

interface Fake extends RunRecorder {
  starts: { job: string; trigger: string; at: string }[];
  finishes: { id: number; result: RunFinish }[];
}
function fakeRecorder(opts: { fail?: boolean } = {}): Fake {
  const fake: Fake = {
    starts: [],
    finishes: [],
    async start(job, trigger, startedAt) {
      fake.starts.push({ job, trigger, at: startedAt.toISOString() });
      return opts.fail ? null : fake.starts.length;
    },
    async finish(id, result) {
      fake.finishes.push({ id, result });
    },
  };
  return fake;
}

const SECRET = "cron-secret-abc123";
function request(opts: { auth?: string | null; agent?: string } = {}) {
  const headers = new Headers();
  if (opts.auth !== null) headers.set("authorization", opts.auth ?? `Bearer ${SECRET}`);
  if (opts.agent) headers.set("user-agent", opts.agent);
  return { headers } as unknown as import("next/server").NextRequest;
}
function clock(...isos: string[]) {
  const times = isos.map((s) => at(s));
  return () => times.shift() ?? times[0] ?? at("2026-11-01T13:00:00Z");
}

test("withJobRun: a run is recorded start to finish with the response's outcome, the schedule as its trigger, and its duration", async () => {
  const rec = fakeRecorder();
  const handler = withJobRun("digests", async () => Response.json({ configured: true, publishes: [{ sent: 2 }] }), { recorder: rec, secret: () => SECRET, now: clock("2026-11-01T13:00:00Z", "2026-11-01T13:00:42Z") });
  const res = await handler(request({ agent: "vercel-cron/1.0" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { configured: true, publishes: [{ sent: 2 }] }); // the body still reaches the caller
  assert.deepEqual(rec.starts, [{ job: "digests", trigger: "schedule", at: "2026-11-01T13:00:00.000Z" }]);
  assert.equal(rec.finishes.length, 1);
  const { id, result } = rec.finishes[0];
  assert.equal(id, 1);
  assert.equal(result.status, "ok");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.durationMs, 42_000);
  assert.equal(result.finishedAt.toISOString(), "2026-11-01T13:00:42.000Z");
  assert.deepEqual(result.summary, { configured: true, publishes: [{ sent: 2 }] });
});

test("withJobRun: no bearer, wrong bearer, or no configured secret → 401 and no row; the handler never runs", async () => {
  for (const [req, secret] of [
    [request({ auth: null }), SECRET],
    [request({ auth: "Bearer nope" }), SECRET],
    [request(), undefined],
  ] as const) {
    const rec = fakeRecorder();
    let ran = 0;
    const handler = withJobRun("weekly", async () => (ran++, Response.json({})), { recorder: rec, secret: () => secret });
    const res = await handler(req);
    assert.equal(res.status, 401);
    assert.equal(ran, 0);
    assert.deepEqual(rec.starts, []);
  }
});

test("withJobRun: a 500 answer is failed with its error; configured:false is skipped; a thrown error is failed and answered as a 500", async () => {
  const rec = fakeRecorder();
  const failing = withJobRun("day-before", async () => Response.json({ error: "Reading consents failed: boom" }, { status: 500 }), { recorder: rec, secret: () => SECRET });
  assert.equal((await failing(request())).status, 500);
  assert.equal(rec.finishes[0].result.status, "failed");
  assert.equal(rec.finishes[0].result.error, "Reading consents failed: boom");
  assert.equal(rec.starts[0].trigger, "manual");

  const skipped = withJobRun("visit-alerts", async () => Response.json({ configured: false }), { recorder: rec, secret: () => SECRET });
  await skipped(request());
  assert.equal(rec.finishes[1].result.status, "skipped");

  const thrower = withJobRun("interest-confirm", async () => {
    throw new Error("the database is asleep");
  }, { recorder: rec, secret: () => SECRET });
  const res = await thrower(request());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "the database is asleep" });
  assert.equal(rec.finishes[2].result.status, "failed");
  assert.equal(rec.finishes[2].result.error, "the database is asleep");
});

test("withJobRun: when the row can't be written the job still runs and answers; nothing is finished", async () => {
  const rec = fakeRecorder({ fail: true });
  const handler = withJobRun("digests", async () => Response.json({ sent: 1 }), { recorder: rec, secret: () => SECRET });
  const res = await handler(request());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: 1 });
  assert.equal(rec.starts.length, 1);
  assert.deepEqual(rec.finishes, []);
});

test("supabaseRecorder: inserts the running row, updates it with the outcome, purges rows older than the keep window; a client that can't be made means no recording and no throw", async () => {
  const calls: unknown[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: unknown) {
          calls.push(["insert", table, row]);
          return { select: () => ({ single: async () => ({ data: { id: 7 }, error: null }) }) };
        },
        update(row: unknown) {
          return { eq: async (col: string, v: unknown) => (calls.push(["update", table, row, col, v]), { error: null }) };
        },
        delete() {
          return { lt: async (col: string, v: unknown) => (calls.push(["delete", table, col, v]), { error: null }) };
        },
      };
    },
  };
  const logs: string[] = [];
  const rec = supabaseRecorder({ client: () => client as never, log: (m) => logs.push(m) });
  const id = await rec.start("weekly", "schedule", at("2026-11-01T23:00:00Z"));
  assert.equal(id, 7);
  await rec.finish(7, { status: "ok", httpStatus: 200, summary: { emails: 4 }, error: null, durationMs: 1200, finishedAt: at("2026-11-01T23:00:01.2Z") });
  assert.deepEqual(calls[0], ["insert", "job_runs", { job: "weekly", trigger: "schedule", started_at: "2026-11-01T23:00:00.000Z", status: "running" }]);
  assert.deepEqual(calls[1], ["update", "job_runs", { status: "ok", http_status: 200, summary: { emails: 4 }, error: null, duration_ms: 1200, finished_at: "2026-11-01T23:00:01.200Z" }, "id", 7]);
  assert.deepEqual(calls[2], ["delete", "job_runs", "started_at", new Date(at("2026-11-01T23:00:01.2Z").getTime() - KEEP_DAYS * 86_400_000).toISOString()]);
  assert.equal(logs.length, 0);

  const none = supabaseRecorder({
    client: () => {
      throw new Error("Supabase is not configured");
    },
    log: (m) => logs.push(m),
  });
  assert.equal(await none.start("weekly", "manual", at("2026-11-01T23:00:00Z")), null);
  await none.finish(1, { status: "ok", httpStatus: 200, summary: {}, error: null, durationMs: 0, finishedAt: at("2026-11-01T23:00:00Z") });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /not recording/);
});

test("static: every cron route exports GET and POST through withJobRun with its own job id", () => {
  for (const job of JOBS.filter((j) => j.runner === "vercel")) {
    const src = read(join("app", job.path!, "route.ts"));
    assert.match(src, new RegExp(`withJobRun\\("${job.id}", run\\)`), `${job.path} records as ${job.id}`);
    assert.match(src, /export const GET = recorded;/);
    assert.match(src, /export const POST = recorded;/);
    assert.doesNotMatch(src, /export const (GET|POST) = run;/);
  }
});

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

test("relativeLabel: minutes, hours, days, months, either way; a day is tomorrow or yesterday", () => {
  const now = at("2026-11-01T12:00:00Z");
  assert.equal(relativeLabel(at("2026-11-01T12:00:20Z"), now), "now");
  assert.equal(relativeLabel(at("2026-11-01T12:05:00Z"), now), "in 5 min");
  assert.equal(relativeLabel(at("2026-11-01T15:00:00Z"), now), "in 3 h");
  assert.equal(relativeLabel(at("2026-10-31T12:00:00Z"), now), "yesterday");
  assert.equal(relativeLabel(at("2026-11-02T13:00:00Z"), now), "tomorrow");
  assert.equal(relativeLabel(at("2026-11-04T12:00:00Z"), now), "in 3 days");
  assert.equal(relativeLabel(at("2026-08-01T12:00:00Z"), now), "3 months ago");
});

test("summaryLine shows counts and list lengths, not flags or nested objects; storedOutcome has the four words", () => {
  assert.equal(summaryLine({ configured: true, consents: 12, sent: 3, errors: 0 }), "consents 12 · sent 3 · errors 0");
  assert.equal(summaryLine({ configured: true, publishes: [{}, {}] }), "publishes 2");
  assert.equal(summaryLine({ configured: false, snapshotsDeleted: null, note: "x", nested: { a: 1 } }), "");
  assert.equal(summaryLine(null), "");
  assert.deepEqual(storedOutcome("running"), { label: "Running", tone: "running" });
  assert.deepEqual(storedOutcome("ok"), { label: "Succeeded", tone: "ok" });
  assert.deepEqual(storedOutcome("failed"), { label: "Failed", tone: "failed" });
  assert.deepEqual(storedOutcome("skipped"), { label: "Nothing to do", tone: "other" });
});

test("sortJobs: scheduled first by next run, then the hand-run ones by name; URLs and run ids", () => {
  const job = (id: string, name: string) => ({ id, name }) as (typeof JOBS)[number];
  const rows = [
    { job: job("b", "Beta"), next: null },
    { job: job("c", "Gamma"), next: at("2026-11-02T00:00:00Z") },
    { job: job("a", "Alpha"), next: null },
    { job: job("d", "Delta"), next: at("2026-11-01T00:00:00Z") },
  ];
  assert.deepEqual(sortJobs(rows).map((r) => r.job.id), ["d", "c", "a", "b"]);
  assert.equal(jobHref({ id: "digests" }), "/admin/jobs/digests");
  assert.equal(runHref({ id: "digests" }, 12), "/admin/jobs/digests/runs/12");
  assert.equal(parseRunId("12"), 12);
  assert.equal(parseRunId("0"), null);
  assert.equal(parseRunId("12a"), null);
  assert.equal(parseRunId("1234567890123456"), null);
});

test("lastOutcome: one word per last run across both runners; counts and the failures-first order for the all-jobs view", () => {
  const stored = (status: "running" | "ok" | "failed" | "skipped") => ({ kind: "stored" as const, run: { status } });
  const github = (status: string, conclusion: string | null) => ({ kind: "github" as const, run: { status, conclusion } });
  assert.deepEqual(lastOutcome(null), { key: "none", label: "No run recorded", tone: "other" });
  assert.equal(lastOutcome(stored("failed")).key, "failed");
  assert.equal(lastOutcome(stored("skipped")).key, "other");
  assert.equal(lastOutcome(stored("running")).key, "running");
  assert.equal(lastOutcome(github("completed", "failure")).key, "failed");
  assert.equal(lastOutcome(github("completed", "timed_out")).key, "failed");
  assert.equal(lastOutcome(github("completed", "cancelled")).key, "other");
  assert.equal(lastOutcome(github("in_progress", null)).key, "running");
  assert.deepEqual(lastOutcome(github("completed", "success")), { key: "ok", label: "Succeeded", tone: "ok" });

  const job = (id: string, name: string) => ({ id, name }) as (typeof JOBS)[number];
  const rows = [
    { job: job("a", "Alpha"), last: stored("ok") },
    { job: job("b", "Beta"), last: github("completed", "failure") },
    { job: job("c", "Gamma"), last: null },
    { job: job("d", "Delta"), last: stored("failed") },
    { job: job("e", "Epsilon"), last: github("queued", null) },
    { job: job("f", "Zeta"), last: stored("skipped") },
  ];
  assert.deepEqual(outcomeCounts(rows), { failed: 2, running: 1, none: 1, other: 1, ok: 1 });
  assert.deepEqual(sortJobsByOutcome(rows).map((r) => r.job.id), ["b", "d", "e", "c", "f", "a"]);
  assert.deepEqual(outcomeCounts([]), { failed: 0, running: 0, none: 0, other: 0, ok: 0 });

  assert.equal(parseJobsView("all"), "all");
  assert.equal(parseJobsView(["all"]), "all");
  assert.equal(parseJobsView(undefined), "schedule");
  assert.equal(parseJobsView("nope"), "schedule");
  assert.equal(jobsViewHref("all"), "/admin/jobs?view=all");
  assert.equal(jobsViewHref("schedule"), "/admin/jobs");
});

/* ------------------------------------------------------------------ */
/* The pages                                                           */
/* ------------------------------------------------------------------ */

test("static: the Jobs pages call requireAdmin() before reading; the run page checks the run belongs to the job's workflow", () => {
  for (const p of ["app/admin/jobs/page.tsx", "app/admin/jobs/[job]/page.tsx", "app/admin/jobs/[job]/runs/[run]/page.tsx"]) {
    const src = read(p);
    const guard = src.indexOf("await requireAdmin()");
    assert.ok(guard > 0, `${p} calls requireAdmin()`);
    for (const reader of ["loadJobsOverview(", "storedRuns(", "githubRuns(", "storedRun(", "githubRunDetail("]) {
      const i = src.indexOf(reader);
      if (i >= 0) assert.ok(i > guard, `${p}: ${reader} after the guard`);
    }
  }
  const runs = read("lib/jobs/runs.ts");
  assert.match(runs, /run\.workflow !== job\.workflow\) return null/);
  assert.match(runs, /\.eq\("job", job\)\.eq\("id", id\)/); // a stored run is read under its job, never by id alone
});

test("static: the migration gives admins a read policy and nobody else; the recorder is the only writer (the secret key)", () => {
  const sql = read("supabase/migrations/20261101120000_job_runs.sql");
  assert.match(sql, /create table public\.job_runs/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /create policy "Admins read" on public\.job_runs for select to authenticated using \(\(select public\.admin_reads\(\)\)\)/);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/);
  assert.match(sql, /revoke all on public\.job_runs from anon/);
  assert.match(sql, /check \(status in \('running', 'ok', 'failed', 'skipped'\)\)/);
});
