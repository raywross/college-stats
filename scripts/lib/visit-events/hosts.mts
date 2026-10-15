/**
 * Host bookkeeping (specs/product/visit-events.md, "Keeping it running", point 4; migration
 * 20261015100000_visit_events_upkeep.sql). Pure functions over a `slate_hosts` row, so the rules are tested without a
 * database:
 *   - every try sets `last_attempt`; an answered search sets `last_read`, `search_total`, and `zero_since` (set when
 *     the read comes back with no rows and it was null, cleared when rows come back);
 *   - `unreachable` after FAILURES_TO_UNREACHABLE failed nights, retried when `last_attempt` is 7+ days old;
 *   - `no_events` when `zero_since` is 30+ days old, retried when `last_attempt` is 30+ days old;
 *   - `off` is never read.
 * `syncHost` (sync.mts) takes its two `updateHost` patches from `afterRead` and `afterFailure`; the CLI picks the
 * night's hosts with `dueHosts` and the discovery targets with `discoveryTargets`.
 */
import type { SlateHostRow } from "../../../lib/visit-events/types.ts";

const DAY = 86_400_000;

/** Failed nights before a host is `unreachable` (sync.mts re-exports the same number). */
export const FAILURES_TO_UNREACHABLE = 3;
/** An unreachable host is tried again this many days after its last attempt. */
export const UNREACHABLE_RETRY_DAYS = 7;
/** A host whose reads have had no rows this many days is `no_events`. */
export const NO_EVENTS_AFTER_DAYS = 30;
/** A `no_events` host is tried again this many days after its last attempt. */
export const NO_EVENTS_RETRY_DAYS = 30;
/** `--discover --all` skips a college on record that was tried this recently. */
export const DISCOVERY_RETRY_DAYS = 7;

type HostState = Pick<SlateHostRow, "status" | "failures" | "last_attempt" | "zero_since">;

const daysSince = (iso: string | null | undefined, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / DAY : Infinity);

/**
 * The patch after a read whose search answered: `rows` is how many events the read built (search plus widgets, so a
 * host with only online widget events is not `no_events`), `searchTotal` the search's own "returned N".
 */
export function afterRead(host: Pick<HostState, "status" | "zero_since">, read: { rows: number; searchTotal: number | null }, now: Date): Partial<SlateHostRow> {
  const at = now.toISOString();
  const zeroSince = read.rows > 0 ? null : (host.zero_since ?? at);
  const empty = zeroSince !== null && daysSince(zeroSince, now) >= NO_EVENTS_AFTER_DAYS;
  return {
    last_attempt: at,
    last_read: at,
    failures: 0,
    last_error: null,
    search_total: read.searchTotal,
    zero_since: zeroSince,
    status: host.status === "off" ? "off" : empty ? "no_events" : "active",
  };
}

/** The patch after a failed (or collapsed) try: failures + 1, `unreachable` at FAILURES_TO_UNREACHABLE, else unchanged. */
export function afterFailure(host: Pick<HostState, "status" | "failures">, error: string, now: Date): Partial<SlateHostRow> {
  const failures = (host.failures ?? 0) + 1;
  return {
    last_attempt: now.toISOString(),
    failures,
    last_error: error.slice(0, 500),
    status: host.status !== "off" && failures >= FAILURES_TO_UNREACHABLE ? "unreachable" : host.status,
  };
}

/**
 * Whether a host is read tonight: active always; unreachable when its last attempt is 7+ days old (or
 * `retryUnreachable`, the CLI's manual retry); no_events when its last attempt is 30+ days old; off never. A host
 * with no `last_attempt` (before the bookkeeping existed) is due.
 */
export function isDue(host: Pick<HostState, "status" | "last_attempt">, now: Date, opts: { retryUnreachable?: boolean } = {}): boolean {
  switch (host.status) {
    case "active":
      return true;
    case "unreachable":
      return !!opts.retryUnreachable || daysSince(host.last_attempt, now) >= UNREACHABLE_RETRY_DAYS;
    case "no_events":
      return daysSince(host.last_attempt, now) >= NO_EVENTS_RETRY_DAYS;
    default:
      return false;
  }
}

/** The hosts due tonight, in the order given. */
export function dueHosts<T extends Pick<HostState, "status" | "last_attempt">>(hosts: readonly T[], now: Date, opts: { retryUnreachable?: boolean } = {}): T[] {
  return hosts.filter((h) => isDue(h, now, opts));
}

/**
 * The colleges a discovery run tries. Named units (`--units`) are always tried again, except `off`. Otherwise every
 * college with a visit or apply link that has no `slate_hosts` row, plus (safe weekly) none tried in the last
 * DISCOVERY_RETRY_DAYS: a row on record is skipped unless its host is `unreachable` and its last attempt is that old,
 * when the college may have moved to a new Slate host. Colleges with no row leave no trace (no table records a
 * fruitless try), so the weekly cadence for them is the workflow's (Sundays).
 */
export function discoveryTargets(
  colleges: readonly { unit_id: string; links?: { visit?: string | null; apply?: string | null } | null }[],
  known: ReadonlyMap<string, Pick<HostState, "status" | "last_attempt">>,
  opts: { units?: readonly string[]; now: Date },
): string[] {
  if (opts.units?.length) return opts.units.filter((u) => known.get(u)?.status !== "off");
  return colleges
    .filter((s) => s.links?.visit || s.links?.apply)
    .map((s) => s.unit_id)
    .filter((u) => {
      const row = known.get(u);
      if (!row) return true;
      return row.status === "unreachable" && daysSince(row.last_attempt, opts.now) >= DISCOVERY_RETRY_DAYS;
    });
}
