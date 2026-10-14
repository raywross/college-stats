/**
 * Where a person's visit-alert radius is measured from, and which events fall inside it (specs/product/visit-events.md,
 * "People's data"). The point is the household home when one is set, else the student's high school, else nothing (no
 * alerts; pages only); `measure_from` overrides `auto` either way. Pure: the pages and the alert job pass in the rows.
 */
import { milesBetween, type LatLng } from "../home.ts";
import { isShownKind, type MeasureFrom, type VisitAlertPrefs, type VisitEventRow } from "./types.ts";

export interface HomePoint extends LatLng {
  /** "Marietta, GA" (household_homes.place). */
  place: string;
}

export interface HighSchoolPoint extends LatLng {
  name: string;
  city: string | null;
  state: string | null;
}

export interface MeasuringPoint extends LatLng {
  source: "home" | "high_school";
  /** What the settings and the email name: "home in Marietta, GA" or "Marietta High School". */
  label: string;
}

/** The point a radius is measured from, or null when neither a home nor a located high school exists. */
export function measuringPoint(
  measureFrom: MeasureFrom,
  home: HomePoint | null,
  highSchool: HighSchoolPoint | null,
): MeasuringPoint | null {
  const fromHome = home ? { lat: home.lat, lng: home.lng, source: "home" as const, label: `home in ${home.place}` } : null;
  const fromSchool =
    highSchool && Number.isFinite(highSchool.lat) && Number.isFinite(highSchool.lng)
      ? { lat: highSchool.lat, lng: highSchool.lng, source: "high_school" as const, label: highSchool.name }
      : null;
  if (measureFrom === "home") return fromHome;
  if (measureFrom === "high_school") return fromSchool;
  return fromHome ?? fromSchool;
}

/** Straight-line miles from the point to the event, or null for an event with no place (online, or no ZIP matched). */
export function eventDistance(event: Pick<VisitEventRow, "lat" | "lng">, point: LatLng): number | null {
  if (event.lat == null || event.lng == null) return null;
  return milesBetween(point, { lat: event.lat, lng: event.lng });
}

/**
 * Whether an event belongs in a person's alert: within the radius of the point, or online when they asked for online
 * sessions. Never staff, never a removed row. The caller has already limited the events to followed, unmuted colleges.
 */
export function alertable(event: VisitEventRow, prefs: Pick<VisitAlertPrefs, "radius_miles" | "include_online">, point: LatLng | null): boolean {
  if (!isShownKind(event.kind) || event.removed_at) return false;
  if (event.online || event.kind === "online") return prefs.include_online;
  if (!point) return false;
  const miles = eventDistance(event, point);
  return miles != null && miles <= prefs.radius_miles;
}

/** Events sorted nearest first (unplaced ones last), then by start. */
export function nearestFirst<T extends Pick<VisitEventRow, "lat" | "lng" | "starts_at">>(events: readonly T[], point: LatLng | null): T[] {
  return [...events].sort((a, b) => {
    const da = point ? eventDistance(a, point) : null;
    const db = point ? eventDistance(b, point) : null;
    if (da != null && db != null && Math.round(da) !== Math.round(db)) return da - db;
    if (da == null && db != null) return 1;
    if (da != null && db == null) return -1;
    return a.starts_at.localeCompare(b.starts_at);
  });
}
