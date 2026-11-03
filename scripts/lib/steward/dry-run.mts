/**
 * `--dry-run <dir>`: the Steward's whole loop with recorded model answers instead of the API (specs/product/
 * data-steward.md "Models and cost"; the fixtures are tests/fixtures/steward/answers/). The SDK's client is built with
 * a `fetch` of our own, so the tool runner, the tools and the budget run exactly as they do live; only the HTTP call to
 * `POST /v1/messages` is answered from a file:
 *
 *   <dir>/<key>.json   { key, model, note?, response: <the Messages API response body> }
 *
 * `key` is `requestKey(body)`: the first 16 hex characters of the sha256 of the request body's stable JSON (keys sorted,
 * `stream` and `max_tokens` left out), so a request that changes in any way the model would see needs a new answer.
 * A missing answer fails the run with the key, and the request is saved under `<tmpdir>/steward-requests/<key>.json` for
 * whoever writes the answer.
 *
 * Recording: with `STEWARD_RECORD=1` and `ANTHROPIC_API_KEY` set (never in CI), a missing answer is fetched from the
 * API and saved under its key.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orderedJson } from "../data-platform/store.mts";

/** The stable key of a Messages request body. */
export function requestKey(body: Record<string, unknown>): string {
  const rest = { ...body };
  delete rest.stream;
  delete rest.max_tokens;
  return createHash("sha256").update(orderedJson(rest)).digest("hex").slice(0, 16);
}

export interface RecordedAnswer {
  key: string;
  model: string;
  note?: string;
  response: Record<string, unknown>;
}

export class MissingAnswer extends Error {
  readonly key: string;
  readonly requestPath: string;
  constructor(key: string, requestPath: string) {
    super(`dry run: no recorded answer ${key} (the request is at ${requestPath})`);
    this.name = "MissingAnswer";
    this.key = key;
    this.requestPath = requestPath;
  }
}

export interface RecordedFetchOptions {
  env?: Readonly<Record<string, string | undefined>>;
  /** The real fetch, for recording. */
  fetch?: typeof globalThis.fetch;
  /** Every key asked for, in order (tests read it). */
  asked?: string[];
}

/** Whether a dry run may record missing answers from the live API. */
export function mayRecord(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.STEWARD_RECORD === "1" && !!env.ANTHROPIC_API_KEY && !env.CI;
}

/** A `fetch` that answers `POST …/v1/messages` from `<dir>/<key>.json`. */
export function recordedFetch(dir: string, opts: RecordedFetchOptions = {}): typeof globalThis.fetch {
  const env = opts.env ?? process.env;
  // A sub-read's missing answer surfaces inside a tool, which the runner turns into a tool error; every request after
  // it fails with the same answer missing, so the run stops on the first one.
  let missing: MissingAnswer | null = null;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (missing) throw missing;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/v1\/messages(\?|$)/.test(url)) throw new Error(`dry run: no request may leave the process (${url})`);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const key = requestKey(body);
    opts.asked?.push(key);
    const file = join(dir, `${key}.json`);
    if (existsSync(file)) {
      const answer = JSON.parse(readFileSync(file, "utf8")) as RecordedAnswer;
      return new Response(JSON.stringify(answer.response), { status: 200, headers: { "content-type": "application/json", "request-id": `dry-run-${key}` } });
    }
    if (mayRecord(env)) {
      const real = opts.fetch ?? globalThis.fetch;
      const headers = new Headers(init?.headers);
      headers.set("x-api-key", env.ANTHROPIC_API_KEY!);
      const res = await real(input, { ...init, headers });
      const text = await res.text();
      if (res.ok) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, `${JSON.stringify({ key, model: String(body.model), note: "recorded from the live API", response: JSON.parse(text) }, null, 2)}\n`);
      }
      return new Response(text, { status: res.status, headers: res.headers });
    }
    const saved = join(tmpdir(), "steward-requests");
    mkdirSync(saved, { recursive: true });
    const requestPath = join(saved, `${key}.json`);
    writeFileSync(requestPath, `${JSON.stringify(body, null, 2)}\n`);
    missing = new MissingAnswer(key, requestPath);
    throw missing;
  }) as typeof globalThis.fetch;
}
