/**
 * The admin console's GitHub side (specs/product/admin.md, "Operations: reruns and approvals"): the client
 * (lib/github-app.ts) with a fake `fetch` (no network: the global fetch throws), the dispatchable-runs table
 * (lib/admin/workflows.ts) against the workflow files themselves, and the held review items' Accept mapping
 * (lib/admin/review-queue.ts `acceptPlan`) against the field registry an admin edit must stay inside. The console's
 * old write path (a branch, a commit and a PR per review action) is gone: Accept and Reject act on the data store
 * (tests/admin-ops.test.mts, tests/admin-data.test.mts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { editProblem } from "../lib/data-platform/edits.ts";
import { enqueueItems, type ReviewItem } from "../lib/reported.ts";
import {
  DISPATCHABLE_FILES,
  DISPATCHABLE_RUNS,
  FULL_RUN_MIN_COLLEGES,
  blockingRun,
  buildDispatch,
  lastFullRunCost,
  runById,
} from "../lib/admin/workflows.ts";
import { acceptNote, acceptPlan, queueRows, siblingKeys } from "../lib/admin/review-queue.ts";

// lib/github-app.ts starts with `import "server-only"`, which only Next.js resolves; stand in an empty module.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});
const gh = await import("../lib/github-app.ts");

// No network anywhere in this file: every call must go through an injected fetch.
globalThis.fetch = (() => {
  throw new Error("network call in a test");
}) as typeof fetch;

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const API = "https://api.github.com";
const REPO = `${API}/repos/raywross/college-stats`;
const NOW = Date.parse("2026-10-12T15:00:00Z");
const TODAY = "2026-10-12";
const REQ = "0f8c2d1e-4b5a-4c3d-9e8f-123456789abc";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const APP_ENV = { GITHUB_APP_ID: "123456", GITHUB_APP_INSTALLATION_ID: "7890", GITHUB_APP_PRIVATE_KEY: privateKey };
const PAT_ENV = { GITHUB_TOKEN: "github_pat_test" };

/* ------------------------------------------------------------------ */
/* A fake GitHub                                                       */
/* ------------------------------------------------------------------ */

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}
type Route = (call: Call) => { status: number; body?: unknown; text?: string } | undefined;

function fakeGithub(route: Route) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { method: init?.method ?? "GET", url: String(url), headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url.endsWith("/access_tokens")) {
      return new Response(JSON.stringify({ token: `ghs_${calls.filter((c) => c.url.endsWith("/access_tokens")).length}`, expires_at: new Date(NOW + 3600_000).toISOString() }), { status: 201 });
    }
    const r = route(call);
    if (!r) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    if (r.status === 204) return new Response(null, { status: 204 });
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { calls, fetch: fetchImpl, api: () => calls.filter((c) => !c.url.endsWith("/access_tokens")) };
}

function deps(f: { fetch: typeof fetch }, env: Record<string, string> = APP_ENV, now = () => NOW) {
  return { env, fetch: f.fetch, now, log: () => undefined };
}

/* ------------------------------------------------------------------ */
/* Configuration and the App JWT                                       */
/* ------------------------------------------------------------------ */

test("githubConfigured: the App with all three variables, else a PAT, else null; GITHUB_REPO defaults", () => {
  assert.deepEqual(gh.githubConfigured(APP_ENV), { mode: "app" });
  assert.deepEqual(gh.githubConfigured({ ...PAT_ENV, ...APP_ENV }), { mode: "app" });
  assert.deepEqual(gh.githubConfigured({ ...PAT_ENV, GITHUB_APP_ID: "1" }), { mode: "pat" });
  assert.equal(gh.githubConfigured({ GITHUB_APP_ID: "1", GITHUB_APP_INSTALLATION_ID: "2" }), null);
  assert.equal(gh.githubConfigured({}), null);
  assert.equal(gh.githubRepo({}), "raywross/college-stats");
  assert.equal(gh.githubRepo({ GITHUB_REPO: "someone/fork" }), "someone/fork");
  assert.equal(gh.githubRepo({ GITHUB_REPO: "not a repo" }), "raywross/college-stats");
});

test("appJwt: RS256, issued a minute back, expiring in nine minutes, issuer the App id, verifiable with the public key", () => {
  const jwt = gh.appJwt("123456", privateKey, NOW);
  const [h, p, s] = jwt.split(".");
  assert.equal(jwt.split(".").length, 3);
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const now = Math.floor(NOW / 1000);
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url").toString()), { iat: now - 60, exp: now + 540, iss: "123456" });
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${p}`);
  assert.ok(v.verify(publicKey, Buffer.from(s, "base64url")), "signature verifies");
  // A tampered payload does not.
  const v2 = createVerify("RSA-SHA256");
  v2.update(`${h}.${Buffer.from(JSON.stringify({ iat: now, exp: now + 99999, iss: "123456" })).toString("base64url")}`);
  assert.equal(v2.verify(publicKey, Buffer.from(s, "base64url")), false);
});

test("normalizePrivateKey: real newlines, \\n-escaped (as Vercel stores it), or base64 of the PEM", () => {
  const escaped = privateKey.replace(/\n/g, "\\n");
  assert.equal(gh.normalizePrivateKey(escaped), privateKey.trim());
  assert.equal(gh.normalizePrivateKey(privateKey), privateKey.trim());
  assert.equal(gh.normalizePrivateKey(Buffer.from(privateKey).toString("base64")), privateKey.trim());
  assert.throws(() => gh.normalizePrivateKey("nonsense"));
  // Each form signs the same JWT.
  assert.equal(gh.appJwt("1", escaped, NOW), gh.appJwt("1", privateKey, NOW));
});

test("installation token: minted once with the JWT, scoped to the repo, cached until five minutes before it expires", async () => {
  gh.resetTokenCache();
  const f = fakeGithub(() => ({ status: 200, body: { workflow_runs: [] } }));
  let now = NOW;
  const d = deps(f, APP_ENV, () => now);
  await gh.listRuns({ workflows: ["verify.yml"] }, d);
  await gh.listRuns({ workflows: ["verify.yml"] }, d);
  const mints = f.calls.filter((c) => c.url.endsWith("/access_tokens"));
  assert.equal(mints.length, 1, "the second call reuses the cached token");
  assert.equal(mints[0].url, `${API}/app/installations/7890/access_tokens`);
  assert.equal(mints[0].method, "POST");
  assert.match(mints[0].headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, "the JWT");
  assert.deepEqual(mints[0].body, { repositories: ["college-stats"] });
  for (const c of f.api()) assert.equal(c.headers.Authorization, "Bearer ghs_1");

  now = NOW + 3600_000 - gh.TOKEN_REFRESH_MARGIN_MS + 1; // inside the refresh margin
  await gh.listRuns({ workflows: ["verify.yml"] }, d);
  assert.equal(f.calls.filter((c) => c.url.endsWith("/access_tokens")).length, 2, "re-minted near expiry");
  assert.equal(f.api().at(-1)!.headers.Authorization, "Bearer ghs_2");
});

test("installation token: a 401 drops the cached token so the next call mints a new one", async () => {
  gh.resetTokenCache();
  let status = 401;
  const f = fakeGithub(() => ({ status, body: { workflow_runs: [] } }));
  assert.deepEqual(await gh.listRuns({ workflows: ["verify.yml"] }, deps(f)), []);
  status = 200;
  await gh.listRuns({ workflows: ["verify.yml"] }, deps(f));
  assert.equal(f.calls.filter((c) => c.url.endsWith("/access_tokens")).length, 2);
});

test("PAT mode: no token exchange, the PAT is the bearer token", async () => {
  gh.resetTokenCache();
  const f = fakeGithub(() => ({ status: 200, body: { workflow_runs: [] } }));
  await gh.listRuns({ workflows: ["verify.yml"] }, deps(f, PAT_ENV));
  assert.equal(f.calls.filter((c) => c.url.endsWith("/access_tokens")).length, 0);
  assert.equal(f.calls[0].headers.Authorization, "Bearer github_pat_test");
  assert.equal(f.calls[0].headers["X-GitHub-Api-Version"], "2022-11-28");
});

test("unconfigured: every call returns its empty or not_configured result without a request", async () => {
  const f = fakeGithub(() => ({ status: 200 }));
  const d = deps(f, {});
  assert.deepEqual(await gh.dispatchWorkflow("verify.yml", {}, REQ, d), { ok: false, reason: "not_configured" });
  assert.deepEqual(await gh.listRuns({ workflows: ["verify.yml"] }, d), []);
  assert.equal(await gh.findRunByRequestId(REQ, d), null);
  assert.deepEqual(await gh.listDataPulls(d), []);
  assert.equal((await gh.mergePull(1, d)).ok, false);
  assert.equal((await gh.holdPull(1, "Ray", d)).ok, false);
  assert.equal((await gh.closePull(1, "Ray", d)).ok, false);
  assert.equal((await gh.readRepoFile("data/overrides.json", d)).ok, false);
  assert.equal(f.calls.length, 0);
});

test("nothing throws into a page: a network failure comes back as a result", async () => {
  gh.resetTokenCache();
  const boom = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const d = { env: PAT_ENV, fetch: boom, log: () => undefined };
  assert.deepEqual(await gh.dispatchWorkflow("verify.yml", {}, REQ, d), { ok: false, reason: "ECONNRESET" });
  assert.deepEqual(await gh.listRuns({ workflows: ["verify.yml"] }, d), []);
  assert.deepEqual(await gh.mergePull(3, d), { ok: false, reason: "error", detail: "ECONNRESET" });
  assert.equal((await gh.readRepoFile("data/reports", d)).ok, false);
});

/* ------------------------------------------------------------------ */
/* Dispatch and runs                                                   */
/* ------------------------------------------------------------------ */

test("dispatchWorkflow: POST …/actions/workflows/{file}/dispatches on main with the inputs and request_id", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => (c.url.endsWith("/dispatches") ? { status: 204 } : undefined));
  const r = await gh.dispatchWorkflow("college-reported.yml", { mode: "college", college: "166027" }, REQ, deps(f));
  assert.deepEqual(r, { ok: true });
  const [call] = f.api();
  assert.equal(call.method, "POST");
  assert.equal(call.url, `${REPO}/actions/workflows/college-reported.yml/dispatches`);
  assert.deepEqual(call.body, { ref: "main", inputs: { mode: "college", college: "166027", request_id: REQ } });
});

test("dispatchWorkflow: every run in the table sends request_id, Re-run CI on the PR's branch", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => (c.url.endsWith("/dispatches") ? { status: 204 } : undefined));
  for (const run of DISPATCHABLE_RUNS) {
    const values = run.inputs.some((i) => i.kind === "unit") ? { college: "166027" } : {};
    const built = buildDispatch(run.id, values, { confirm: run.guards.confirmWord, branch: "data/college-reported-20261011-102854-53" });
    assert.ok(built.ok, `${run.id}: ${built.ok ? "" : built.errors.join("; ")}`);
    if (!built.ok) continue;
    const r = await gh.dispatchWorkflow(built.file, built.inputs, REQ, { ...deps(f), ref: built.ref });
    assert.deepEqual(r, { ok: true }, run.id);
    const call = f.api().at(-1)!;
    const body = call.body as { ref: string; inputs: Record<string, string> };
    assert.equal(body.inputs.request_id, REQ, `${run.id} sends request_id`);
    assert.equal(body.ref, run.ref === "main" ? "main" : "data/college-reported-20261011-102854-53");
    assert.ok(call.url.endsWith(`/actions/workflows/${run.workflow}/dispatches`));
    for (const v of Object.values(body.inputs)) assert.equal(typeof v, "string");
  }
  assert.equal(f.api().length, DISPATCHABLE_RUNS.length);
});

test("dispatchWorkflow refuses a workflow outside the table, a bad request id, a reserved input, and a bad ref, without a request", async () => {
  const f = fakeGithub(() => ({ status: 204 }));
  const d = deps(f, PAT_ENV);
  assert.deepEqual(await gh.dispatchWorkflow("campus-pilot.yml", {}, REQ, d), { ok: false, reason: "not_dispatchable" });
  assert.deepEqual(await gh.dispatchWorkflow("verify.yml", {}, "x y", d), { ok: false, reason: "bad_request_id" });
  assert.deepEqual(await gh.dispatchWorkflow("verify.yml", { request_id: "mine" }, REQ, d), { ok: false, reason: "request_id_is_reserved" });
  assert.deepEqual(await gh.dispatchWorkflow("verify.yml", {}, REQ, { ...d, ref: "../evil" }), { ok: false, reason: "bad_ref" });
  assert.equal(f.calls.length, 0);
  // GitHub's own refusal is passed through.
  const g = fakeGithub(() => ({ status: 422, body: { message: "Unexpected inputs provided" } }));
  assert.deepEqual(await gh.dispatchWorkflow("verify.yml", {}, REQ, deps(g, PAT_ENV)), { ok: false, reason: "dispatch 422: Unexpected inputs provided" });
});

const RAW_RUN = {
  id: 11,
  name: "College-reported data",
  display_title: `College-reported data · ${REQ}`,
  run_number: 54,
  event: "workflow_dispatch",
  status: "completed",
  conclusion: "success",
  path: ".github/workflows/college-reported.yml",
  created_at: "2026-10-12T10:00:00Z",
  run_started_at: "2026-10-12T10:00:05Z",
  updated_at: "2026-10-12T11:00:05Z",
  html_url: "https://github.com/raywross/college-stats/actions/runs/11",
  actor: { login: "quad-console[bot]" },
  head_branch: "main",
};

test("listRuns: each workflow's runs, merged newest first, with the request id, duration, and actor", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => {
    if (c.url.includes("/workflows/college-reported.yml/runs")) return { status: 200, body: { workflow_runs: [RAW_RUN] } };
    if (c.url.includes("/workflows/verify.yml/runs"))
      return { status: 200, body: { workflow_runs: [{ ...RAW_RUN, id: 12, name: "Verify", display_title: "Admin console: GitHub client", event: "pull_request", status: "in_progress", conclusion: null, created_at: "2026-10-12T12:00:00Z", path: ".github/workflows/verify.yml" }] } };
    return undefined;
  });
  const runs = await gh.listRuns({ workflows: ["college-reported.yml", "verify.yml"], perPage: 10 }, deps(f, PAT_ENV));
  assert.deepEqual(
    f.api().map((c) => c.url),
    [`${REPO}/actions/workflows/college-reported.yml/runs?per_page=10`, `${REPO}/actions/workflows/verify.yml/runs?per_page=10`],
  );
  assert.deepEqual(runs.map((r) => r.id), [12, 11]);
  const [verify, college] = runs;
  assert.equal(verify.requestId, null);
  assert.equal(verify.durationMs, null, "still running");
  assert.equal(college.workflow, "college-reported.yml");
  assert.equal(college.requestId, REQ);
  assert.equal(college.durationMs, 3600_000);
  assert.equal(college.actor, "quad-console[bot]");
  assert.equal(college.runNumber, 54);
});

test("findRunByRequestId: dispatched runs, matched on the run-name's request id", async () => {
  gh.resetTokenCache();
  const other = { ...RAW_RUN, id: 10, display_title: "College-reported data · 11111111-2222-3333-4444-555555555555" };
  const f = fakeGithub((c) => (c.url.includes("/actions/runs?") ? { status: 200, body: { workflow_runs: [other, RAW_RUN] } } : undefined));
  const run = await gh.findRunByRequestId(REQ, deps(f, PAT_ENV));
  assert.equal(f.api()[0].url, `${REPO}/actions/runs?event=workflow_dispatch&per_page=50`);
  assert.equal(run?.id, 11);
  assert.equal(await gh.findRunByRequestId("99999999-0000-0000-0000-000000000000", deps(f, PAT_ENV)), null);
});

test("failedStep: the failed job and step", async () => {
  const f = fakeGithub(() => ({
    status: 200,
    body: { jobs: [{ name: "run", conclusion: "failure", steps: [{ name: "Checkout", conclusion: "success" }, { name: "Run the ingestion pipeline", conclusion: "failure" }] }] },
  }));
  assert.equal(await gh.failedStep(11, deps(f, PAT_ENV)), "run / Run the ingestion pipeline");
  assert.equal(f.calls[0].url, `${REPO}/actions/runs/11/jobs?filter=latest`);
});

/* ------------------------------------------------------------------ */
/* Pull requests                                                       */
/* ------------------------------------------------------------------ */

function pull(n: number, ref: string, extra: Record<string, unknown> = {}) {
  return { number: n, title: `PR ${n}`, body: "", draft: false, auto_merge: null, html_url: `https://github.com/raywross/college-stats/pull/${n}`, created_at: "2026-10-12T00:00:00Z", user: { login: "college-reported-bot" }, head: { ref, sha: `sha${n}`, repo: { full_name: "raywross/college-stats" } }, base: { ref: "main" }, node_id: `PR_${n}`, state: "open", ...extra };
}

type CheckFixture = { runs: { status: string; conclusion: string | null }[]; statuses: { state: string }[] };
function checksRoute(fixtures: Record<string, CheckFixture>): Route {
  return (c) => {
    const m = c.url.match(/\/commits\/(\w+)\/(check-runs|status)/);
    if (!m) return undefined;
    const fx = fixtures[m[1]] ?? { runs: [], statuses: [] };
    return { status: 200, body: m[2] === "check-runs" ? { check_runs: fx.runs } : { statuses: fx.statuses } };
  };
}

test("combineChecks: failed beats pending beats success; nothing started is none", () => {
  assert.equal(gh.combineChecks([], []), "none");
  assert.equal(gh.combineChecks([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }], [{ state: "success" }]), "success");
  assert.equal(gh.combineChecks([{ status: "in_progress", conclusion: null }], []), "pending");
  assert.equal(gh.combineChecks([{ status: "completed", conclusion: "success" }], [{ state: "pending" }]), "pending");
  assert.equal(gh.combineChecks([{ status: "in_progress", conclusion: null }, { status: "completed", conclusion: "failure" }], []), "failure");
  assert.equal(gh.combineChecks([{ status: "completed", conclusion: "cancelled" }], []), "failure");
  assert.equal(gh.combineChecks([], [{ state: "error" }]), "failure");
});

test("isConsolePull: a fork's PR with a data/ branch is never listed, merged, held, or closed", () => {
  const ours = pull(9, "data/college-reported-20261012-010101-7");
  assert.equal(gh.isConsolePull(ours), true);
  const fork = { ...ours, head: { ...ours.head, repo: { full_name: "someone/college-stats" } } };
  assert.equal(gh.isConsolePull(fork), false, "same branch name, other repository");
  assert.equal(gh.isConsolePull({ ...ours, head: { ref: ours.head.ref, sha: "x" } }), false, "no head repository: refused");
  assert.equal(gh.isConsolePull({ ...ours, head: { ...ours.head, repo: { full_name: "RayWRoss/College-Stats" } } }), true, "case doesn't matter");
  assert.equal(gh.isConsolePull({ ...ours, base: { ref: "other" } }), false, "only PRs into main");
  assert.equal(gh.isConsolePull(pull(10, "feature/x")), false, "only data/ and review/ branches");
  assert.equal(gh.isConsolePull(ours, { GITHUB_REPO: "elsewhere/repo" }), false, "the configured repository decides");
});

test("listDataPulls: open PRs on main from data/ or review/ branches, with checks, flagged ones first", async () => {
  gh.resetTokenCache();
  const pulls = [
    pull(140, "feature/something"),
    pull(141, "data/college-reported-20261011-102854-53", { body: "## Circuit breaker\n\n**Tripped:** 18 of 77 colleges failed", auto_merge: null }),
    pull(142, "data/identity-refresh-20261012", { auto_merge: { merge_method: "squash" } }),
    pull(143, "review/100706-c-116-2026-10-12"),
  ];
  const checks = checksRoute({
    sha141: { runs: [{ status: "completed", conclusion: "success" }], statuses: [] },
    sha142: { runs: [{ status: "queued", conclusion: null }], statuses: [] },
  });
  const f = fakeGithub((c) => (c.url.includes("/pulls?") ? { status: 200, body: pulls } : checks(c)));
  const list = await gh.listDataPulls(deps(f, PAT_ENV));
  assert.equal(f.api()[0].url, `${REPO}/pulls?state=open&base=main&per_page=100`);
  assert.deepEqual(list.map((p) => p.number), [141, 143, 142]);
  const [breaker, review, identity] = list;
  assert.equal(breaker.flagged, "breaker");
  assert.equal(breaker.runNumber, 53);
  assert.equal(breaker.checks, "success");
  assert.equal(review.kind, "review");
  assert.equal(review.checks, "none");
  assert.equal(identity.autoMerge, true);
  assert.equal(identity.checks, "pending");
  assert.equal(gh.pullFlag("> **Stopped early** after 3 of 90 colleges"), "stopped");
  // The run that opened a PR.
  assert.equal(gh.pullForRun(gh.toRun({ ...RAW_RUN, run_number: 53 }), list)?.number, 141);
  assert.equal(gh.pullForRun(gh.toRun({ ...RAW_RUN, path: ".github/workflows/identity-refresh.yml", created_at: "2026-10-12T06:00:00Z" }), list)?.number, 142);
});

function mergeFixture(checks: CheckFixture, extra: Record<string, unknown> = {}, ref = "data/college-reported-20261011-102854-53") {
  const route = checksRoute({ sha7: checks });
  return fakeGithub((c) => {
    if (c.method === "GET" && c.url === `${REPO}/pulls/7`) return { status: 200, body: pull(7, ref, extra) };
    if (c.method === "PUT" && c.url === `${REPO}/pulls/7/merge`) return { status: 200, body: { merged: true } };
    return route(c);
  });
}

test("mergePull: squash-merges at the head sha once every check passed", async () => {
  gh.resetTokenCache();
  const f = mergeFixture({ runs: [{ status: "completed", conclusion: "success" }], statuses: [{ state: "success" }] });
  assert.deepEqual(await gh.mergePull(7, deps(f, PAT_ENV)), { ok: true });
  const put = f.api().find((c) => c.method === "PUT")!;
  assert.equal(put.url, `${REPO}/pulls/7/merge`);
  assert.deepEqual(put.body, { merge_method: "squash", sha: "sha7" });
});

test("mergePull refuses while checks are pending, never started, or failed (and never calls merge)", async () => {
  for (const [fx, reason] of [
    [{ runs: [{ status: "in_progress", conclusion: null }], statuses: [] }, "checks_pending"],
    [{ runs: [], statuses: [] }, "checks_pending"],
    [{ runs: [{ status: "completed", conclusion: "success" }], statuses: [{ state: "pending" }] }, "checks_pending"],
    [{ runs: [{ status: "completed", conclusion: "failure" }], statuses: [] }, "checks_failed"],
    [{ runs: [{ status: "completed", conclusion: "success" }], statuses: [{ state: "failure" }] }, "checks_failed"],
  ] as const) {
    const f = mergeFixture(fx as unknown as CheckFixture);
    assert.deepEqual(await gh.mergePull(7, deps(f, PAT_ENV)), { ok: false, reason }, JSON.stringify(fx));
    assert.equal(f.api().filter((c) => c.method === "PUT").length, 0);
  }
  // Only console PRs: a feature branch, a draft.
  const feature = mergeFixture({ runs: [{ status: "completed", conclusion: "success" }], statuses: [] }, {}, "feature/x");
  assert.equal((await gh.mergePull(7, deps(feature, PAT_ENV))).ok, false);
  const draft = mergeFixture({ runs: [{ status: "completed", conclusion: "success" }], statuses: [] }, { draft: true });
  assert.deepEqual(await gh.mergePull(7, deps(draft, PAT_ENV)), { ok: false, reason: "error", detail: "draft" });
  assert.equal(feature.api().filter((c) => c.method === "PUT").length + draft.api().filter((c) => c.method === "PUT").length, 0);
});

test("holdPull: auto-merge off through GraphQL, then a comment naming who held it", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => {
    if (c.url === `${REPO}/pulls/7`) return { status: 200, body: pull(7, "data/identity-refresh-20261012", { auto_merge: { merge_method: "squash" } }) };
    if (c.url === `${API}/graphql`) return { status: 200, body: { data: {} } };
    if (c.url === `${REPO}/issues/7/comments`) return { status: 201, body: {} };
    return undefined;
  });
  assert.deepEqual(await gh.holdPull(7, "Ray @someone", deps(f, PAT_ENV)), { ok: true });
  const [, graphql, comment] = f.api();
  assert.match((graphql.body as { query: string }).query, /disablePullRequestAutoMerge/);
  assert.deepEqual((graphql.body as { variables: unknown }).variables, { id: "PR_7" });
  assert.equal(comment.method, "POST");
  assert.match((comment.body as { body: string }).body, /^Held by Ray someone from the admin console/, "no @mention");
});

test("closePull: a comment, then the PR closed", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => {
    if (c.method === "GET" && c.url === `${REPO}/pulls/7`) return { status: 200, body: pull(7, "review/100706-c-116-2026-10-12") };
    if (c.url === `${REPO}/issues/7/comments`) return { status: 201, body: {} };
    if (c.method === "PATCH" && c.url === `${REPO}/pulls/7`) return { status: 200, body: {} };
    return undefined;
  });
  assert.deepEqual(await gh.closePull(7, "Ray", deps(f, PAT_ENV)), { ok: true });
  const [, comment, patch] = f.api();
  assert.equal((comment.body as { body: string }).body, "Closed by Ray from the admin console.");
  assert.deepEqual(patch.body, { state: "closed" });
});

/* ------------------------------------------------------------------ */
/* Files and the review-queue PR                                       */
/* ------------------------------------------------------------------ */

test("readRepoFile: a small file from its base64 content, a large one through the raw media type", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => {
    if (c.url.includes("overrides.json")) return { status: 200, body: { sha: "abc", encoding: "base64", content: Buffer.from('{"a":1}').toString("base64") } };
    if (c.url.includes("review-queue.json") && c.headers.Accept === "application/vnd.github.object+json") return { status: 200, body: { sha: "def", encoding: "none", content: "", size: 12_000_000 } };
    if (c.url.includes("review-queue.json")) return { status: 200, text: '{"items":[]}' };
    return undefined;
  });
  assert.deepEqual(await gh.readRepoFile("data/overrides.json", deps(f, PAT_ENV)), { ok: true, content: '{"a":1}', sha: "abc" });
  assert.deepEqual(await gh.readRepoFile("data/review-queue.json", deps(f, PAT_ENV)), { ok: true, content: '{"items":[]}', sha: "def" });
  assert.equal(f.calls[0].url, `${REPO}/contents/data/overrides.json?ref=main`);
  assert.equal(f.calls.at(-1)!.headers.Accept, "application/vnd.github.raw+json");
});

/** A per-item C1 trio from one CDS, as the round-3 pipeline queues it. */
function c1Item(code: string, value: number, over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    unit_id: "999001",
    name: "Example College",
    urls: ["https://www.example.edu/ir/cds-2025-2026.pdf"],
    entering_term: "Fall 2025",
    failures: [{ check: "residency-sum", detail: "applied by residency sums to 15,912, C1 total C.116 is 7,956 (more than 1%)" }],
    queued: "2026-10-11",
    run: "20261011-024817-48",
    code,
    edition: "2025-26",
    sha256: "a".repeat(64),
    value,
    ...over,
  };
}
const TRIO = [c1Item("C.116", 7956), c1Item("C.117", 5006), c1Item("C.118", 1040)];

test("the console's write path is gone: no commit, branch, or PR helpers, and no writable paths", async () => {
  for (const name of ["commitFileAndOpenPull", "WRITABLE_PATHS", "isWritablePath", "PR_NUMBER_PLACEHOLDER"]) assert.ok(!(name in gh), `lib/github-app.ts no longer exports ${name}`);
  const src = read("lib/github-app.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const writes = /"PUT", `\/contents|"POST", `\/git\/refs`|enablePullRequestAutoMerge|"POST", `\/pulls`/;
  assert.doesNotMatch(src, writes, "nothing creates a branch, writes a file, opens a PR, or turns on auto-merge (merging an open PR stays)");
  // The guard fails when the rule is broken: the old commit call would match.
  assert.match('const put = await api(deps, "PUT", `/contents/${path}`)', writes);
});

/* ------------------------------------------------------------------ */
/* The dispatchable runs table                                         */
/* ------------------------------------------------------------------ */

/** The workflow_dispatch input names a workflow file declares (two-space YAML, as the repo writes it). */
function dispatchInputs(yml: string): Map<string, string> {
  const block = yml.match(/\n  workflow_dispatch:\n    inputs:\n((?: {6,}.*\n|\s*\n)+)/);
  const out = new Map<string, string>();
  if (!block) return out;
  for (const m of block[1].matchAll(/^ {6}([a-z_]+):\n((?: {8,}.*\n)*)/gm)) out.set(m[1], m[2]);
  return out;
}

/** What the console needs from a dispatchable workflow file; empty when it's all there. */
function workflowProblems(yml: string, names: readonly string[]): string[] {
  const problems: string[] = [];
  const inputs = dispatchInputs(yml);
  const req = inputs.get("request_id");
  if (!req) problems.push("no request_id input");
  else if (!/default: ""/.test(req) || !/type: string/.test(req)) problems.push('request_id must be an optional string defaulting to ""');
  if (!/^run-name: .*inputs\.request_id.*$/m.test(yml)) problems.push("run-name doesn't carry inputs.request_id");
  for (const n of names) if (!inputs.has(n)) problems.push(`no input "${n}"`);
  return problems;
}

test("every dispatchable workflow declares request_id (optional, default '') and puts it in run-name, plus every input the table sends", () => {
  for (const file of DISPATCHABLE_FILES) {
    const names = new Set(DISPATCHABLE_RUNS.filter((r) => r.workflow === file).flatMap((r) => [...Object.keys(r.fixed), ...r.inputs.map((i) => i.name)]));
    assert.deepEqual(workflowProblems(read(`.github/workflows/${file}`), [...names]), [], file);
  }
  // The guard fails when the rule is broken.
  const yml = read(".github/workflows/identity-refresh.yml");
  assert.deepEqual(workflowProblems(yml.replace(/\n      request_id:\n(?: {8}.*\n)+/, "\n"), []), ["no request_id input"]);
  assert.deepEqual(workflowProblems(yml.replace(/^run-name: .*\n/m, ""), []), ["run-name doesn't carry inputs.request_id"]);
  assert.deepEqual(workflowProblems(yml, ["max_cost"]), ['no input "max_cost"']);
  // Only the table's workflows are dispatchable; the pilots aren't.
  // publish-changes.yml is retired (its jobs are publisher steps): it is no longer dispatchable.
  assert.deepEqual([...DISPATCHABLE_FILES].sort(), ["college-reported.yml", "identity-refresh.yml", "publish-snapshot.yml", "verify.yml", "visit-events.yml"]);
});

test("run-name: the console's title is '<workflow> · <request id>', which requestIdFromTitle reads back", () => {
  const line = read(".github/workflows/verify.yml").match(/^run-name: (.*)$/m)![1];
  assert.match(line, /format\('\{0\} · \{1\}', github\.workflow, inputs\.request_id\)/);
  assert.match(line, /\|\| github\.workflow \}\}"$/, "a scheduled or hand-started run keeps a readable title");
  assert.equal(gh.requestIdFromTitle(`Verify · ${REQ}`), REQ);
  assert.equal(gh.requestIdFromTitle("Admin console: GitHub client"), null);
});

test("buildDispatch: types, defaults, the unit id, the 'all' confirmation, and Re-run CI's branch", () => {
  const college = buildDispatch("college", { college: " 166027 " });
  assert.ok(college.ok);
  if (college.ok) assert.deepEqual(college.inputs, { college: "166027", rediscover: "false", auto_merge: "true", mode: "college" });
  assert.equal(buildDispatch("college", { college: "MIT" }).ok, false);
  assert.equal(buildDispatch("college", {}).ok, false);
  assert.equal(buildDispatch("college", { college: "166027", mode: "all" }).ok, false, "a fixed input can't be overridden");
  assert.equal(buildDispatch("college", { college: "166027", rediscover: "maybe" }).ok, false);

  assert.equal(buildDispatch("all", {}).ok, false, "all needs the word");
  assert.equal(buildDispatch("all", {}, { confirm: "ALL" }).ok, false);
  const all = buildDispatch("all", { auto_merge: false }, { confirm: "all" });
  assert.ok(all.ok);
  if (all.ok) assert.deepEqual(all.inputs, { auto_merge: "false", max_cost: "150", mode: "all" });
  assert.equal(buildDispatch("all", { max_cost: "lots" }, { confirm: "all" }).ok, false);
  assert.ok(runById("all")!.guards.showCost);

  assert.equal(buildDispatch("publish", { what: "high-schools" }).ok, false, "publish-changes.yml's row is retired");
  const publish = buildDispatch("publish-snapshot", {});
  assert.ok(publish.ok && publish.file === "publish-snapshot.yml" && publish.inputs.force === "true");

  assert.equal(buildDispatch("verify", {}).ok, false, "Re-run CI needs the PR's branch");
  assert.equal(buildDispatch("verify", {}, { branch: "main" }).ok, false);
  const verify = buildDispatch("verify", {}, { branch: "data/identity-refresh-20261012" });
  assert.ok(verify.ok && verify.ref === "data/identity-refresh-20261012" && Object.keys(verify.inputs).length === 0);
  assert.equal(buildDispatch("nope", {}).ok, false);
});

test("blockingRun: a queued or running run of the same workflow blocks a one-at-a-time row", () => {
  const runs = [
    { workflow: "identity-refresh.yml", status: "in_progress" },
    { workflow: "college-reported.yml", status: "completed" },
  ];
  assert.equal(blockingRun(runById("college")!, runs), null);
  assert.deepEqual(blockingRun(runById("identity")!, runs), runs[0]);
  assert.deepEqual(blockingRun(runById("pilot")!, [{ workflow: "college-reported.yml", status: "queued" }]), { workflow: "college-reported.yml", status: "queued" });
  assert.equal(blockingRun(runById("verify")!, [{ workflow: "verify.yml", status: "in_progress" }]), null, "no guard on Re-run CI");
  assert.equal(runById("publish"), null, "publish-changes.yml's row is retired");
});

test("fetchRunCost: data/reports/ on main, newest summary first until a full run, then cached by sha", async () => {
  gh.resetTokenCache();
  const names = readdirSync(join(ROOT, "data", "reports"));
  const listing = names.map((name) => ({ name, path: `data/reports/${name}`, sha: `sha-${name}`, type: "file" }));
  const f = fakeGithub((c) => {
    if (c.url === `${REPO}/contents/data/reports?ref=main`) return { status: 200, body: listing };
    const m = c.url.match(/\/contents\/data\/reports\/([^?]+)\?ref=main$/);
    if (m) return { status: 200, body: { sha: `sha-${m[1]}`, encoding: "base64", content: readFileSync(join(ROOT, "data", "reports", m[1])).toString("base64") } };
    return undefined;
  });
  const cost = await gh.fetchRunCost(deps(f, PAT_ENV));
  assert.ok(cost && cost.last);
  const runs = names.filter((n) => /^college-reported-run-.+\.json$/.test(n)).sort().reverse();
  // The newest summary whose scope was every college (`total` at or above the full-run floor), read from the folder
  // rather than pinned, since every scheduled run over the whole dataset adds one (2026-10-28).
  const runOf = (n: string) => n.replace(/^college-reported-run-|\.json$/g, "");
  const fullRun = runs.find((n) => ((JSON.parse(readFileSync(join(ROOT, "data", "reports", n), "utf8")) as { total?: number }).total ?? 0) >= FULL_RUN_MIN_COLLEGES)!;
  assert.ok(fullRun, "a run over every college exists in data/reports");
  assert.equal(cost.last.run, runOf(fullRun), "the newest run over every college");
  assert.ok(cost.last.colleges >= FULL_RUN_MIN_COLLEGES && cost.last.costUsd >= 0);
  assert.equal(cost.projection?.run, runOf(runs[0]), "the newest projection");
  const fetched = f.api().filter((c) => c.url.includes("/contents/data/reports/")).map((c) => c.url.match(/reports\/([^?]+)/)![1]);
  assert.deepEqual(fetched, runs.slice(0, runs.indexOf(fullRun) + 1), "only run summaries, newest first, stopping at the full run");
  const before = f.api().length;
  await gh.fetchRunCost(deps(f, PAT_ENV));
  assert.equal(f.api().length, before + 1, "a second call lists the folder and reuses the summaries it read");
  assert.equal(await gh.fetchRunCost(deps(fakeGithub(() => ({ status: 500 })), PAT_ENV)), null);
});

test("lastFullRunCost: a newer full run wins; pilot-sized runs never count as full", () => {
  const synthetic = lastFullRunCost([
    { run: "a", started: "2026-10-01T00:00:00Z", total: 1900, usage: { discovery: { cost_usd: 10 }, extraction: { cost_usd: 5.555 } } },
    { run: "b", started: "2026-10-02T00:00:00Z", total: 90, usage_rows: [{ cost_usd: 1 }], projection: { full_run_usd: 140 } },
  ]);
  assert.deepEqual(synthetic, { last: { run: "a", finished: null, colleges: 1900, costUsd: 15.56 }, projection: { run: "b", fullRunUsd: 140 } });
  assert.deepEqual(lastFullRunCost([{ run: "b", total: FULL_RUN_MIN_COLLEGES - 1 }]).last, null);
  assert.deepEqual(lastFullRunCost([]), { last: null, projection: null });
});

test("readRepoFile with knownSha: an unchanged file isn't downloaded", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => (c.headers.Accept === "application/vnd.github.object+json" ? { status: 200, body: { sha: "def", encoding: "none", content: "" } } : { status: 200, text: "big" }));
  assert.deepEqual(await gh.readRepoFile("data/review-queue.json", { ...deps(f, PAT_ENV), knownSha: "def" }), { ok: true, content: "", sha: "def", unchanged: true });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await gh.readRepoFile("data/review-queue.json", { ...deps(f, PAT_ENV), knownSha: "old" }), { ok: true, content: "big", sha: "def" });
});


/* ------------------------------------------------------------------ */
/* Held review items: the Accept mapping                               */
/* ------------------------------------------------------------------ */

test("Accept: a C1 trio becomes five field edits from one document, every path one an admin edit may set", () => {
  const plan = acceptPlan(TRIO[2], TRIO);
  assert.ok(plan.ok, plan.ok ? "" : plan.message);
  if (!plan.ok) return;
  assert.deepEqual(plan.values, {
    "admissions.year": 2025,
    "admissions.applicants": 7956,
    "admissions.admitted": 5006,
    "admissions.enrolled": 1040,
    "admissions.acceptance_rate": 0.6292,
  });
  assert.deepEqual(plan.items.map((i) => i.code), ["C.116", "C.117", "C.118"]);
  assert.equal(plan.url, "https://www.example.edu/ir/cds-2025-2026.pdf");
  for (const path of Object.keys(plan.values)) assert.equal(editProblem({ unit_id: "999001", path }), null, `${path} is editable`);
  // The guard: a path the registry computes or hides is refused (the function checks only the shape).
  assert.match(editProblem({ unit_id: "999001", path: "admissions.nope" }) ?? "", /not a registered field/);
  // The siblings are found by key, as the store holds them.
  assert.deepEqual(siblingKeys("999001|2025-26|C.117"), ["999001|2025-26|C.116", "999001|2025-26|C.117", "999001|2025-26|C.118"]);
  assert.deepEqual(siblingKeys("999001|2025-26|C.901"), ["999001|2025-26|C.901"]);
  assert.equal(acceptNote(plan.url), "Accepted from the review queue: https://www.example.edu/ir/cds-2025-2026.pdf");
  assert.equal(acceptNote(`https://x.test/${"a".repeat(600)}`).length, 500, "within the function's 500 characters");
  // The queue shows the rows as open, with what Accept would write.
  const rows = queueRows(TRIO);
  assert.deepEqual(rows.map((r) => r.status), ["open", "open", "open"]);
  assert.deepEqual(rows[0].accept, { ok: true, fields: Object.keys(plan.values) });
  assert.equal(rows[0].id, "999001|2025-26|C.116", "a row's id is its document's key");
});

test("Accept: the submission shares are one edit each, as fractions", () => {
  const sat = acceptPlan(c1Item("C.901", 0.34567), []);
  assert.ok(sat.ok && sat.values["admissions.test_submission_rate_sat"] === 0.3457);
  const act = acceptPlan(c1Item("C.902", 0.12), []);
  assert.ok(act.ok && Object.keys(act.values).join() === "admissions.test_submission_rate_act");
});

test("Accept is refused for items no editable field reaches, an incomplete C1 set, implausible counts, non-CDS documents, and resolved items", () => {
  const b = c1Item("B.430", 12);
  assert.equal((acceptPlan(b, [b]) as { reason: string }).reason, "no_override_path");
  assert.equal((acceptPlan(TRIO[0], TRIO.slice(0, 2)) as { reason: string }).reason, "c1_incomplete");
  const otherDoc = [TRIO[0], TRIO[1], c1Item("C.118", 1040, { sha256: "b".repeat(64) })];
  assert.equal((acceptPlan(TRIO[0], otherDoc) as { reason: string }).reason, "c1_incomplete", "siblings must be from the same document");
  const funnel = [c1Item("C.116", 100), c1Item("C.117", 500), c1Item("C.118", 50)];
  assert.equal((acceptPlan(funnel[0], funnel) as { reason: string }).reason, "implausible");
  assert.equal((acceptPlan(c1Item("C.901", 34), []) as { reason: string }).reason, "implausible", "shares are fractions");
  assert.equal((acceptPlan({ ...TRIO[0], resolved: "rejected" }, TRIO) as { reason: string }).reason, "not_open");
  assert.equal((acceptPlan({ ...TRIO[0], resolved: "accepted" }, TRIO) as { reason: string }).reason, "not_open");
  const accepted = TRIO.map((i) => ({ ...i, resolved: "accepted" as const }));
  assert.equal((acceptPlan(TRIO[0], [TRIO[0], ...accepted.slice(1)]) as { reason: string }).reason, "c1_incomplete", "accepted siblings aren't accepted twice");
  // Round-1/2 entries: a C1 extraction from a CDS is accepted; a class profile isn't a CDS.
  const extraction = { cohort: "first-year" as const, scope: "all-rounds" as const, entering_term: "Fall 2025", applicants: 22798, admitted: 10992, enrolled: 1536, acceptance_rate: null, quotes: {} };
  const legacy: ReviewItem = { unit_id: "117946", name: "Loyola Marymount University", urls: ["https://academics.lmu.edu/media/CDS%202025-26_20260518.pdf"], entering_term: "Fall 2025", extraction, failures: [{ check: "sources-agree", detail: "x" }], queued: "2026-10-04", run: "r" };
  const plan = acceptPlan(legacy, [legacy]);
  assert.ok(plan.ok && plan.edition === "2025-26" && plan.values["admissions.acceptance_rate"] === 0.4821);
  assert.equal((acceptPlan({ ...legacy, urls: ["https://www.usfca.edu/law/admissions/jd/class-profile"] }, []) as { reason: string }).reason, "not_cds");
});

test("a resolved item (rejected or accepted) stays resolved when the next run reads the same document, and a newer document replaces it", () => {
  for (const resolved of ["rejected", "accepted"] as const) {
    const done: ReviewItem = { ...TRIO[0], resolved, resolved_on: TODAY };
    const sameDoc = { ...TRIO[0], run: "next-run", queued: "2026-10-20" };
    assert.deepEqual(enqueueItems([done], [sameDoc]), [done], resolved);
    const newDoc = { ...sameDoc, sha256: "c".repeat(64) };
    assert.deepEqual(enqueueItems([done], [newDoc]), [newDoc], resolved);
  }
  // The guard: an open item is replaced by the same document's re-read, as before.
  const sameDoc = { ...TRIO[0], run: "next-run", queued: "2026-10-20" };
  assert.deepEqual(enqueueItems([TRIO[0]], [sameDoc]), [sameDoc]);
});

test("Re-run discovery: the college run with rediscover", () => {
  const r = buildDispatch("college", { college: "166027", rediscover: true, auto_merge: true });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.file, "college-reported.yml");
    assert.deepEqual(r.inputs, { college: "166027", rediscover: "true", auto_merge: "true", mode: "college" });
  }
});
