/**
 * Run records for the Vercel cron routes (specs/product/admin-jobs.md "Run records"): `withJobRun(job, handler)` wraps a
 * route's handler so every run leaves a row in `job_runs` (supabase/migrations/20261101120000_job_runs.sql): a row
 * when it starts (`running`), updated when it ends with the outcome, the handler's JSON answer as the summary, and the
 * error when it failed. The admin console's Jobs pages read the rows.
 *
 * Rules:
 * - The bearer check comes first and an unauthorized call leaves no row (anyone can hit the URL).
 * - The outcome is read off the handler's own response: a 4xx or 5xx is `failed` (with the body's `error`), a body
 *   saying `configured: false` is `skipped` (the job had nothing it could do), anything else `ok`.
 * - Recording never changes what the job does: a database that can't be reached is logged and the job runs anyway;
 *   a handler that throws is recorded `failed` and answered with a 500 the way Next would.
 * - `trigger` is `schedule` when Vercel Cron called (its user agent), else `manual` (a person with the secret).
 * Plain module (no Next imports but a type), with the recorder injectable, so tests/jobs.test.mts runs it with a fake.
 */
import type { NextRequest } from "next/server";
import { isAuthorized } from "../revalidate.ts";
import { supabaseClient } from "../supabase.ts";
import type { JobId } from "./registry.ts";

export type RunTrigger = "schedule" | "manual";
export type StoredRunStatus = "running" | "ok" | "failed" | "skipped";

export interface RunFinish {
  status: Exclude<StoredRunStatus, "running">;
  httpStatus: number | null;
  summary: Record<string, unknown>;
  error: string | null;
  durationMs: number;
  finishedAt: Date;
}

/** Where run rows go. The real one writes `job_runs` with the secret key; tests pass a fake. */
export interface RunRecorder {
  /** Returns the new row's id, or null when it couldn't be written. */
  start(job: JobId, trigger: RunTrigger, startedAt: Date): Promise<number | null>;
  finish(id: number, result: RunFinish): Promise<void>;
}

/** Vercel Cron identifies itself this way (Vercel's documented convention). */
export const VERCEL_CRON_AGENT = "vercel-cron/";

export function triggerOf(userAgent: string | null | undefined): RunTrigger {
  return userAgent?.toLowerCase().startsWith(VERCEL_CRON_AGENT) ? "schedule" : "manual";
}

/** A summary larger than this is kept as a note of its size, not stored (the digest's per-publish list is tiny). */
export const SUMMARY_MAX_BYTES = 100_000;

/** The outcome a handler's response means. Exported for tests. */
export function outcomeOf(httpStatus: number, body: unknown): Pick<RunFinish, "status" | "summary" | "error"> {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : body === undefined ? {} : { value: body };
  if (httpStatus >= 400) {
    const err = typeof record.error === "string" ? record.error : `HTTP ${httpStatus}`;
    return { status: "failed", summary: record, error: err };
  }
  if (record.configured === false) return { status: "skipped", summary: record, error: null };
  return { status: "ok", summary: record, error: null };
}

/** The response body as JSON, or a note when it isn't JSON or is too large. Never throws. */
async function readBody(response: Response): Promise<unknown> {
  try {
    const text = await response.clone().text();
    if (!text) return {};
    if (text.length > SUMMARY_MAX_BYTES) return { note: `the answer was ${text.length.toLocaleString("en-US")} characters; not stored` };
    return JSON.parse(text) as unknown;
  } catch {
    return { note: "the answer wasn't JSON" };
  }
}

/** Rows older than this are deleted when a job records a new run, so the table stays small without a job of its own. */
export const KEEP_DAYS = 180;

type Row = Record<string, unknown>;
interface ClientLike {
  from(table: string): {
    insert(row: Row): { select(cols: string): { single(): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
    update(row: Row): { eq(col: string, v: unknown): PromiseLike<{ error: { message: string } | null }> };
    delete(): { lt(col: string, v: unknown): PromiseLike<{ error: { message: string } | null }> };
  };
}

/** The recorder over `job_runs`. `client` is made on first use so a deployment without the secret key still runs its jobs. */
export function supabaseRecorder(deps: { client?: () => ClientLike; log?: (msg: string) => void } = {}): RunRecorder {
  const log = deps.log ?? ((msg: string) => console.warn(msg));
  let client: ClientLike | null | undefined;
  const get = (): ClientLike | null => {
    if (client !== undefined) return client;
    try {
      client = (deps.client ?? (() => supabaseClient("publish") as unknown as ClientLike))();
    } catch (e) {
      log(`job_runs: not recording (${e instanceof Error ? e.message : String(e)})`);
      client = null;
    }
    return client;
  };
  return {
    async start(job, trigger, startedAt) {
      const c = get();
      if (!c) return null;
      try {
        const { data, error } = await c.from("job_runs").insert({ job, trigger, started_at: startedAt.toISOString(), status: "running" }).select("id").single();
        if (error) throw new Error(error.message);
        const id = (data as { id?: unknown } | null)?.id;
        return typeof id === "number" ? id : null;
      } catch (e) {
        log(`job_runs: couldn't record the start of ${job}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    },
    async finish(id, result) {
      const c = get();
      if (!c) return;
      try {
        const { error } = await c
          .from("job_runs")
          .update({
            status: result.status,
            http_status: result.httpStatus,
            summary: result.summary,
            error: result.error,
            duration_ms: result.durationMs,
            finished_at: result.finishedAt.toISOString(),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        const cutoff = new Date(result.finishedAt.getTime() - KEEP_DAYS * 86_400_000).toISOString();
        const { error: purgeError } = await c.from("job_runs").delete().lt("started_at", cutoff);
        if (purgeError) log(`job_runs: couldn't purge old rows: ${purgeError.message}`);
      } catch (e) {
        log(`job_runs: couldn't record the end of run ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

type Handler = (request: NextRequest) => Promise<Response> | Response;

export interface WithJobRunDeps {
  recorder?: RunRecorder;
  /** The bearer secret; `process.env.CRON_SECRET` by default. */
  secret?: () => string | undefined;
  now?: () => Date;
}

/**
 * A cron route's handler with its runs recorded. The bearer check happens here (the handlers keep their own: harmless
 * twice, and a handler still refuses when called some other way).
 */
export function withJobRun(job: JobId, handler: Handler, deps: WithJobRunDeps = {}): (request: NextRequest) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const secret = deps.secret ?? (() => process.env.CRON_SECRET);
  let recorder = deps.recorder;
  return async (request) => {
    if (!isAuthorized(request.headers.get("authorization"), secret())) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    recorder ??= supabaseRecorder();
    const startedAt = now();
    const id = await recorder.start(job, triggerOf(request.headers.get("user-agent")), startedAt);
    const finish = async (httpStatus: number, body: unknown, thrown?: string) => {
      if (id === null) return;
      const finishedAt = now();
      const outcome = outcomeOf(httpStatus, body);
      await recorder!.finish(id, { ...outcome, error: thrown ?? outcome.error, httpStatus, durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()), finishedAt });
    };
    try {
      const response = await handler(request);
      await finish(response.status, await readBody(response));
      return response;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await finish(500, { error: message }, message);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}
