/**
 * Visit events (specs/product/visit-events.md): the shapes every unit shares. The database rows are in
 * supabase/migrations/20261013180000_visit_events.sql; the reader (scripts/lib/visit-events/) writes them, the pages
 * and the alert job read them. No Supabase or Next.js import here, so scripts and tests can load it under plain node.
 */

export type VisitEventKind = "tour" | "info_session" | "open_house" | "travel" | "online" | "staff" | "other";

export const VISIT_EVENT_KINDS: readonly VisitEventKind[] = ["tour", "info_session", "open_house", "travel", "online", "staff", "other"];

/** What each kind is called on the site. `staff` rows are never shown. */
export const VISIT_KIND_LABELS: Record<VisitEventKind, string> = {
  tour: "Campus tour",
  info_session: "Info session",
  open_house: "Open house",
  travel: "Visit near you",
  online: "Online",
  staff: "Staff",
  other: "Event",
};

export type VisitAvailability = "open" | "full" | "closed";

/** One row of public.visit_events, as PostgREST returns it. */
export interface VisitEventRow {
  id: string;
  unit_id: string;
  host: string;
  slate_id: string;
  title: string;
  kind: VisitEventKind;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  all_day: boolean;
  online: boolean;
  venue: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  availability: VisitAvailability | null;
  book_url: string;
  source_url: string;
  description: string | null;
  date_confirmed: boolean;
  first_seen: string;
  last_seen: string;
  changed_at: string;
  /** When the start or the venue last changed (20261013190000); null until a date or place has moved. */
  moved_at: string | null;
  removed_at: string | null;
}

/** The columns a page or the alert job selects; keep in step with the migration (tests/visit-events-model.test.mts). */
export const VISIT_EVENT_COLUMNS =
  "id, unit_id, host, slate_id, title, kind, starts_at, ends_at, timezone, all_day, online, venue, address, city, state, zip, lat, lng, availability, book_url, source_url, description, date_confirmed, first_seen, last_seen, changed_at, moved_at, removed_at";

export const RADIUS_OPTIONS = [10, 25, 30, 50, 100, 250] as const;
export type RadiusMiles = (typeof RADIUS_OPTIONS)[number];
export const DEFAULT_RADIUS: RadiusMiles = 30;
export function isRadiusOption(v: unknown): v is RadiusMiles {
  return typeof v === "number" && (RADIUS_OPTIONS as readonly number[]).includes(v);
}

export type MeasureFrom = "auto" | "home" | "high_school";
export const MEASURE_FROM_OPTIONS: readonly MeasureFrom[] = ["auto", "home", "high_school"];

/** One row of public.visit_alert_prefs; a person without a row behaves as the defaults. */
export interface VisitAlertPrefs {
  user_id: string;
  email_visit_alerts: boolean;
  radius_miles: RadiusMiles;
  measure_from: MeasureFrom;
  include_online: boolean;
}

export const DEFAULT_VISIT_ALERT_PREFS: Omit<VisitAlertPrefs, "user_id"> = {
  email_visit_alerts: true,
  radius_miles: DEFAULT_RADIUS,
  measure_from: "auto",
  include_online: false,
};

export const VISIT_ALERT_PREFS_COLUMNS = "user_id, email_visit_alerts, radius_miles, measure_from, include_online";

/** One row of public.slate_hosts. */
export interface SlateHostRow {
  unit_id: string;
  host: string;
  found_on: string | null;
  portal_parts: { page: string; service: string }[];
  status: "active" | "unreachable" | "no_events" | "off";
  failures: number;
  first_seen: string;
  last_read: string | null;
  last_error: string | null;
}

export const SLATE_HOST_COLUMNS = "unit_id, host, found_on, portal_parts, status, failures, first_seen, last_read, last_error";

/** `visit_events.id`: the host plus Slate's event GUID, so two sources for one event make one row. */
export function visitEventId(host: string, slateId: string): string {
  return `${host}:${slateId.toLowerCase()}`;
}
