import "server-only";
/**
 * The Data API's key check (specs/product/data-api.md "Who may call, and how"), shared by the REST routes (through
 * lib/api/handler.ts withApiKey) and the MCP server. One lookup path: the bearer token is hashed here and sent to
 * api_key_use(p_hash, p_endpoint) (supabase/migrations/20261020130000_api_keys.sql) with the publishable key, which
 * finds the unrevoked key of an active owner, counts the request against the day, and answers whether it's allowed.
 * Then the per-minute burst guard (API_KEY_LIMITS.perMinute, an in-memory token bucket per key per server instance).
 *
 * Outcomes: no key → 401 missing_key; a malformed, unknown, or revoked key, or a paused or deleted owner → 401
 * invalid_key; over the day or the minute → 429 rate_limited with Retry-After; Supabase unconfigured or failing → 503
 * unavailable (the dataset is fine; the gate isn't). Every request is recorded as `api_request` (recordApiRequest),
 * never with the key or the query.
 *
 * Server only (the Supabase client and telemetry). Tests inject the lookup and the clock through ApiAuthDeps.
 */
import { supabaseClient } from "@/lib/supabase";
import { trackServer } from "@/lib/analytics-server";
import { TokenBuckets } from "@/lib/chances/rate-limit";
import { API_KEY_LIMITS, bearerToken, hashApiKey, isApiKey } from "@/lib/api/keys";

export type ApiTier = "account";

export interface ApiPrincipal {
  keyId: string;
  userId: string;
  tier: ApiTier;
  usedToday: number;
  limitPerDay: number;
}

export type ApiAuthResult =
  | { ok: true; principal: ApiPrincipal }
  | {
      ok: false;
      status: 401 | 429 | 503;
      code: "missing_key" | "invalid_key" | "rate_limited" | "unavailable";
      message: string;
      retryAfter?: number;
    };

/** One row of api_key_use(): the key, its owner, and today's count against the tier's limit. */
export interface KeyUseRow {
  key_id: string;
  user_id: string;
  tier: ApiTier;
  allowed: boolean;
  used_today: number;
  limit_per_day: number;
}

/** Injectable for tests: `lookup(hash, endpoint)` replaces the Supabase call; `now` the clock (ms); `buckets` the burst guard. */
export interface ApiAuthDeps {
  lookup?: (hash: string, endpoint: string) => Promise<KeyUseRow | null>;
  now?: () => number;
  buckets?: TokenBuckets;
}

/** The burst guard: 60 a minute per key, refilled one a second, per server instance. */
export const MINUTE_BUCKETS = new TokenBuckets({ capacity: API_KEY_LIMITS.perMinute, refillPerSecond: API_KEY_LIMITS.perMinute / 60 });

const GET_A_KEY = "Make one on your account page: /account/api-keys.";

export const AUTH_MESSAGES = {
  missing_key: `Send your API key as "Authorization: Bearer quad_…". ${GET_A_KEY}`,
  invalid_key: `This key isn't valid: it may be mistyped or revoked, or its account paused. ${GET_A_KEY}`,
  day_limit: `This key has used its ${API_KEY_LIMITS.perDay.toLocaleString("en-US")} requests for today. The count starts again at midnight UTC.`,
  minute_limit: `Too many requests: a key may make ${API_KEY_LIMITS.perMinute} a minute. Try again shortly.`,
  unavailable: "The key check isn't available right now (the data is fine). Try again in a minute.",
} as const;

/** Seconds from `now` to the next midnight UTC, when api_key_use()'s daily count starts again (at least 1). */
export function secondsUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/**
 * The real lookup: api_key_use() through the publishable-key client. Throws when Supabase isn't configured or the call
 * fails (the migration not applied, the project paused), which the caller turns into 503.
 */
export async function lookupKeyUse(hash: string, endpoint: string): Promise<KeyUseRow | null> {
  const { data, error } = await supabaseClient("read").rpc("api_key_use", { p_hash: hash, p_endpoint: endpoint });
  if (error) throw new Error(`api_key_use failed: ${error.message}`);
  const rows = (data ?? []) as KeyUseRow[];
  return rows[0] ?? null;
}

/**
 * Checks a bearer token (already taken from its header) for `endpoint`. The single path both surfaces use: the REST
 * routes through authenticateApiRequest, the MCP server's verifyToken directly.
 */
export async function verifyApiKeyToken(token: string | null, endpoint: string, deps: ApiAuthDeps = {}): Promise<ApiAuthResult> {
  if (!token) return { ok: false, status: 401, code: "missing_key", message: AUTH_MESSAGES.missing_key };
  // A token that can't be a key is refused without a round trip (and without counting anything).
  if (!isApiKey(token)) return { ok: false, status: 401, code: "invalid_key", message: AUTH_MESSAGES.invalid_key };

  const now = (deps.now ?? Date.now)();
  const buckets = deps.buckets ?? MINUTE_BUCKETS;
  const hash = hashApiKey(token);
  // The burst guard runs first, keyed by the hash (one per key), so a refused burst neither reaches the database nor
  // counts against the day. Only requests that pass the key check spend a token.
  const wait = buckets.waitFor(hash, 1, now);
  if (wait > 0) return { ok: false, status: 429, code: "rate_limited", message: AUTH_MESSAGES.minute_limit, retryAfter: wait };

  let row: KeyUseRow | null;
  try {
    row = await (deps.lookup ?? lookupKeyUse)(hash, endpoint);
  } catch (err) {
    console.error(`[api] key check failed for ${endpoint}:`, err instanceof Error ? err.message : err);
    return { ok: false, status: 503, code: "unavailable", message: AUTH_MESSAGES.unavailable, retryAfter: 60 };
  }
  if (!row) return { ok: false, status: 401, code: "invalid_key", message: AUTH_MESSAGES.invalid_key };
  if (!row.allowed) return { ok: false, status: 429, code: "rate_limited", message: AUTH_MESSAGES.day_limit, retryAfter: secondsUntilUtcMidnight(now) };

  buckets.spend(hash, 1, now);
  return {
    ok: true,
    principal: { keyId: row.key_id, userId: row.user_id, tier: row.tier, usedToday: row.used_today, limitPerDay: row.limit_per_day },
  };
}

/** Reads Authorization, hashes, calls api_key_use(p_hash, p_endpoint) through supabaseClient("read"), applies the per-minute bucket. */
export function authenticateApiRequest(request: Request, endpoint: string, deps?: ApiAuthDeps): Promise<ApiAuthResult> {
  return verifyApiKeyToken(bearerToken(request.headers.get("authorization")), endpoint, deps);
}

/** What /api/v1/me shows about the calling key beyond api_key_use(): names and dates (api_key_info()). */
export interface ApiKeyInfo {
  key_id: string;
  key_name: string;
  key_prefix: string;
  tier: string;
  created: string;
  last_used_at: string | null;
  display_name: string | null;
}

/** api_key_info() for the request's key, or null when it can't be read (the route then shows what it has). Never throws. */
export async function lookupKeyInfo(request: Request): Promise<ApiKeyInfo | null> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token || !isApiKey(token)) return null;
  try {
    const { data, error } = await supabaseClient("read").rpc("api_key_info", { p_hash: hashApiKey(token) });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ApiKeyInfo[])[0] ?? null;
  } catch (err) {
    console.error("[api] api_key_info failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Sends the api_request telemetry event (never throws). Anonymous: the key id is a property, never a person. */
export async function recordApiRequest(args: { endpoint: string; status: number; transport: "rest" | "mcp"; keyId: string | null }): Promise<void> {
  try {
    await trackServer("api_request", { endpoint: args.endpoint, status: args.status, transport: args.transport, key_id: args.keyId ?? "" });
  } catch {
    // trackServer never throws; this keeps the promise that recordApiRequest doesn't either.
  }
}
