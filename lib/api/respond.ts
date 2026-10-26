/**
 * Data API responses (specs/product/data-api.md "Endpoints"): JSON with `Cache-Control: private, no-store` (keyed and
 * counted, so the CDN never serves them), `X-Dataset-Retrieved` (the dataset's retrieved date), an `ETag` (SHA-1 of
 * the body; a matching `If-None-Match` gets 304 with no body), and errors as `{ error: { code, message } }`.
 *
 * Plain module (web Response and node:crypto, no Next imports), so tests call it directly.
 */
import { createHash } from "node:crypto";
import type { ApiAuthResult } from "./auth";

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Error codes the API sends (specs/product/data-api.md "Errors"). */
export type ApiErrorCode = "missing_key" | "invalid_key" | "rate_limited" | "unavailable" | "not_found" | "bad_request" | "internal";

const PRIVATE = "private, no-store";

/** `"<sha1 hex>"`: a strong validator for the exact body bytes. */
export function etagFor(text: string): string {
  return `"${createHash("sha1").update(text, "utf8").digest("hex")}"`;
}

/** Whether an If-None-Match header names `etag` (a list, weak forms, or `*`). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === etag);
}

/**
 * A JSON response with the API's headers. With `request`, a 200 whose ETag the request's If-None-Match names comes back
 * as 304 with no body (the same headers otherwise).
 */
export function apiJson(
  body: unknown,
  init: { status?: number; retrieved?: string; request?: Request; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  const text = JSON.stringify(body);
  const etag = etagFor(text);
  const headers: Record<string, string> = {
    "Cache-Control": PRIVATE,
    ETag: etag,
    ...(init.retrieved ? { "X-Dataset-Retrieved": init.retrieved } : {}),
    ...init.headers,
  };
  if (status === 200 && init.request && etagMatches(init.request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

/** `{ error: { code, message } }` with the API's no-store header (no ETag: errors aren't revalidated). */
export function apiError(status: number, code: ApiErrorCode | (string & {}), message: string, headers?: Record<string, string>): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": PRIVATE, ...headers },
  });
}

/** A failed key check as its error response: `Retry-After` on a 429 (and a 503 that gives one), `WWW-Authenticate` on a 401. */
export function authFailure(result: Extract<ApiAuthResult, { ok: false }>): Response {
  const headers: Record<string, string> = {};
  if (result.retryAfter !== undefined) headers["Retry-After"] = String(result.retryAfter);
  if (result.status === 401) headers["WWW-Authenticate"] = `Bearer realm="Quad API", error="${result.code === "missing_key" ? "invalid_request" : "invalid_token"}"`;
  return apiError(result.status, result.code, result.message, headers);
}
