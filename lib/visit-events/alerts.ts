/**
 * Who gets a visit alert tonight, and what it says (specs/product/visit-events.md, "The nightly job" → "Alerting").
 * Pure: app/api/cron/visit-alerts/route.ts reads the rows with the secret key and passes them in; tests call it
 * directly under plain `node --test`. lib/emails/visit-alert.ts renders a plan; the route sends it and records
 * `visit_alerts`.
 *
 * Rules:
 * - Candidate events: `first_seen >= since` (new), or `changed_at >= since` with `changed_at > first_seen` (moved:
 *   the row doesn't say which field changed, so a later change is labeled "moved to"). Never staff, removed, or past,
 *   and never the backlog of a host first read inside the window (its whole calendar is "new" that night).
 * - A user is considered when they follow a college with a candidate event. They get a plan only when
 *   `email_visit_alerts` is on, they have a measuring point, neither their prefs row nor (when the point is the home)
 *   their home was written in the last 24 hours (the first night after turning alerts on or setting a home sends
 *   nothing about the backlog), and at least one candidate at a followed, unmuted college passes `alertable()`.
 * - A guardian with no home and two students' high schools has two points: an event counts when it is within the
 *   radius of either (the union), and its distance is the nearer one.
 * - Per college, events nearest first, at most VISIT_ALERT_PER_COLLEGE (`more` counts the rest); `farther` counts
 *   candidates outside the radius. Colleges are ordered by their nearest event.
 */
import { alertable, eventDistance, type MeasuringPoint } from "./measure.ts";
import { DEFAULT_VISIT_ALERT_PREFS, isShownKind, type VisitAlertPrefs, type VisitEventRow } from "./types.ts";

/** At most this many events per college in one email; the visits page has the rest. */
export const VISIT_ALERT_PER_COLLEGE = 10;
/** How long a new prefs row or a new home keeps a person out of the alert (the first-night rule). */
export const FIRST_NIGHT_HOURS = 24;

export type AlertChange = "new" | "moved";

export interface AlertEvent {
  event: VisitEventRow;
  /** Miles from the nearest of the person's points; null for an online event. */
  miles: number | null;
  change: AlertChange;
}

export interface AlertCollege {
  unitId: string;
  /** Nearest first, at most VISIT_ALERT_PER_COLLEGE. */
  events: AlertEvent[];
  /** Alertable events beyond the cap ("and N more on your visits page"). */
  more: number;
  /** Candidate events at this college outside the radius ("UF also added N events farther away"). */
  farther: number;
}

export interface AlertPlan {
  userId: string;
  colleges: AlertCollege[];
  unsubscribeToken: string;
  radiusMiles: number;
  /** What the radius is measured from ("home in Marietta, GA", "Marietta High School"), one per distinct point. */
  pointLabels: string[];
  /** Every alertable event id, including ones past the cap (the visit_alerts row). */
  eventIds: string[];
  eventCount: number;
}

export interface AlertSkips {
  /** `email_visit_alerts` is off, or there is no unsubscribe token to put in the email. */
  unsubscribed: number;
  noPoint: number;
  firstNight: number;
  /** Nothing new at a followed, unmuted college within the radius. */
  nothingNear: number;
}

export interface SelectAlertsInput {
  now: Date;
  /** Start of the window (the route passes now − 24 h). */
  since: Date;
  events: readonly VisitEventRow[];
  /** follows rows: the colleges each user gets alerts for. */
  follows: readonly { user_id: string; unit_id: string }[];
  mutes: readonly { user_id: string; unit_id: string }[];
  /** visit_alert_prefs rows (a user without one behaves as the defaults, with no first-night hold for the row). */
  prefs: readonly (Pick<VisitAlertPrefs, "user_id" | "email_visit_alerts" | "radius_miles" | "include_online"> & { updated?: string | null })[];
  /** Each user's measuring points (the route resolves home / high schools through measuringPoint()). */
  points: ReadonlyMap<string, readonly MeasuringPoint[]>;
  /** The newest household_homes.updated_at among the user's households, when a home is set. */
  homesSetAt: ReadonlyMap<string, string>;
  /** Overrides prefs[].updated as the prefs row's age, when the caller has a better timestamp. */
  prefsCreatedAt?: ReadonlyMap<string, string>;
  /** notification_prefs.unsubscribe_token per user. */
  unsubscribeTokens: ReadonlyMap<string, string>;
  /** slate_hosts.first_seen per unit: events of a host first read inside the window are its backlog, not news. */
  hostsFirstSeen?: ReadonlyMap<string, string>;
}

export interface SelectAlertsResult {
  plans: AlertPlan[];
  /** Users who follow a college with a candidate event. */
  candidates: number;
  skipped: AlertSkips;
}

/**
 * "new" or "moved" for an event in the window, or null when it isn't a candidate. `moved_at` is set by the sync only
 * for a date or venue change (20261013190000), so an availability flip never reads as "moved to".
 */
export function changeOf(event: Pick<VisitEventRow, "first_seen" | "moved_at">, since: Date): AlertChange | null {
  if (Date.parse(event.first_seen) >= since.getTime()) return "new";
  if (event.moved_at && Date.parse(event.moved_at) >= since.getTime()) return "moved";
  return null;
}

function isCandidate(event: VisitEventRow, input: Pick<SelectAlertsInput, "now" | "since" | "hostsFirstSeen">): AlertChange | null {
  if (!isShownKind(event.kind) || event.removed_at) return null;
  if (Date.parse(event.starts_at) < input.now.getTime()) return null;
  const hostSeen = input.hostsFirstSeen?.get(event.unit_id);
  if (hostSeen && Date.parse(hostSeen) >= input.since.getTime()) return null;
  return changeOf(event, input.since);
}

function within(iso: string | null | undefined, now: Date, hours: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now.getTime() - t < hours * 3_600_000;
}

function nearestMiles(event: VisitEventRow, points: readonly MeasuringPoint[]): number | null {
  let best: number | null = null;
  for (const p of points) {
    const d = eventDistance(event, p);
    if (d != null && (best == null || d < best)) best = d;
  }
  return best;
}

function byNearest(a: AlertEvent, b: AlertEvent): number {
  if (a.miles != null && b.miles != null && a.miles !== b.miles) return a.miles - b.miles;
  if (a.miles == null && b.miles != null) return 1;
  if (a.miles != null && b.miles == null) return -1;
  return a.event.starts_at.localeCompare(b.event.starts_at) || a.event.id.localeCompare(b.event.id);
}

export function selectAlerts(input: SelectAlertsInput): SelectAlertsResult {
  const candidatesByUnit = new Map<string, { event: VisitEventRow; change: AlertChange }[]>();
  for (const event of input.events) {
    const change = isCandidate(event, input);
    if (!change) continue;
    candidatesByUnit.set(event.unit_id, [...(candidatesByUnit.get(event.unit_id) ?? []), { event, change }]);
  }

  const followsByUser = new Map<string, Set<string>>();
  for (const f of input.follows) {
    if (!candidatesByUnit.has(f.unit_id)) continue;
    if (!followsByUser.has(f.user_id)) followsByUser.set(f.user_id, new Set());
    followsByUser.get(f.user_id)!.add(f.unit_id);
  }
  const muted = new Set(input.mutes.map((m) => `${m.user_id}:${m.unit_id}`));
  const prefsByUser = new Map(input.prefs.map((p) => [p.user_id, p]));

  const skipped: AlertSkips = { unsubscribed: 0, noPoint: 0, firstNight: 0, nothingNear: 0 };
  const plans: AlertPlan[] = [];

  for (const [userId, units] of [...followsByUser].sort(([a], [b]) => a.localeCompare(b))) {
    const row = prefsByUser.get(userId);
    const prefs = row ?? { ...DEFAULT_VISIT_ALERT_PREFS, user_id: userId, updated: null };
    const token = input.unsubscribeTokens.get(userId);
    if (!prefs.email_visit_alerts || !token) {
      skipped.unsubscribed++;
      continue;
    }
    const points = input.points.get(userId) ?? [];
    if (!points.length) {
      skipped.noPoint++;
      continue;
    }
    const prefsAge = input.prefsCreatedAt?.get(userId) ?? row?.updated ?? null;
    const usesHome = points.some((p) => p.source === "home");
    if (within(prefsAge, input.now, FIRST_NIGHT_HOURS) || (usesHome && within(input.homesSetAt.get(userId), input.now, FIRST_NIGHT_HOURS))) {
      skipped.firstNight++;
      continue;
    }

    const colleges: AlertCollege[] = [];
    const eventIds: string[] = [];
    for (const unitId of units) {
      if (muted.has(`${userId}:${unitId}`)) continue;
      const near: AlertEvent[] = [];
      let farther = 0;
      for (const { event, change } of candidatesByUnit.get(unitId) ?? []) {
        if (points.some((p) => alertable(event, prefs, p))) {
          near.push({ event, miles: nearestMiles(event, points), change });
        } else if (!event.online && event.kind !== "online" && nearestMiles(event, points) != null) {
          farther++;
        }
      }
      if (!near.length) continue;
      near.sort(byNearest);
      eventIds.push(...near.map((e) => e.event.id));
      colleges.push({ unitId, events: near.slice(0, VISIT_ALERT_PER_COLLEGE), more: Math.max(0, near.length - VISIT_ALERT_PER_COLLEGE), farther });
    }
    if (!colleges.length) {
      skipped.nothingNear++;
      continue;
    }
    colleges.sort((a, b) => byNearest(a.events[0], b.events[0]) || a.unitId.localeCompare(b.unitId));
    plans.push({
      userId,
      colleges,
      unsubscribeToken: token,
      radiusMiles: prefs.radius_miles,
      pointLabels: [...new Set(points.map((p) => p.label))],
      eventIds,
      eventCount: eventIds.length,
    });
  }

  return { plans, candidates: followsByUser.size, skipped };
}
