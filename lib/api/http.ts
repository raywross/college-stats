/**
 * Shared plumbing for the public read API and the MCP endpoint (specs/product/assistants.md): CORS for browser-based
 * clients, one in-memory limiter per server instance, JSON responses with the dataset stamp, and the request's own
 * origin for the links in every response (the site has no SITE_URL; routes use the request's origin, as the crons do).
 */
import { createLimiter, take, clientIp } from "@/lib/chances/rate-limit";

/** Per IP: a minute's burst of 60, refilling one a second. Assistants call a few tools per answer; scrapers don't. */
export const PUBLIC_API_LIMITS = { ip: { capacity: 60, refillPerSecond: 1 }, user: { capacity: 60, refillPerSecond: 1 } } as const;

const limiter = createLimiter(PUBLIC_API_LIMITS);

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, X-Dataset-Publish, Retry-After",
  "Access-Control-Max-Age": "86400",
};

/** A limiter decision for this request; `cost` 0 means count nothing (a tools/list or an OPTIONS preflight). */
export function limitFor(headers: Headers, cost = 1): { ok: true } | { ok: false; retryAfter: number } {
  if (cost === 0) return { ok: true };
  return take(limiter, { ip: clientIp(headers), userId: null }, cost);
}

export function tooMany(retryAfter: number): Response {
  return json({ error: "Too many requests. Try again in a moment." }, { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfter)) } });
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string>; stamp?: string; cache?: string } = {}): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...(init.headers ?? {}) };
  if (init.stamp) headers["X-Dataset-Publish"] = init.stamp;
  if (init.cache) headers["Cache-Control"] = init.cache;
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** The public origin for links: the request's own (a preview deploy links to itself). */
export function originOf(request: Request): string {
  return new URL(request.url).origin;
}

/** Cache public GETs for five minutes at the browser and an hour at the edge; the data changes with a deploy. */
export const PUBLIC_CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/** The first value of each query parameter, as the Explore page's own parser expects. */
export function paramsOf(url: URL): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of url.searchParams) if (!(k in out)) out[k] = v;
  return out;
}
