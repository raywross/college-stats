/**
 * The per-instance refresh of the session check's signing keys (round 5; specs/product/accounts.md "Checking the
 * session without fetching the keys"). Pure: the clock and the download are given, so tests drive it with fakes
 * (tests/auth-jwks.test.mts). lib/auth-jwks.ts holds the instance's one holder; lib/auth-jwks-after.ts schedules the
 * refresh after a response.
 *
 * The holder starts with the set bundled at build time. At most once per `everyMs` (an hour) a caller may `claim()` the
 * refresh, and then runs `refresh()` off the request path: it downloads the live set and replaces the holder's, so a key
 * revoked since the build stops verifying within the hour and a key rotated in since then verifies without the
 * library's own fetch. A failed download keeps the set it had (fail soft) and the next attempt waits out the interval.
 */

export type HeldKeySet = { keys: readonly object[] };

export interface JwksHolder<S extends HeldKeySet> {
  /** The set the session check verifies against now. */
  current(): S;
  /**
   * True at most once per interval (and never while a refresh is running): the caller that gets true runs `refresh()`.
   * Claiming stamps the attempt, so concurrent requests on one instance schedule one download, not one each.
   */
  claim(): boolean;
  /** Downloads the live set and makes it current; false (set unchanged, logged) when the download fails. */
  refresh(): Promise<boolean>;
}

export const JWKS_REFRESH_EVERY_MS = 60 * 60 * 1000;

export function createJwksHolder<S extends HeldKeySet>(opts: { initial: S; load: () => Promise<S>; now?: () => number; everyMs?: number }): JwksHolder<S> {
  const now = opts.now ?? Date.now;
  const every = opts.everyMs ?? JWKS_REFRESH_EVERY_MS;
  let set = opts.initial;
  // A fresh instance's first claim succeeds: the bundle may be days old, and the download runs after that response.
  let last = Number.NEGATIVE_INFINITY;
  let running: Promise<boolean> | null = null;
  return {
    current: () => set,
    claim() {
      const t = now();
      if (running || t - last < every) return false;
      last = t;
      return true;
    },
    refresh() {
      if (running) return running;
      running = (async () => {
        try {
          set = await opts.load();
          return true;
        } catch (err) {
          console.warn(`auth: refreshing the signing keys failed; keeping the ones this instance has: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        } finally {
          running = null;
        }
      })();
      return running;
    },
  };
}
