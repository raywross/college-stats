/**
 * The admin console's GitHub side (specs/product/admin.md, "Operations: reruns and approvals"): the client
 * (lib/github-app.ts) with a fake `fetch` (no network: the global fetch throws), the dispatchable-runs table
 * (lib/admin/workflows.ts) against the workflow files themselves, and the review-queue edits
 * (lib/admin/review-queue.ts) against the real data files and the repo's own override validation. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { validateOverrides } from "../lib/lineage.ts";
import { parseReleaseNote } from "../lib/release-notes.ts";
import { enqueueItems, type ReviewItem, type ReviewQueueFile } from "../lib/reported.ts";
import { linesJson as scriptsLinesJson } from "../scripts/lib/college-reported/files.mts";
import {
  DISPATCHABLE_FILES,
  DISPATCHABLE_RUNS,
  FULL_RUN_MIN_COLLEGES,
  blockingRun,
  buildDispatch,
  lastFullRunCost,
  runById,
} from "../lib/admin/workflows.ts";
import {
  acceptChange,
  acceptEdit,
  acceptPlan,
  linesJson,
  overridesJson,
  queueRows,
  readMainQueue,
  readQueue,
  rediscoverChange,
  rediscoverEdit,
  rejectChange,
  rejectEdit,
  releaseNotePath,
  reviewBranch,
  rowId,
} from "../lib/admin/review-queue.ts";

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
  const r = await gh.commitFileAndOpenPull(
    { branch: "review/1-c-116-2026-10-12", path: "data/overrides.json", content: "{}", message: "m", title: "t", body: "b", releaseNote: { path: "release-notes/1-c-116-2026-10-12.md", content: "x" } },
    d,
  );
  assert.equal(r.ok, false);
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

function commitFixture(opts: { fileSha?: string; branchStatus?: number } = {}) {
  return fakeGithub((c) => {
    if (c.method === "GET" && c.url === `${REPO}/git/ref/heads/main`) return { status: 200, body: { object: { sha: "mainsha" } } };
    if (c.method === "POST" && c.url === `${REPO}/git/refs`) return { status: opts.branchStatus ?? 201, body: {} };
    if (c.method === "GET" && c.url.startsWith(`${REPO}/contents/data/overrides.json?ref=`)) return { status: 200, body: { sha: opts.fileSha ?? "blob1" } };
    if (c.method === "PUT" && c.url.startsWith(`${REPO}/contents/`)) return { status: c.url.includes("release-notes") ? 201 : 200, body: {} };
    if (c.method === "POST" && c.url === `${REPO}/pulls`) return { status: 201, body: { number: 150, html_url: "https://github.com/raywross/college-stats/pull/150", node_id: "PR_150" } };
    if (c.url === `${API}/graphql`) return { status: 200, body: { data: {} } };
    if (c.method === "DELETE") return { status: 204 };
    return undefined;
  });
}

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
const CTX = { admin: "Ray", today: TODAY, placeholder: gh.PR_NUMBER_PLACEHOLDER };

test("commitFileAndOpenPull: branch from main, one commit, the PR, the release note naming its number, auto-merge on", async () => {
  gh.resetTokenCache();
  const overrides = read("data/overrides.json");
  const built = acceptChange(TRIO[0], { content: overrides, sha: "blob1" }, TRIO, CTX);
  assert.ok(built.ok);
  if (!built.ok) return;
  const f = commitFixture();
  const r = await gh.commitFileAndOpenPull(built.change, deps(f));
  assert.deepEqual(r, { ok: true, number: 150, url: "https://github.com/raywross/college-stats/pull/150", autoMerge: true });
  const calls = f.api();
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.replace(API, "")}`),
    [
      "GET /repos/raywross/college-stats/git/ref/heads/main",
      "POST /repos/raywross/college-stats/git/refs",
      "GET /repos/raywross/college-stats/contents/data/overrides.json?ref=review%2F999001-c-116-2026-10-12",
      "PUT /repos/raywross/college-stats/contents/data/overrides.json",
      "POST /repos/raywross/college-stats/pulls",
      "PUT /repos/raywross/college-stats/contents/release-notes/999001-c-116-2026-10-12.md",
      "POST /graphql",
    ],
  );
  assert.deepEqual(calls[1].body, { ref: "refs/heads/review/999001-c-116-2026-10-12", sha: "mainsha" });
  const put = calls[3].body as { message: string; content: string; branch: string; sha: string };
  assert.equal(put.branch, "review/999001-c-116-2026-10-12");
  assert.equal(put.sha, "blob1");
  assert.match(put.message, /^Review queue: accept C\.116 for Example College \(999001\)\n\nFrom the admin console, by Ray\./);
  const committed = Buffer.from(put.content, "base64").toString("utf8");
  assert.equal(committed, built.change.content);
  assert.deepEqual(validateOverrides(JSON.parse(committed)), [], "the committed overrides pass the lineage check");
  assert.deepEqual(calls[4].body, { title: "Review queue: accept C.116 for Example College", head: "review/999001-c-116-2026-10-12", base: "main", body: built.change.body });
  const note = Buffer.from((calls[5].body as { content: string }).content, "base64").toString("utf8");
  const parsed = parseReleaseNote("release-notes/999001-c-116-2026-10-12.md", note);
  assert.equal(parsed.pr, 150);
  assert.equal(parsed.kind, "data");
  assert.equal(parsed.date, TODAY);
  assert.match((calls[6].body as { query: string }).query, /enablePullRequestAutoMerge[\s\S]*SQUASH/);
});

test("commitFileAndOpenPull refuses other paths and branches, an existing branch, and a file that changed on main", async () => {
  gh.resetTokenCache();
  const base = { branch: "review/999001-c-116-2026-10-12", path: "data/overrides.json", content: "{}\n", message: "m", title: "t", body: "b", releaseNote: { path: "release-notes/999001-c-116-2026-10-12.md", content: "n" } };
  const none = commitFixture();
  assert.deepEqual(await gh.commitFileAndOpenPull({ ...base, path: ".github/workflows/verify.yml" }, deps(none)), { ok: false, reason: "path_not_writable" });
  assert.deepEqual(await gh.commitFileAndOpenPull({ ...base, path: "data/schools.json" }, deps(none)), { ok: false, reason: "path_not_writable" });
  assert.deepEqual(await gh.commitFileAndOpenPull({ ...base, branch: "main" }, deps(none)), { ok: false, reason: "bad_branch" });
  assert.deepEqual(await gh.commitFileAndOpenPull({ ...base, releaseNote: { path: "release-notes/Bad.Name.md", content: "n" } }, deps(none)), { ok: false, reason: "bad_release_note_path" });
  assert.equal(none.calls.length, 0);

  const exists = commitFixture({ branchStatus: 422 });
  assert.deepEqual(await gh.commitFileAndOpenPull(base, deps(exists)), { ok: false, reason: "branch_exists" });

  const moved = commitFixture({ fileSha: "blob2" });
  assert.deepEqual(await gh.commitFileAndOpenPull({ ...base, baseSha: "blob1" }, deps(moved)), { ok: false, reason: "file_changed" });
  const del = moved.api().find((c) => c.method === "DELETE");
  assert.equal(del?.url, `${REPO}/git/refs/heads/review/999001-c-116-2026-10-12`, "the new branch is deleted");
  assert.equal(moved.api().filter((c) => c.method === "PUT").length, 0, "nothing committed");
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
  assert.deepEqual([...DISPATCHABLE_FILES].sort(), ["college-reported.yml", "identity-refresh.yml", "publish-changes.yml", "verify.yml", "visit-events.yml"]);
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

  const publish = buildDispatch("publish", { what: "high-schools" });
  assert.ok(publish.ok && publish.inputs.what === "high-schools");
  assert.equal(buildDispatch("publish", { what: "everything" }).ok, false);

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
  assert.equal(blockingRun(runById("publish")!, [{ workflow: "publish-changes.yml", status: "in_progress" }]), null, "no guard on publish");
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
  assert.equal(cost.last.run, "20261019-191037-103", "the newest run over every college");
  assert.ok(cost.last.colleges >= FULL_RUN_MIN_COLLEGES && cost.last.costUsd >= 0);
  const runs = names.filter((n) => /^college-reported-run-.+\.json$/.test(n)).sort().reverse();
  assert.equal(cost.projection?.run, runs[0].replace(/^college-reported-run-|\.json$/g, ""), "the newest projection");
  const fetched = f.api().filter((c) => c.url.includes("/contents/data/reports/")).map((c) => c.url.match(/reports\/([^?]+)/)![1]);
  assert.deepEqual(fetched, runs.slice(0, runs.indexOf("college-reported-run-20261019-191037-103.json") + 1), "only run summaries, newest first, stopping at the full run");
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

test("readQueue: rows from main's queue and overrides, downloaded again only when a blob sha changes", async () => {
  const queueText = linesJson("2026-10-11", "items", [...TRIO, { ...c1Item("C.901", 0.3), resolved: "rejected" as const, resolved_on: TODAY }]);
  const accepted = acceptEdit(TRIO[0], read("data/overrides.json"), { queue: TRIO, today: TODAY });
  assert.ok(accepted.ok);
  const files: Record<string, { content: string; sha: string }> = {
    "data/review-queue.json": { content: queueText, sha: "q1" },
    "data/overrides.json": { content: accepted.ok ? accepted.content : "", sha: "o1" },
  };
  const reads: string[] = [];
  const reader = async (path: string, knownSha?: string) => {
    const same = knownSha === files[path].sha;
    reads.push(`${path}${same ? " (unchanged)" : ""}`);
    return same ? { ok: true as const, content: "", sha: files[path].sha, unchanged: true } : { ok: true as const, ...files[path] };
  };
  const first = await readQueue(reader);
  assert.ok(first.ok);
  if (first.ok) assert.deepEqual(first.rows.map((r) => r.status), ["accepted", "accepted", "accepted", "rejected"]);
  const second = await readQueue(reader);
  assert.ok(second.ok && first.ok && second.rows === first.rows, "served from the cache");
  assert.deepEqual(reads.slice(2), ["data/review-queue.json (unchanged)", "data/overrides.json (unchanged)"]);
  files["data/overrides.json"] = { content: read("data/overrides.json"), sha: "o2" };
  const third = await readQueue(reader);
  assert.ok(third.ok);
  if (third.ok) assert.deepEqual(third.rows.map((r) => r.status), ["open", "open", "open", "rejected"]);
  assert.deepEqual(await readQueue(async () => ({ ok: false as const, reason: "read 404" })), { ok: false, reason: "read 404" });
});

test("readMainQueue: null without GitHub credentials; otherwise main's files through the Contents API", async () => {
  assert.equal(await readMainQueue({ env: {}, fetch: fakeGithub(() => undefined).fetch }), null);
  gh.resetTokenCache();
  const queueText = linesJson("2026-10-11", "items", TRIO);
  const f = fakeGithub((c) => {
    const body = (text: string, sha: string) => ({ status: 200, body: { sha, encoding: "base64", content: Buffer.from(text).toString("base64") } });
    if (c.url === `${REPO}/contents/data/review-queue.json?ref=main`) return body(queueText, "mq1");
    if (c.url === `${REPO}/contents/data/overrides.json?ref=main`) return body(read("data/overrides.json"), "mo1");
    return undefined;
  });
  const r = await readMainQueue(deps(f, PAT_ENV));
  assert.ok(r && r.ok);
  if (r && r.ok) assert.deepEqual(r.rows.map((x) => x.item.code), ["C.116", "C.117", "C.118"]);
});

test("readRepoFile with knownSha: an unchanged file isn't downloaded", async () => {
  gh.resetTokenCache();
  const f = fakeGithub((c) => (c.headers.Accept === "application/vnd.github.object+json" ? { status: 200, body: { sha: "def", encoding: "none", content: "" } } : { status: 200, text: "big" }));
  assert.deepEqual(await gh.readRepoFile("data/review-queue.json", { ...deps(f, PAT_ENV), knownSha: "def" }), { ok: true, content: "", sha: "def", unchanged: true });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await gh.readRepoFile("data/review-queue.json", { ...deps(f, PAT_ENV), knownSha: "old" }), { ok: true, content: "big", sha: "def" });
});

/* ------------------------------------------------------------------ */
/* Review queue edits                                                  */
/* ------------------------------------------------------------------ */

test("linesJson matches the pipeline's writer, and the queue and sources files round-trip byte for byte", () => {
  const items = [{ unit_id: "1", a: [1, 2] }, { unit_id: "2" }];
  assert.equal(linesJson("2026-10-12", "items", items), scriptsLinesJson("2026-10-12", "items", items));
  assert.equal(linesJson(null, "items", []), scriptsLinesJson(null, "items", []));
  const queue = read("data/review-queue.json");
  const q = JSON.parse(queue) as ReviewQueueFile;
  assert.equal(linesJson(q.updated, "items", q.items), queue);
  const sources = read("data/college-sources.json");
  const s = JSON.parse(sources) as { updated: string; recipes: unknown[] };
  assert.equal(linesJson(s.updated, "recipes", s.recipes), sources);
  const overrides = read("data/overrides.json");
  assert.equal(overridesJson(JSON.parse(overrides)), overrides);
});

test("review branch, release-note path, and release note: review/<unit>-<code>-<date>, a valid note of kind data", () => {
  assert.equal(reviewBranch(TRIO[0], TODAY), "review/999001-c-116-2026-10-12");
  assert.equal(reviewBranch({ unit_id: "100706", code: "H.2A01" }, TODAY), "review/100706-h-2a01-2026-10-12");
  assert.equal(reviewBranch({ unit_id: "117946" }, TODAY), "review/117946-c1-2026-10-12");
  assert.equal(releaseNotePath("review/999001-c-116-2026-10-12"), "release-notes/999001-c-116-2026-10-12.md");
  const queue = linesJson("2026-10-11", "items", TRIO);
  for (const built of [
    acceptChange(TRIO[1], { content: read("data/overrides.json"), sha: "s" }, TRIO, CTX),
    rejectChange(TRIO[1], { content: queue, sha: "s" }, CTX),
  ]) {
    assert.ok(built.ok);
    if (!built.ok) continue;
    const note = built.change.releaseNote;
    assert.equal(note.path, "release-notes/999001-c-117-2026-10-12.md");
    assert.equal(built.change.branch, "review/999001-c-117-2026-10-12");
    assert.ok(note.content.includes(`pr: ${gh.PR_NUMBER_PLACEHOLDER}`));
    const parsed = parseReleaseNote(note.path, note.content.replace(gh.PR_NUMBER_PLACEHOLDER, "151"));
    assert.equal(parsed.kind, "data");
    assert.equal(parsed.slug, "999001-c-117-2026-10-12");
    assert.match(built.change.body, /by Ray/);
    assert.match(built.change.body, /residency-sum/);
    assert.match(built.change.body, /https:\/\/www\.example\.edu\/ir\/cds-2025-2026\.pdf/);
  }
});

test("Accept: a C1 trio becomes one override with source cds and the document's citation that passes validateOverrides", () => {
  const text = read("data/overrides.json");
  const r = acceptEdit(TRIO[2], text, { queue: TRIO, today: TODAY });
  assert.ok(r.ok, r.ok ? "" : r.message);
  if (!r.ok) return;
  const after = JSON.parse(r.content) as Record<string, Record<string, unknown>>;
  const before = JSON.parse(text) as Record<string, unknown>;
  // Every other patch is untouched.
  for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], k);
  const patch = after["999001"];
  assert.deepEqual(patch.cds, { edition: "2025-26", url: "https://www.example.edu/ir/cds-2025-2026.pdf" });
  assert.equal(patch._imported, TODAY);
  assert.deepEqual(patch.admissions, { year: 2025, applicants: 7956, admitted: 5006, enrolled: 1040, acceptance_rate: 0.6292 });
  const lineage = patch.lineage as Record<string, { source: string; year: string; url: string; retrieved: string }>;
  assert.deepEqual(Object.keys(lineage).sort(), ["admissions.acceptance_rate", "admissions.admitted", "admissions.applicants", "admissions.enrolled", "admissions.year"]);
  assert.deepEqual(lineage["admissions.applicants"], { source: "cds", year: "2025-26", url: "https://www.example.edu/ir/cds-2025-2026.pdf", retrieved: "2026-10-11" });
  assert.deepEqual(r.items.map((i) => i.code), ["C.116", "C.117", "C.118"]);
  // The repo's own override validation (npm run check:lineage) accepts the whole file.
  assert.deepEqual(validateOverrides(after), []);
  // …and the guard catches a broken patch: no citation, or a field an override may not set.
  assert.equal(validateOverrides({ ...after, "999001": { ...patch, cds: undefined, _lineage: undefined } }).length, 1);
  assert.equal(validateOverrides({ ...after, "999001": { ...patch, outcomes: { retention_rate: 0.9 } } }).length, 1);
  // acceptEdit runs that check itself: a result the lineage check would refuse is never offered as a PR.
  const uncited = acceptEdit(TRIO[0], JSON.stringify({ "999001": { admissions: { year: 2024 } } }), { queue: TRIO, today: TODAY });
  assert.deepEqual(uncited.ok ? null : uncited.reason, "invalid_override");
  // The queue shows the accepted rows, and accepting again is refused.
  const rows = queueRows({ updated: "", items: TRIO }, after);
  assert.deepEqual(rows.map((x) => x.status), ["accepted", "accepted", "accepted"]);
  assert.equal(acceptEdit(TRIO[0], r.content, { queue: TRIO, today: TODAY }).ok, false);
});

test("Accept into a college that already has an override: the new values cite the new document, the old ones keep theirs", () => {
  const text = read("data/overrides.json");
  const unit = "110635"; // Berkeley: CDS 2024-25 in overrides.json
  const sat = c1Item("C.901", 0.34, { unit_id: unit, name: "University of California-Berkeley", urls: ["https://example.berkeley.edu/cds-2025-26.xlsx"] });
  const r = acceptEdit(sat, text, { queue: [sat], today: TODAY });
  assert.ok(r.ok, r.ok ? "" : r.message);
  if (!r.ok) return;
  const after = JSON.parse(r.content) as Record<string, Record<string, Record<string, unknown>>>;
  const before = JSON.parse(text) as Record<string, Record<string, Record<string, unknown>>>;
  assert.equal(after[unit].admissions.test_submission_rate_sat, 0.34);
  assert.deepEqual(after[unit].cds, before[unit].cds, "the patch's own citation stays");
  assert.equal((after[unit].lineage["admissions.test_submission_rate_sat"] as unknown as { url: string }).url, "https://example.berkeley.edu/cds-2025-26.xlsx");
  assert.deepEqual(after[unit].lineage["aid.cds"], before[unit].lineage["aid.cds"]);
  assert.deepEqual(validateOverrides(after), []);
});

test("Accept is refused for items an override can't express, an incomplete C1 set, implausible counts, and non-CDS documents", () => {
  const b = c1Item("B.430", 12);
  assert.deepEqual(acceptPlan(b, [b]).ok, false);
  assert.equal((acceptPlan(b, [b]) as { reason: string }).reason, "no_override_path");
  assert.equal((acceptPlan(TRIO[0], TRIO.slice(0, 2)) as { reason: string }).reason, "c1_incomplete");
  const otherDoc = [TRIO[0], TRIO[1], c1Item("C.118", 1040, { sha256: "b".repeat(64) })];
  assert.equal((acceptPlan(TRIO[0], otherDoc) as { reason: string }).reason, "c1_incomplete", "siblings must be from the same document");
  const funnel = [c1Item("C.116", 100), c1Item("C.117", 500), c1Item("C.118", 50)];
  assert.equal((acceptPlan(funnel[0], funnel) as { reason: string }).reason, "implausible");
  assert.equal((acceptPlan(c1Item("C.901", 34), []) as { reason: string }).reason, "implausible", "shares are fractions");
  assert.equal((acceptPlan({ ...TRIO[0], resolved: "rejected" }, TRIO) as { reason: string }).reason, "not_open");
  // Round-1/2 entries: a C1 extraction from a CDS is accepted; a class profile isn't a CDS.
  const extraction = { cohort: "first-year" as const, scope: "all-rounds" as const, entering_term: "Fall 2025", applicants: 22798, admitted: 10992, enrolled: 1536, acceptance_rate: null, quotes: {} };
  const legacy: ReviewItem = { unit_id: "117946", name: "Loyola Marymount University", urls: ["https://academics.lmu.edu/media/CDS%202025-26_20260518.pdf"], entering_term: "Fall 2025", extraction, failures: [{ check: "sources-agree", detail: "x" }], queued: "2026-10-04", run: "r" };
  const plan = acceptPlan(legacy, [legacy]);
  assert.ok(plan.ok && plan.edition === "2025-26" && plan.values["admissions.acceptance_rate"] === 0.4821);
  assert.equal((acceptPlan({ ...legacy, urls: ["https://www.usfca.edu/law/admissions/jd/class-profile"] }, []) as { reason: string }).reason, "not_cds");
  const legacyEdit = acceptEdit(legacy, read("data/overrides.json"), { queue: [legacy], today: TODAY });
  assert.ok(legacyEdit.ok);
  if (legacyEdit.ok) assert.deepEqual(validateOverrides(JSON.parse(legacyEdit.content)), []);
});

test("Reject: the real queue file with one line changed, resolved: rejected", () => {
  const text = read("data/review-queue.json");
  const queue = JSON.parse(text) as ReviewQueueFile;
  const target = queue.items.find((i) => i.code === "C.119")!;
  const r = rejectEdit(target, text, { today: TODAY });
  assert.ok(r.ok);
  if (!r.ok) return;
  const before = text.split("\n");
  const after = r.content.split("\n");
  assert.equal(after.length, before.length);
  const changed = after.map((l, i) => (l === before[i] ? -1 : i)).filter((i) => i >= 0);
  assert.equal(changed.length, 1, "exactly one line changes");
  const item = JSON.parse(after[changed[0]].trim().replace(/,$/, "")) as ReviewItem;
  assert.equal(item.resolved, "rejected");
  assert.equal(item.resolved_on, TODAY);
  assert.equal(rowId(item), rowId(target));
  // Rejecting it again, or an item that isn't there, is refused.
  assert.equal(rejectEdit(target, r.content, { today: TODAY }).ok, false);
  assert.equal(rejectEdit(c1Item("C.116", 1), text, { today: TODAY }).ok, false);
});

test("a rejected item stays rejected when the next run reads the same document, and a newer document replaces it", () => {
  const rejected: ReviewItem = { ...TRIO[0], resolved: "rejected", resolved_on: TODAY };
  const sameDoc = { ...TRIO[0], run: "next-run", queued: "2026-10-20" };
  assert.deepEqual(enqueueItems([rejected], [sameDoc]), [rejected]);
  const newDoc = { ...sameDoc, sha256: "c".repeat(64) };
  assert.deepEqual(enqueueItems([rejected], [newDoc]), [newDoc]);
  // The guard: an open item is replaced by the same document's re-read, as before.
  assert.deepEqual(enqueueItems([TRIO[0]], [sameDoc]), [sameDoc]);
});

test("Re-run discovery: the college run with rediscover, and the recipe cleared from data/college-sources.json", () => {
  const text = read("data/college-sources.json");
  const unit = (JSON.parse(text) as { recipes: { unit_id: string }[] }).recipes[3].unit_id;
  const r = rediscoverEdit(unit, text);
  assert.ok(r.dispatch.ok);
  if (r.dispatch.ok) {
    assert.equal(r.dispatch.file, "college-reported.yml");
    assert.deepEqual(r.dispatch.inputs, { college: unit, rediscover: "true", auto_merge: "true", mode: "college" });
  }
  assert.ok(r.content);
  assert.equal(r.content!.split("\n").length, text.split("\n").length - 1, "one recipe line fewer");
  assert.ok(!r.content!.includes(`{"unit_id":"${unit}"`));
  assert.equal(rediscoverEdit("000000", text).content, null, "no recipe, no file change");
  const built = rediscoverChange({ ...TRIO[0], unit_id: unit }, { content: text, sha: "s" }, CTX);
  assert.equal(built.change?.path, "data/college-sources.json");
  assert.equal(built.change?.branch, `review/${unit}-c-116-2026-10-12`);
});
