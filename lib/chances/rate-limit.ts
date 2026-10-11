/**
 * The estimate endpoint's limiter (specs/chances/estimate.md "No bulk or probing access"; owner assumption 4): an
 * in-memory token bucket per IP and per signed-in user, per server instance. Pre-launch only; a durable limiter
 * replaces it at launch. Pure apart from its own map, with the clock passed in, so tests drive it directly.
 */

export interface BucketConfig {
  /** Most tokens a key can hold (the burst). */
  capacity: number;
  /** Tokens added back per second. */
  refillPerSecond: number;
}

/** Per IP and per user. A request costs one token per five colleges (estimate-request.ts requestCost). */
export const ESTIMATE_LIMITS = {
  ip: { capacity: 120, refillPerSecond: 1 },
  user: { capacity: 200, refillPerSecond: 2 },
} as const satisfies Record<string, BucketConfig>;

/** Stale keys are dropped when the map grows past this (a full bucket carries no state worth keeping). */
const MAX_KEYS = 10_000;

export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly config: BucketConfig;
  constructor(config: BucketConfig) {
    this.config = config;
  }

  /** Tokens `key` holds at `now` (ms), after refilling. */
  available(key: string, now: number): number {
    const b = this.buckets.get(key);
    if (!b) return this.config.capacity;
    return Math.min(this.config.capacity, b.tokens + (Math.max(0, now - b.at) / 1000) * this.config.refillPerSecond);
  }

  /** Seconds until `key` holds `cost` tokens (0 when it already does). */
  waitFor(key: string, cost: number, now: number): number {
    const short = cost - this.available(key, now);
    return short <= 0 ? 0 : Math.ceil(short / this.config.refillPerSecond);
  }

  /** Spends `cost` tokens; callers check `available` first. */
  spend(key: string, cost: number, now: number): void {
    this.buckets.set(key, { tokens: this.available(key, now) - cost, at: now });
    if (this.buckets.size > MAX_KEYS) this.prune(now);
  }

  private prune(now: number): void {
    for (const [key] of this.buckets) if (this.available(key, now) >= this.config.capacity) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}

export interface Limiter {
  ip: TokenBuckets;
  user: TokenBuckets;
}

export function createLimiter(limits: { ip: BucketConfig; user: BucketConfig } = ESTIMATE_LIMITS): Limiter {
  return { ip: new TokenBuckets(limits.ip), user: new TokenBuckets(limits.user) };
}

/**
 * Takes `cost` tokens from the caller's IP bucket and, when signed in, their user bucket; both must hold enough, and
 * nothing is spent when either doesn't. `retryAfter` is in seconds.
 */
export function take(limiter: Limiter, who: { ip: string; userId: string | null }, cost: number, now: number = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const ipWait = limiter.ip.waitFor(who.ip, cost, now);
  const userWait = who.userId ? limiter.user.waitFor(who.userId, cost, now) : 0;
  if (ipWait > 0 || userWait > 0) return { ok: false, retryAfter: Math.max(ipWait, userWait, 1) };
  limiter.ip.spend(who.ip, cost, now);
  if (who.userId) limiter.user.spend(who.userId, cost, now);
  return { ok: true };
}

/** The caller's IP from the proxy headers (Vercel sets x-forwarded-for), else "unknown". */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
