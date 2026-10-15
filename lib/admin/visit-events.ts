import "server-only";
/**
 * The admin console's Visit events card (specs/product/visit-events.md "Keeping it running (round 2, 2026-10-15)";
 * specs/product/admin.md "Health"): the last 7 nights of `visit_event_sync`, `slate_hosts` by status, and the newest
 * run's data-check summary. These tables are world-readable to any signed-in person (supabase/migrations/
 * 20261013180000_visit_events.sql), so there is no "Admins read" policy to clear here, but the read still goes
 * through adminSupabase() like every other console read (the same client, the same header, one way to read) and is
 * gated by requireAdmin() first.
 *
 * The shaping is split from the network call (shapeVisitEventsHealth) so it is tested as a pure function: Supabase
 * rows, nulls and all (the 2026-10-14 population runs predate the new columns), in; the card's shape out. cardTone()
 * is the shared colour rule (the brief's "Shared contracts"): red when the newest run failed (errors and no hosts
 * read), withheld misses, had a failing data check, or is older than 36 hours; amber for a data-check warning; green
 * otherwise.
 */
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";

export type SlateHostStatus = "active" | "unreachable" | "no_events" | "off";

/** One host in `check_summary.listed` (scripts/lib/visit-events/check.mts `CheckSummaryHost`): only hosts with a
 * failure or a warning are listed, failing first, at most `check.mts` SUMMARY_MAX_HOSTS (50). Parsed defensively here
 * (a malformed or hand-written row becomes empty strings/arrays rather than throwing) since this crosses the
 * database boundary, not a direct import of the check script's types. */
export interface CheckSummaryHost {
  host: string;
  unit_id: string;
  events: number;
  failures: string[];
  warnings: string[];
}

/** `visit_event_sync.check_summary` (scripts/lib/visit-events/check.mts `CheckSummary`, written by `check:visit-events
 * --record`). */
export interface CheckSummary {
  checkedAt: string;
  hosts: number;
  events: number;
  failing: number;
  warned: number;
  listed: CheckSummaryHost[];
  /** Flagged hosts past `listed`'s 50. */
  omitted: number;
}

export interface VisitRunRow {
  id: number;
  ranAt: string;
  finishedAt: string | null;
  hostsRead: number;
  hostsFailed: number;
  hostsCollapsed: number;
  eventsNew: number;
  eventsChanged: number;
  eventsRemoved: number;
  pagesFetched: number;
  errors: unknown[];
  missesWithheld: boolean;
  checkFailures: number | null;
  checkWarnings: number | null;
  checkSummary: CheckSummary | null;
}

export interface VisitEventsHealth {
  /** The last 7 runs, newest first. */
  runs: VisitRunRow[];
  /** `runs[0]`, or null when there has never been a run. */
  newest: VisitRunRow | null;
  hostsByStatus: Record<SlateHostStatus, number>;
}

/** A `visit_event_sync` row exactly as Supabase returns it: snake_case, and the upkeep columns nullable on rows from
 * before 2026-10-15 (default 0/false on the integer/boolean columns per the migration, but still typed optional here
 * since a hand-written fixture or a future column drop should not crash the shaping). */
export interface RawSyncRow {
  id: number;
  ran_at: string;
  finished_at: string | null;
  hosts_read: number | null;
  hosts_failed: number | null;
  hosts_collapsed: number | null;
  events_new: number | null;
  events_changed: number | null;
  events_removed: number | null;
  pages_fetched: number | null;
  errors: unknown;
  misses_withheld: boolean | null;
  check_failures: number | null;
  check_warnings: number | null;
  check_summary: unknown;
}

export interface RawHostStatusRow {
  status: string | null;
}

const HOST_STATUSES: readonly SlateHostStatus[] = ["active", "unreachable", "no_events", "off"];
/** A second cap on `listed`, in case a hand-written fixture or a future check version sends more than check.mts's own
 * SUMMARY_MAX_HOSTS (50); kept as a plain constant rather than imported so this module doesn't reach into the script. */
const CHECK_SUMMARY_MAX_HOSTS = 50;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strArray = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function shapeCheckSummaryHost(row: unknown): CheckSummaryHost {
  if (!row || typeof row !== "object") return { host: "", unit_id: "", events: 0, failures: [], warnings: [] };
  const r = row as Record<string, unknown>;
  return { host: str(r.host), unit_id: str(r.unit_id), events: num(r.events), failures: strArray(r.failures), warnings: strArray(r.warnings) };
}

function shapeCheckSummary(raw: unknown): CheckSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const listed = (Array.isArray(r.listed) ? r.listed : []).slice(0, CHECK_SUMMARY_MAX_HOSTS).map(shapeCheckSummaryHost);
  return {
    checkedAt: str(r.checked_at),
    hosts: num(r.hosts),
    events: num(r.events),
    failing: num(r.failing),
    warned: num(r.warned),
    listed,
    omitted: num(r.omitted),
  };
}

function shapeRun(r: RawSyncRow): VisitRunRow {
  return {
    id: r.id,
    ranAt: r.ran_at,
    finishedAt: r.finished_at ?? null,
    hostsRead: r.hosts_read ?? 0,
    hostsFailed: r.hosts_failed ?? 0,
    hostsCollapsed: r.hosts_collapsed ?? 0,
    eventsNew: r.events_new ?? 0,
    eventsChanged: r.events_changed ?? 0,
    eventsRemoved: r.events_removed ?? 0,
    pagesFetched: r.pages_fetched ?? 0,
    errors: Array.isArray(r.errors) ? r.errors : [],
    missesWithheld: r.misses_withheld ?? false,
    checkFailures: r.check_failures ?? null,
    checkWarnings: r.check_warnings ?? null,
    checkSummary: shapeCheckSummary(r.check_summary),
  };
}

/**
 * Pure: raw rows (newest-first order is the caller's, since that's cheaper for the database to do) into the card's
 * shape. A host whose status isn't one of the four known values is left out of the count (none exist today; a future
 * status shouldn't throw).
 */
export function shapeVisitEventsHealth(syncRows: readonly RawSyncRow[], hostStatusRows: readonly RawHostStatusRow[]): VisitEventsHealth {
  const runs = syncRows.map(shapeRun);
  const hostsByStatus: Record<SlateHostStatus, number> = { active: 0, unreachable: 0, no_events: 0, off: 0 };
  for (const h of hostStatusRows) {
    if (h.status && (HOST_STATUSES as readonly string[]).includes(h.status)) hostsByStatus[h.status as SlateHostStatus] += 1;
  }
  return { runs, newest: runs[0] ?? null, hostsByStatus };
}

/** The last 7 runs and the host statuses, admin only. */
export async function loadVisitEventsHealth(): Promise<VisitEventsHealth> {
  await requireAdmin();
  const s = await adminSupabase();
  const [sync, hosts] = await Promise.all([
    s
      .from("visit_event_sync")
      .select(
        "id, ran_at, finished_at, hosts_read, hosts_failed, hosts_collapsed, events_new, events_changed, events_removed, pages_fetched, errors, misses_withheld, check_failures, check_warnings, check_summary",
      )
      .order("ran_at", { ascending: false })
      .limit(7),
    s.from("slate_hosts").select("status"),
  ]);
  if (sync.error) throw new Error(`admin: reading visit_event_sync failed: ${sync.error.message}`);
  if (hosts.error) throw new Error(`admin: reading slate_hosts failed: ${hosts.error.message}`);
  return shapeVisitEventsHealth((sync.data ?? []) as RawSyncRow[], (hosts.data ?? []) as RawHostStatusRow[]);
}

/* ------------------------------------------------------------------ */
/* The card's colour (the brief's shared contract)                     */
/* ------------------------------------------------------------------ */

export type CardTone = "red" | "amber" | "green";

const STALE_HOURS = 36;
const STALE_MS = STALE_HOURS * 60 * 60 * 1000;

/**
 * Red when the newest run failed (it logged errors and read no hosts), withheld misses (the run-level guard tripped),
 * had a failing data check, or is older than 36 hours; amber for a data-check warning with no failure; green
 * otherwise. No run at all (the feature has never synced, or the console can't see one) reads as red: there is
 * nothing to show "it's working" with. Pure of the clock, so a test can hold `now` still.
 */
export function cardTone(run: VisitRunRow | null, now: Date): CardTone {
  if (!run) return "red";
  const failed = run.errors.length > 0 && run.hostsRead === 0;
  const stale = now.getTime() - Date.parse(run.ranAt) > STALE_MS;
  const checkFailing = (run.checkFailures ?? 0) > 0;
  if (failed || run.missesWithheld || checkFailing || stale) return "red";
  if ((run.checkWarnings ?? 0) > 0) return "amber";
  return "green";
}
