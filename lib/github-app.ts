import "server-only";
/**
 * The admin console's GitHub client (specs/product/admin.md, "Operations: reruns and approvals"). The console calls
 * GitHub as the "Quad console" GitHub App: it signs a short RS256 JWT with the App's private key, exchanges it for an
 * installation token (valid one hour, cached in memory until five minutes before it expires), and calls the REST API.
 * A fine-grained personal access token in `GITHUB_TOKEN` works instead, for a first go.
 *
 * Environment (Vercel, sensitive): `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` (the PEM
 * GitHub downloads, with real or `\n`-escaped newlines, or base64 of it), or `GITHUB_TOKEN`; and `GITHUB_REPO`
 * (`owner/name`, default `raywross/college-stats`). Nothing configured: `githubConfigured()` is null and the
 * Operations page shows a setup notice instead of buttons.
 *
 * Rules: nothing here throws into a page (every export returns a result or an empty list and logs the failure without
 * any token); every network call goes through `deps.fetch` so tests run with no network; only the workflows in the
 * console's own table (lib/admin/workflows.ts) can be dispatched, always on `main` unless the table says the run takes
 * a pull request's branch (Re-run CI); the console never pushes to `main` (commits go to a new branch and a PR).
 * Server only (holds the key), free of Next.js imports so tests can run it.
 */
import { createPrivateKey, createSign, randomUUID } from "node:crypto";
import { DISPATCHABLE_FILES, FULL_RUN_MIN_COLLEGES, lastFullRunCost, type FullRunCost, type RunSummaryLike } from "./admin/workflows.ts";

export const DEFAULT_REPO = "raywross/college-stats";
export const GITHUB_API = "https://api.github.com";
/** The branch every dispatch and every console PR targets. */
export const BASE_BRANCH = "main";
/** Head-branch prefixes of the pipelines' PRs (`data/…`) and the console's own review-queue PRs (`review/…`). */
export const DATA_PULL_PREFIXES = ["data/", "review/"] as const;
/** Written into a release note the console prepares before its PR exists; replaced by the PR's number. */
export const PR_NUMBER_PLACEHOLDER = "{{PR_NUMBER}}";

type Env = Record<string, string | undefined>;

export interface GithubDeps {
  env?: Env;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch; `Date.now` by default (tests pin it). */
  now?: () => number;
  /** Per request; 15 s by default, 60 s for a file commit. */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export type GithubMode = "app" | "pat";

/** Which credentials are set: the App (all three variables) wins over a PAT. Null: Operations shows a setup notice. */
export function githubConfigured(env: Env = process.env): { mode: GithubMode } | null {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY) return { mode: "app" };
  if (env.GITHUB_TOKEN) return { mode: "pat" };
  return null;
}

/** `owner/name` from `GITHUB_REPO`, or the default. A malformed value falls back to the default. */
export function githubRepo(env: Env = process.env): string {
  const r = env.GITHUB_REPO?.trim();
  return r && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) ? r : DEFAULT_REPO;
}

/** A fresh id for one dispatch: logged before the call, passed as the `request_id` input, and matched in `run-name`. */
export function newRequestId(): string {
  return randomUUID();
}

/* ------------------------------------------------------------------ */
/* App authentication                                                  */
/* ------------------------------------------------------------------ */

/** The App's private key as PEM: real newlines, `\n`-escaped newlines (how Vercel often stores it), or base64 of the PEM. */
export function normalizePrivateKey(raw: string): string {
  const s = raw.trim();
  if (s.includes("-----BEGIN")) return s.replace(/\\n/g, "\n").trim();
  const decoded = Buffer.from(s, "base64").toString("utf8");
  if (decoded.includes("-----BEGIN")) return decoded.trim();
  throw new Error("GITHUB_APP_PRIVATE_KEY is not a PEM key");
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/**
 * The App's JWT (RS256): issued 60 s in the past (GitHub's allowance for clock drift), expiring 9 minutes after now
 * (GitHub's maximum is 10), issuer the App id. `nowMs` is for tests.
 */
export function appJwt(appId: string, privateKeyPem: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(createPrivateKey(normalizePrivateKey(privateKeyPem))).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Refresh an installation token this long before GitHub's `expires_at`. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

interface CachedToken {
  key: string;
  token: string;
  expiresAt: number;
}
let cachedToken: CachedToken | null = null;
let inflight: { key: string; promise: Promise<string> } | null = null;

/** Clears the in-memory installation token (tests; and after GitHub refuses a cached token). */
export function resetTokenCache(): void {
  cachedToken = null;
  inflight = null;
}

class GithubError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

async function mintInstallationToken(env: Env, deps: GithubDeps, key: string): Promise<string> {
  const now = (deps.now ?? Date.now)();
  const jwt = appJwt(env.GITHUB_APP_ID!, env.GITHUB_APP_PRIVATE_KEY!, now);
  const repoName = githubRepo(env).split("/")[1];
  const res = await timedFetch(
    deps,
    `${GITHUB_API}/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID!)}/access_tokens`,
    {
      method: "POST",
      headers: { ...baseHeaders(), Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      // Scoped to this one repository, whatever else the installation can reach.
      body: JSON.stringify({ repositories: [repoName] }),
    },
  );
  const body = (await res.json().catch(() => null)) as { token?: unknown; expires_at?: unknown } | null;
  if (res.status !== 201 || typeof body?.token !== "string") {
    throw new GithubError(`installation token ${res.status}`, res.status);
  }
  const expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : now + 60 * 60_000;
  cachedToken = { key, token: body.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + 60 * 60_000 };
  return body.token;
}

/** The bearer token for REST calls: the cached installation token, a newly minted one, or the PAT. */
async function authToken(deps: GithubDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const mode = githubConfigured(env)?.mode;
  if (!mode) throw new GithubError("not_configured");
  if (mode === "pat") return env.GITHUB_TOKEN!;
  const key = `${env.GITHUB_APP_ID}|${env.GITHUB_APP_INSTALLATION_ID}|${githubRepo(env)}`;
  const now = (deps.now ?? Date.now)();
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) return cachedToken.token;
  // One mint at a time per instance: concurrent requests share it.
  if (inflight?.key === key) return inflight.promise;
  const promise = mintInstallationToken(env, deps, key).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { key, promise };
  return promise;
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

/** GitHub's REST API version: a date that names the API's shape, not a data year (written in parts for the year guard). */
export const GITHUB_API_VERSION = ["2022", "11", "28"].join("-");

function baseHeaders(): Record<string, string> {
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION, "User-Agent": "quad-console" };
}

async function timedFetch(deps: GithubDeps, url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? deps.timeoutMs ?? 15_000);
  try {
    return await (deps.fetch ?? fetch)(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface ApiResponse<T> {
  status: number;
  data: T;
}

/** One REST call against the repository (`path` starts with `/`, relative to `/repos/{repo}`) or the API root. */
async function api<T = unknown>(
  deps: GithubDeps,
  method: string,
  path: string,
  opts: { body?: unknown; accept?: string; root?: boolean; timeoutMs?: number; raw?: boolean } = {},
): Promise<ApiResponse<T>> {
  const env = deps.env ?? process.env;
  const token = await authToken(deps);
  const url = `${GITHUB_API}${opts.root ? "" : `/repos/${githubRepo(env)}`}${path}`;
  const res = await timedFetch(
    deps,
    url,
    {
      method,
      headers: {
        ...baseHeaders(),
        ...(opts.accept ? { Accept: opts.accept } : {}),
        Authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    },
    opts.timeoutMs,
  );
  // A revoked or expired installation token: mint a new one next time.
  if (res.status === 401) resetTokenCache();
  const data = (opts.raw ? await res.text().catch(() => "") : res.status === 204 ? null : await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}

async function graphql(deps: GithubDeps, query: string, variables: Record<string, unknown>): Promise<{ ok: true } | { ok: false; detail: string }> {
  const r = await api<{ errors?: { message?: string }[] } | null>(deps, "POST", "/graphql", { body: { query, variables }, root: true });
  if (r.status !== 200) return { ok: false, detail: `graphql ${r.status}` };
  if (r.data?.errors?.length) return { ok: false, detail: r.data.errors.map((e) => e.message ?? "error").join("; ") };
  return { ok: true };
}

function describe(e: unknown): string {
  if (e instanceof GithubError) return e.message;
  if (e instanceof Error && e.name === "AbortError") return "timed out";
  return e instanceof Error ? e.message : String(e);
}

function logger(deps: GithubDeps) {
  return deps.log ?? ((msg: string) => console.warn(msg));
}

/** A GitHub error message from a response body, when it has one (never contains a token). */
function ghMessage(data: unknown): string {
  const m = (data as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "";
}

/* ------------------------------------------------------------------ */
/* Workflows: dispatch and runs                                        */
/* ------------------------------------------------------------------ */

/** A request id is a UUID-like token: it goes into a run's name, so nothing else is allowed. */
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
/** Branch names the console dispatches on or creates. */
const BRANCH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export type DispatchResult = { ok: true } | { ok: false; reason: string };

/**
 * Starts a workflow from the console's table: `POST /repos/{repo}/actions/workflows/{file}/dispatches` on `main` (or
 * `deps.ref`, for the run that takes a pull request's branch), with `inputs` plus `request_id`, which the workflow puts
 * in its `run-name` so `findRunByRequestId` can find the run (the dispatch call returns no run id). The caller logs
 * the dispatch (`ops.dispatch`) with the same request id before calling this.
 */
export async function dispatchWorkflow(
  file: string,
  inputs: Record<string, string>,
  requestId: string,
  deps: GithubDeps & { ref?: string } = {},
): Promise<DispatchResult> {
  if (!githubConfigured(deps.env ?? process.env)) return { ok: false, reason: "not_configured" };
  if (!DISPATCHABLE_FILES.has(file)) return { ok: false, reason: "not_dispatchable" };
  if (!REQUEST_ID.test(requestId)) return { ok: false, reason: "bad_request_id" };
  if ("request_id" in inputs) return { ok: false, reason: "request_id_is_reserved" };
  const ref = deps.ref ?? BASE_BRANCH;
  if (!BRANCH.test(ref)) return { ok: false, reason: "bad_ref" };
  try {
    const r = await api(deps, "POST", `/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
      body: { ref, inputs: { ...inputs, request_id: requestId } },
    });
    if (r.status === 204) return { ok: true };
    const reason = `dispatch ${r.status}${ghMessage(r.data) ? `: ${ghMessage(r.data)}` : ""}`;
    logger(deps)(`github-app: ${file} ${reason}`);
    return { ok: false, reason };
  } catch (e) {
    logger(deps)(`github-app: dispatch ${file}: ${describe(e)}`);
    return { ok: false, reason: describe(e) };
  }
}

export interface WorkflowRun {
  id: number;
  /** The workflow's file name ("college-reported.yml"). */
  workflow: string;
  /** The workflow's name ("College-reported data"). */
  name: string;
  /** The run's display title: `run-name` when set ("College-reported data · <request id>"). */
  title: string;
  /** The console's request id, when the console started the run. */
  requestId: string | null;
  runNumber: number;
  event: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  /** Finished runs only. */
  durationMs: number | null;
  url: string;
  actor: string | null;
  headBranch: string | null;
}

interface RawRun {
  id: number;
  name?: string;
  display_title?: string;
  run_number?: number;
  event?: string;
  status?: string;
  conclusion?: string | null;
  path?: string;
  created_at?: string;
  run_started_at?: string | null;
  updated_at?: string;
  html_url?: string;
  actor?: { login?: string } | null;
  triggering_actor?: { login?: string } | null;
  head_branch?: string | null;
}

/** The request id at the end of a run's title (`… · <id>`), or null. */
export function requestIdFromTitle(title: string): string | null {
  const m = title.match(/ · ([A-Za-z0-9-]{8,64})$/);
  return m ? m[1] : null;
}

/** GitHub's run object as a `WorkflowRun`. Exported for tests. */
export function toRun(r: RawRun, workflowFile?: string): WorkflowRun {
  const title = r.display_title ?? r.name ?? "";
  const started = r.run_started_at ?? r.created_at ?? null;
  const done = r.status === "completed" && started && r.updated_at;
  return {
    id: r.id,
    workflow: workflowFile ?? (r.path ?? "").split("/").pop()?.split("@")[0] ?? "",
    name: r.name ?? "",
    title,
    requestId: requestIdFromTitle(title),
    runNumber: r.run_number ?? 0,
    event: r.event ?? "",
    status: r.status ?? "",
    conclusion: r.conclusion ?? null,
    createdAt: r.created_at ?? "",
    startedAt: r.run_started_at ?? null,
    updatedAt: r.updated_at ?? "",
    durationMs: done ? Math.max(0, Date.parse(r.updated_at!) - Date.parse(started)) : null,
    url: r.html_url ?? "",
    actor: r.triggering_actor?.login ?? r.actor?.login ?? null,
    headBranch: r.head_branch ?? null,
  };
}

/** The newest runs of these workflows together, newest first (`perPage` of each, then `perPage` overall; 30 by default). */
export async function listRuns(opts: { workflows: string[]; perPage?: number }, deps: GithubDeps = {}): Promise<WorkflowRun[]> {
  if (!githubConfigured(deps.env ?? process.env)) return [];
  const perPage = Math.min(Math.max(opts.perPage ?? 30, 1), 100);
  try {
    const lists = await Promise.all(
      opts.workflows.map(async (file) => {
        const r = await api<{ workflow_runs?: RawRun[] }>(deps, "GET", `/actions/workflows/${encodeURIComponent(file)}/runs?per_page=${perPage}`);
        if (r.status !== 200) throw new GithubError(`runs ${file} ${r.status}`, r.status);
        return (r.data?.workflow_runs ?? []).map((run) => toRun(run, file));
      }),
    );
    return lists
      .flat()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id))
      .slice(0, perPage);
  } catch (e) {
    logger(deps)(`github-app: listRuns: ${describe(e)}`);
    return [];
  }
}

/** The run the console started with this request id, among the newest 50 dispatched runs; null until it appears. */
export async function findRunByRequestId(requestId: string, deps: GithubDeps = {}): Promise<WorkflowRun | null> {
  if (!githubConfigured(deps.env ?? process.env) || !REQUEST_ID.test(requestId)) return null;
  try {
    const r = await api<{ workflow_runs?: RawRun[] }>(deps, "GET", `/actions/runs?event=workflow_dispatch&per_page=50`);
    if (r.status !== 200) throw new GithubError(`runs ${r.status}`, r.status);
    const run = (r.data?.workflow_runs ?? []).find((x) => requestIdFromTitle(x.display_title ?? "") === requestId);
    return run ? toRun(run) : null;
  } catch (e) {
    logger(deps)(`github-app: findRunByRequestId: ${describe(e)}`);
    return null;
  }
}

/** A failed run's failed job and step ("run / Run the ingestion pipeline"), or null. */
export async function failedStep(runId: number, deps: GithubDeps = {}): Promise<string | null> {
  if (!githubConfigured(deps.env ?? process.env)) return null;
  try {
    const r = await api<{ jobs?: { name?: string; conclusion?: string | null; steps?: { name?: string; conclusion?: string | null }[] }[] }>(
      deps,
      "GET",
      `/actions/runs/${Number(runId)}/jobs?filter=latest`,
    );
    if (r.status !== 200) return null;
    const job = (r.data?.jobs ?? []).find((j) => j.conclusion === "failure");
    if (!job) return null;
    const step = (job.steps ?? []).find((s) => s.conclusion === "failure");
    return step?.name ? `${job.name} / ${step.name}` : (job.name ?? null);
  } catch (e) {
    logger(deps)(`github-app: failedStep: ${describe(e)}`);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Pull requests                                                       */
/* ------------------------------------------------------------------ */

/** A commit's checks together: every check run and commit status (Vercel reports statuses). `none`: nothing started. */
export type ChecksState = "success" | "pending" | "failure" | "none";

const PASSING = new Set(["success", "neutral", "skipped"]);

/** Combines check runs (latest per name, as GitHub returns them) and commit statuses. Pure; exported for tests. */
export function combineChecks(
  runs: { status?: string; conclusion?: string | null }[],
  statuses: { state?: string }[],
): ChecksState {
  if (!runs.length && !statuses.length) return "none";
  let pending = false;
  for (const r of runs) {
    if (r.status !== "completed") pending = true;
    else if (!PASSING.has(r.conclusion ?? "")) return "failure";
  }
  for (const s of statuses) {
    if (s.state === "failure" || s.state === "error") return "failure";
    if (s.state !== "success") pending = true;
  }
  return pending ? "pending" : "success";
}

async function checksFor(sha: string, deps: GithubDeps): Promise<ChecksState> {
  const [runs, status] = await Promise.all([
    api<{ check_runs?: { status?: string; conclusion?: string | null }[] }>(deps, "GET", `/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`),
    api<{ statuses?: { state?: string; context?: string }[] }>(deps, "GET", `/commits/${encodeURIComponent(sha)}/status`),
  ]);
  if (runs.status !== 200 || status.status !== 200) throw new GithubError(`checks ${runs.status}/${status.status}`);
  return combineChecks(runs.data?.check_runs ?? [], status.data?.statuses ?? []);
}

export interface DataPull {
  number: number;
  title: string;
  /** The body the workflow (or the console) wrote, as markdown. */
  body: string;
  branch: string;
  /** `data` for the pipelines' PRs, `review` for the console's review-queue PRs. */
  kind: "data" | "review";
  draft: boolean;
  autoMerge: boolean;
  checks: ChecksState;
  /** The run number in a `data/college-reported-<date>-<time>-<run number>` branch: the run that opened it. */
  runNumber: number | null;
  /** Waits for a person: the circuit breaker tripped, or the run stopped early (college-reported-setup.md section 8). */
  flagged: "breaker" | "stopped" | null;
  url: string;
  createdAt: string;
  author: string | null;
  headSha: string;
}

interface RawPull {
  number: number;
  title?: string;
  body?: string | null;
  draft?: boolean;
  auto_merge?: unknown;
  html_url?: string;
  created_at?: string;
  user?: { login?: string } | null;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  node_id?: string;
  state?: string;
  merged?: boolean;
}

/** Why a data PR waits for a person, read from the body the pipeline wrote (scripts/college-reported-pr-body.mts). */
export function pullFlag(body: string): DataPull["flagged"] {
  if (/\*\*Tripped:\*\*/.test(body)) return "breaker";
  if (/\*\*Stopped early\*\*/.test(body)) return "stopped";
  return null;
}

/** Open PRs on `main` whose head branch starts with `data/` or `review/`, with their checks; flagged ones first. */
export async function listDataPulls(deps: GithubDeps = {}): Promise<DataPull[]> {
  if (!githubConfigured(deps.env ?? process.env)) return [];
  try {
    const r = await api<RawPull[]>(deps, "GET", `/pulls?state=open&base=${BASE_BRANCH}&per_page=100`);
    if (r.status !== 200) throw new GithubError(`pulls ${r.status}`, r.status);
    const pulls = (r.data ?? []).filter((p) => DATA_PULL_PREFIXES.some((prefix) => p.head?.ref?.startsWith(prefix)));
    const out = await Promise.all(
      pulls.map(async (p): Promise<DataPull> => {
        const branch = p.head?.ref ?? "";
        const body = p.body ?? "";
        const run = branch.match(/^data\/college-reported-\d{8}-\d{6}-(\d+)$/);
        return {
          number: p.number,
          title: p.title ?? "",
          body,
          branch,
          kind: branch.startsWith("review/") ? "review" : "data",
          draft: Boolean(p.draft),
          autoMerge: Boolean(p.auto_merge),
          checks: p.head?.sha ? await checksFor(p.head.sha, deps) : "none",
          runNumber: run ? Number(run[1]) : null,
          flagged: pullFlag(body),
          url: p.html_url ?? "",
          createdAt: p.created_at ?? "",
          author: p.user?.login ?? null,
          headSha: p.head?.sha ?? "",
        };
      }),
    );
    return out.sort((a, b) => Number(Boolean(b.flagged)) - Number(Boolean(a.flagged)) || b.number - a.number);
  } catch (e) {
    logger(deps)(`github-app: listDataPulls: ${describe(e)}`);
    return [];
  }
}

/** The data PR a pipeline run opened: its run number in the branch (college-reported), or its date (identity refresh). */
export function pullForRun(run: WorkflowRun, pulls: readonly DataPull[]): DataPull | null {
  if (run.workflow === "college-reported.yml") return pulls.find((p) => p.runNumber === run.runNumber) ?? null;
  if (run.workflow === "identity-refresh.yml") {
    const day = run.createdAt.slice(0, 10).replace(/-/g, "");
    return pulls.find((p) => p.branch === `data/identity-refresh-${day}`) ?? null;
  }
  return null;
}

async function getPull(n: number, deps: GithubDeps): Promise<RawPull> {
  const r = await api<RawPull>(deps, "GET", `/pulls/${n}`);
  if (r.status !== 200 || !r.data) throw new GithubError(`pull ${n} ${r.status}`, r.status);
  return r.data;
}

function isConsolePull(p: RawPull): boolean {
  return p.base?.ref === BASE_BRANCH && DATA_PULL_PREFIXES.some((prefix) => p.head?.ref?.startsWith(prefix));
}

export type MergeResult = { ok: true } | { ok: false; reason: "checks_pending" | "checks_failed" | "error"; detail?: string };

/**
 * Approve and merge: squash-merges a data or review PR (`PUT …/pulls/{n}/merge`, pinned to the head commit the checks
 * ran on), refused while its checks are pending or never started (`checks_pending`; Re-run CI starts them) or any
 * failed (`checks_failed`). Only PRs into `main` from a `data/` or `review/` branch.
 */
export async function mergePull(n: number, deps: GithubDeps = {}): Promise<MergeResult> {
  if (!githubConfigured(deps.env ?? process.env)) return { ok: false, reason: "error", detail: "not_configured" };
  try {
    const pull = await getPull(n, deps);
    if (!isConsolePull(pull)) return { ok: false, reason: "error", detail: "not a data or review pull request" };
    if (pull.state !== "open") return { ok: false, reason: "error", detail: "not open" };
    if (pull.draft) return { ok: false, reason: "error", detail: "draft" };
    const sha = pull.head?.sha ?? "";
    const checks = await checksFor(sha, deps);
    if (checks === "pending" || checks === "none") return { ok: false, reason: "checks_pending" };
    if (checks === "failure") return { ok: false, reason: "checks_failed" };
    const r = await api(deps, "PUT", `/pulls/${n}/merge`, { body: { merge_method: "squash", sha } });
    if (r.status === 200) return { ok: true };
    return { ok: false, reason: "error", detail: `merge ${r.status}${ghMessage(r.data) ? `: ${ghMessage(r.data)}` : ""}` };
  } catch (e) {
    logger(deps)(`github-app: mergePull ${n}: ${describe(e)}`);
    return { ok: false, reason: "error", detail: describe(e) };
  }
}

export type PullActionResult = { ok: true } | { ok: false; reason: string };

const DISABLE_AUTO_MERGE = "mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }";
const ENABLE_AUTO_MERGE = "mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { clientMutationId } }";

/** A short label for who acted, safe for a public comment: one line, no markdown links or mentions. */
function adminLabel(admin: string): string {
  return admin.replace(/[\r\n]+/g, " ").replace(/[@[\]()<>`]/g, "").trim().slice(0, 80) || "an admin";
}

async function comment(n: number, body: string, deps: GithubDeps): Promise<void> {
  const r = await api(deps, "POST", `/issues/${n}/comments`, { body: { body } });
  if (r.status !== 201) throw new GithubError(`comment ${r.status}`, r.status);
}

/**
 * Hold: turns auto-merge off (GraphQL `disablePullRequestAutoMerge`; REST has no endpoint) and comments who held it.
 * `admin` is a display name for a public comment (never an email address).
 */
export async function holdPull(n: number, admin: string, deps: GithubDeps = {}): Promise<PullActionResult> {
  if (!githubConfigured(deps.env ?? process.env)) return { ok: false, reason: "not_configured" };
  try {
    const pull = await getPull(n, deps);
    if (!isConsolePull(pull)) return { ok: false, reason: "not a data or review pull request" };
    if (pull.auto_merge && pull.node_id) {
      const g = await graphql(deps, DISABLE_AUTO_MERGE, { id: pull.node_id });
      if (!g.ok) return { ok: false, reason: g.detail };
    }
    await comment(n, `Held by ${adminLabel(admin)} from the admin console: auto-merge is off until someone merges this by hand.`, deps);
    return { ok: true };
  } catch (e) {
    logger(deps)(`github-app: holdPull ${n}: ${describe(e)}`);
    return { ok: false, reason: describe(e) };
  }
}

/** Close: comments who closed it, then closes the PR (the branch stays, as when a person closes one). */
export async function closePull(n: number, admin: string, deps: GithubDeps = {}): Promise<PullActionResult> {
  if (!githubConfigured(deps.env ?? process.env)) return { ok: false, reason: "not_configured" };
  try {
    const pull = await getPull(n, deps);
    if (!isConsolePull(pull)) return { ok: false, reason: "not a data or review pull request" };
    await comment(n, `Closed by ${adminLabel(admin)} from the admin console.`, deps);
    const r = await api(deps, "PATCH", `/pulls/${n}`, { body: { state: "closed" } });
    if (r.status !== 200) return { ok: false, reason: `close ${r.status}` };
    return { ok: true };
  } catch (e) {
    logger(deps)(`github-app: closePull ${n}: ${describe(e)}`);
    return { ok: false, reason: describe(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Files and the review-queue PR                                       */
/* ------------------------------------------------------------------ */

/** Repository paths the console may write: the review queue's three files and its own release notes. */
export const WRITABLE_PATHS = new Set(["data/overrides.json", "data/review-queue.json", "data/college-sources.json"]);
const RELEASE_NOTE_PATH = /^release-notes\/[a-z0-9-]+\.md$/;

/** `unchanged`: the blob sha equals `knownSha`, so the content wasn't downloaded (it is ""). */
export type ReadFileResult = { ok: true; content: string; sha: string; unchanged?: boolean } | { ok: false; reason: string };

/**
 * A file on `main` (or `ref`) and its blob sha, so an edit is computed from what is committed now rather than from the
 * deployed copy, and `commitFileAndOpenPull({ baseSha })` can refuse if it changed meanwhile. Files over 1 MB (the
 * review queue) come through the raw media type. With `knownSha` (the sha last read), an unchanged file isn't downloaded.
 */
export async function readRepoFile(path: string, deps: GithubDeps & { ref?: string; knownSha?: string } = {}): Promise<ReadFileResult> {
  if (!githubConfigured(deps.env ?? process.env)) return { ok: false, reason: "not_configured" };
  const ref = encodeURIComponent(deps.ref ?? BASE_BRANCH);
  const p = path.split("/").map(encodeURIComponent).join("/");
  try {
    const meta = await api<{ sha?: string; content?: string; encoding?: string; size?: number }>(deps, "GET", `/contents/${p}?ref=${ref}`, {
      accept: "application/vnd.github.object+json",
    });
    if (meta.status !== 200 || !meta.data?.sha) return { ok: false, reason: `read ${meta.status}` };
    if (deps.knownSha && meta.data.sha === deps.knownSha) return { ok: true, content: "", sha: meta.data.sha, unchanged: true };
    if (meta.data.encoding === "base64" && meta.data.content) {
      return { ok: true, content: Buffer.from(meta.data.content, "base64").toString("utf8"), sha: meta.data.sha };
    }
    const raw = await api<string>(deps, "GET", `/contents/${p}?ref=${ref}`, { accept: "application/vnd.github.raw+json", raw: true, timeoutMs: 60_000 });
    if (raw.status !== 200) return { ok: false, reason: `read ${raw.status}` };
    return { ok: true, content: raw.data, sha: meta.data.sha };
  } catch (e) {
    logger(deps)(`github-app: readRepoFile ${path}: ${describe(e)}`);
    return { ok: false, reason: describe(e) };
  }
}

export interface CommitAndPullOptions {
  branch: string;
  path: string;
  content: string;
  message: string;
  title: string;
  body: string;
  /** Its content may hold `PR_NUMBER_PLACEHOLDER`, replaced with the PR's number once the PR exists. */
  releaseNote: { path: string; content: string };
  /** The blob sha the edit was computed from (`readRepoFile`): refuse with `file_changed` if `main` has moved on. */
  baseSha?: string;
}

export type CommitAndPullResult = { ok: true; number: number; url: string; autoMerge: boolean } | { ok: false; reason: string };

async function putFile(deps: GithubDeps, path: string, body: Record<string, unknown>) {
  return api(deps, "PUT", `/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { body, timeoutMs: deps.timeoutMs ?? 60_000 });
}

/**
 * The console's file change, made the way a person would: a new branch from `main`, one commit of `path` through the
 * Contents API, a PR into `main` with the generated body, then the release note (it names the PR's number, so it is a
 * second commit on the same branch, as the pipelines do), and auto-merge on (squash). CI runs as on any PR. A failure
 * before the PR exists deletes the branch; auto-merge that can't be turned on leaves the PR open (`autoMerge: false`).
 */
export async function commitFileAndOpenPull(opts: CommitAndPullOptions, deps: GithubDeps = {}): Promise<CommitAndPullResult> {
  if (!githubConfigured(deps.env ?? process.env)) return { ok: false, reason: "not_configured" };
  if (!opts.branch.startsWith("review/") || !BRANCH.test(opts.branch)) return { ok: false, reason: "bad_branch" };
  if (!WRITABLE_PATHS.has(opts.path)) return { ok: false, reason: "path_not_writable" };
  if (!RELEASE_NOTE_PATH.test(opts.releaseNote.path)) return { ok: false, reason: "bad_release_note_path" };
  const log = logger(deps);
  let branchCreated = false;
  try {
    const head = await api<{ object?: { sha?: string } }>(deps, "GET", `/git/ref/heads/${BASE_BRANCH}`);
    const mainSha = head.data?.object?.sha;
    if (head.status !== 200 || !mainSha) return { ok: false, reason: `main ${head.status}` };

    const created = await api(deps, "POST", `/git/refs`, { body: { ref: `refs/heads/${opts.branch}`, sha: mainSha } });
    if (created.status === 422) return { ok: false, reason: "branch_exists" };
    if (created.status !== 201) return { ok: false, reason: `branch ${created.status}` };
    branchCreated = true;

    const existing = await api<{ sha?: string }>(deps, "GET", `/contents/${opts.path}?ref=${encodeURIComponent(opts.branch)}`, {
      accept: "application/vnd.github.object+json",
    });
    const fileSha = existing.status === 200 ? existing.data?.sha : undefined;
    if (existing.status !== 200 && existing.status !== 404) throw new GithubError(`read ${existing.status}`, existing.status);
    if (opts.baseSha && fileSha !== opts.baseSha) throw new GithubError("file_changed");

    const put = await putFile(deps, opts.path, {
      message: opts.message,
      content: Buffer.from(opts.content, "utf8").toString("base64"),
      branch: opts.branch,
      ...(fileSha ? { sha: fileSha } : {}),
    });
    if (put.status !== 200 && put.status !== 201) throw new GithubError(`commit ${put.status}`, put.status);

    const pr = await api<{ number?: number; html_url?: string; node_id?: string }>(deps, "POST", `/pulls`, {
      body: { title: opts.title, head: opts.branch, base: BASE_BRANCH, body: opts.body },
    });
    if (pr.status !== 201 || !pr.data?.number) throw new GithubError(`pull ${pr.status}`, pr.status);
    branchCreated = false; // the PR owns the branch now
    const number = pr.data.number;
    const url = pr.data.html_url ?? "";

    const note = opts.releaseNote.content.split(PR_NUMBER_PLACEHOLDER).join(String(number));
    const notePut = await putFile(deps, opts.releaseNote.path, {
      message: `Release note for #${number}`,
      content: Buffer.from(note, "utf8").toString("base64"),
      branch: opts.branch,
    });
    if (notePut.status !== 201 && notePut.status !== 200) {
      log(`github-app: release note for #${number}: ${notePut.status}`);
      return { ok: false, reason: `release_note ${notePut.status} (PR #${number} is open without its note)` };
    }

    let autoMerge = false;
    if (pr.data.node_id) {
      const g = await graphql(deps, ENABLE_AUTO_MERGE, { id: pr.data.node_id });
      autoMerge = g.ok;
      if (!g.ok) log(`github-app: auto-merge for #${number}: ${g.detail}`);
    }
    return { ok: true, number, url, autoMerge };
  } catch (e) {
    log(`github-app: commitFileAndOpenPull ${opts.branch}: ${describe(e)}`);
    if (branchCreated) {
      await api(deps, "DELETE", `/git/refs/heads/${opts.branch}`).catch(() => undefined);
    }
    return { ok: false, reason: describe(e) };
  }
}

/* ------------------------------------------------------------------ */
/* The cost shown before a full run                                    */
/* ------------------------------------------------------------------ */

/** Run summaries read so far, by blob sha (a summary never changes once its run has finished), trimmed to what's needed. */
const summaryCache = new Map<string, RunSummaryLike>();
/** Summaries read per call at most, newest first, looking for the last full run. */
const MAX_SUMMARIES = 25;

function trimSummary(s: RunSummaryLike): RunSummaryLike {
  return { run: s.run, finished: s.finished ?? null, started: s.started, total: s.total, usage: s.usage, usage_rows: s.usage_rows?.map((r) => ({ cost_usd: r.cost_usd })), projection: s.projection ?? null };
}

/**
 * The last full run's cost and the newest full-run projection (lib/admin/workflows.ts `lastFullRunCost`), from the run
 * summaries on `main` (data/reports/college-reported-run-<run>.json): the folder listing, then summaries newest first
 * until one covered every college. Null when GitHub isn't configured or can't be read.
 */
export async function fetchRunCost(deps: GithubDeps = {}): Promise<FullRunCost | null> {
  if (!githubConfigured(deps.env ?? process.env)) return null;
  try {
    const list = await api<{ name?: string; path?: string; sha?: string; type?: string }[]>(deps, "GET", `/contents/data/reports?ref=${BASE_BRANCH}`);
    if (list.status !== 200 || !Array.isArray(list.data)) throw new GithubError(`reports ${list.status}`, list.status);
    const files = list.data
      .filter((f) => f.type === "file" && /^college-reported-run-.+\.json$/.test(f.name ?? "") && f.sha && f.path)
      .sort((a, b) => (a.name! < b.name! ? 1 : -1))
      .slice(0, MAX_SUMMARIES);
    const read: RunSummaryLike[] = [];
    for (const f of files) {
      let s = summaryCache.get(f.sha!);
      if (!s) {
        const file = await readRepoFile(f.path!, deps);
        if (!file.ok) throw new GithubError(`${f.path}: ${file.reason}`);
        const parsed = JSON.parse(file.content) as RunSummaryLike;
        if (typeof parsed.run !== "string") continue;
        s = trimSummary(parsed);
        summaryCache.set(f.sha!, s);
      }
      read.push(s);
      if ((s.total ?? 0) >= FULL_RUN_MIN_COLLEGES) break;
    }
    return lastFullRunCost(read);
  } catch (e) {
    logger(deps)(`github-app: fetchRunCost: ${describe(e)}`);
    return null;
  }
}
