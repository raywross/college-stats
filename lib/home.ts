/**
 * Home and distance (specs/product/home-and-distance.md): the pure rules behind "how far is it from home".
 * Distance is the great-circle figure between a home and the campus coordinates IPEDS publishes
 * (`location.lat`/`location.lng`), never a route; the drive time is a rough estimate from it. No server or browser
 * APIs here, so tests, server code (lib/dataset.ts's filter and sort), and client components all import it. The
 * geocoder call lives in lib/geocode.ts, the ZIP table in lib/zip-centroids.ts, and the account's row in
 * lib/home-store.ts.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A saved home (public.home_locations) or a geocoder match. */
export interface HomeLocation extends LatLng {
  /** The matched address, tidied: "1600 Pennsylvania Ave NW, Washington, DC 20500". Shown only to its owner. */
  label: string;
  /** "Washington, DC" (or "ZIP 20500" for a ZIP-only home): what distance lines name. */
  place: string;
  /** Five digits when the match had one. Explore's filter measures from the ZIP's center, never the address. */
  zip: string | null;
}

/** Explore's `near` filter once the ZIP is resolved (lib/zip-centroids.ts resolveNear). */
export interface NearHome extends LatLng {
  zip: string;
  /** Straight-line radius in miles. */
  miles: number;
}

/* ------------------------------------------------------------------ */
/* Distance                                                            */
/* ------------------------------------------------------------------ */

export const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles (haversine). */
export function milesBetween(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Miles from `home` to a college's campus, or null when the college has no reported coordinates. */
export function distanceFromHome(location: { lat?: number | null; lng?: number | null }, home: LatLng): number | null {
  if (location.lat == null || location.lng == null) return null;
  return milesBetween(home, { lat: location.lat, lng: location.lng });
}

/** Explore's filter test: within the radius of the ZIP's center. A college without coordinates never matches. */
export function isWithinHome(location: { lat?: number | null; lng?: number | null }, near: NearHome): boolean {
  const miles = distanceFromHome(location, near);
  return miles !== null && miles <= near.miles;
}

/**
 * The drive-time estimate's two assumptions: a road route runs about a quarter longer than the straight line, at
 * 55 mph averaged over highway and town. Stated in the glossary ("distance-from-home"); never claimed as a route.
 */
export const ROAD_FACTOR = 1.25;
export const AVERAGE_MPH = 55;

export function driveHours(miles: number): number {
  return (miles * ROAD_FACTOR) / AVERAGE_MPH;
}

/** "410 mi" */
export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString("en-US")} mi`;
}

/**
 * "about 25 minutes" under an hour (to 5 minutes), "about 7½ hours" to ten hours (to the half hour), then whole
 * hours: a two-day drive is a flight, and the estimate stops pretending to precision.
 */
export function formatDriveTime(miles: number): string {
  const h = driveHours(miles);
  if (h < 1) return `about ${Math.max(5, Math.round((h * 60) / 5) * 5)} minutes`;
  if (h > 10) return `about ${Math.round(h)} hours`;
  const half = Math.round(h * 2) / 2;
  const whole = Math.floor(half);
  const text = half > whole ? `${whole}½` : String(whole);
  return `about ${text} hour${half === 1 ? "" : "s"}`;
}

/** "410 mi · about 7½ hours by car" */
export function distanceLine(miles: number): string {
  return `${formatMiles(miles)} · ${formatDriveTime(miles)} by car`;
}

/* ------------------------------------------------------------------ */
/* Explore's filter                                                    */
/* ------------------------------------------------------------------ */

/** Radii Explore offers (straight-line miles). */
export const WITHIN_OPTIONS = [25, 50, 100, 200, 300, 500] as const;
export type WithinMiles = (typeof WITHIN_OPTIONS)[number];
export const DEFAULT_WITHIN: WithinMiles = 100;

export function isWithinOption(v: unknown): v is WithinMiles {
  return typeof v === "number" && (WITHIN_OPTIONS as readonly number[]).includes(v);
}

/** A five-digit ZIP from "02139" or "02139-4307"; null for anything else. */
export function parseZip(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const m = String(input).trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? m[1] : null;
}

/** The last five-digit group in free text ("12345 Main St, Springfield, IL 62701" → "62701"), or null. */
export function zipIn(text: string): string | null {
  const all = [...text.matchAll(/(?<!\d)(\d{5})(?:-\d{4})?(?!\d)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/** `/explore?near=…&within=…&sortBy=distance`: nearest first, from a ZIP code's center. */
export function exploreNearHref(zip: string, miles: number = DEFAULT_WITHIN): string {
  return `/explore?near=${zip}&within=${miles}&sortBy=distance`;
}

/* ------------------------------------------------------------------ */
/* Geocoder output                                                     */
/* ------------------------------------------------------------------ */

/** Coordinates kept to three decimals (about 100 m): enough for distances, not a rooftop. */
export function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

const KEEP_UPPER = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const SUFFIXES: Record<string, string> = { ST: "St", RD: "Rd", DR: "Dr", LN: "Ln", CT: "Ct", PL: "Pl", HWY: "Hwy", BLVD: "Blvd", AVE: "Ave", PKWY: "Pkwy", TRL: "Trl", CIR: "Cir", TER: "Ter" };

/** "PENNSYLVANIA AVE NW" → "Pennsylvania Ave NW"; "1ST ST" → "1st St". Good enough for a label the owner confirms. */
export function titleCaseAddress(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => {
      const upper = w.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      if (SUFFIXES[upper]) return SUFFIXES[upper];
      const lower = w.toLowerCase();
      return /^[a-z]/.test(lower) ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

interface CensusMatch {
  coordinates?: { x?: unknown; y?: unknown };
  matchedAddress?: unknown;
  addressComponents?: { city?: unknown; state?: unknown; zip?: unknown };
}

/**
 * The Census Bureau geocoder's answer (geocoding.geo.census.gov/geocoder/locations/onelineaddress, benchmark
 * Public_AR_Current, format=json): the first match as a HomeLocation, or null when there is none or the shape is
 * off. Coordinates come back as x = longitude, y = latitude.
 */
export function parseCensusGeocode(json: unknown): HomeLocation | null {
  const matches = (json as { result?: { addressMatches?: unknown } } | null)?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const m = matches[0] as CensusMatch;
  const lat = Number(m.coordinates?.y);
  const lng = Number(m.coordinates?.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const c = m.addressComponents ?? {};
  const city = typeof c.city === "string" ? titleCaseAddress(c.city) : "";
  const state = typeof c.state === "string" ? c.state.toUpperCase() : "";
  const zip = parseZip(c.zip);
  const matched = typeof m.matchedAddress === "string" ? m.matchedAddress : "";
  const street = titleCaseAddress(matched.split(",")[0] ?? "");
  const place = city && state ? `${city}, ${state}` : state || city || (zip ? `ZIP ${zip}` : "your home");
  const label = [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || place;
  return { lat: roundCoord(lat), lng: roundCoord(lng), label: label.slice(0, 200), place: place.slice(0, 80), zip };
}

/** A ZIP-only home: the ZIP code's center. */
export function zipHome(zip: string, center: LatLng): HomeLocation {
  return { lat: roundCoord(center.lat), lng: roundCoord(center.lng), label: `ZIP code ${zip} (its center)`, place: `ZIP ${zip}`, zip };
}

/* ------------------------------------------------------------------ */
/* The ZCTA table (data/reference/zcta-centroids.csv)                  */
/* ------------------------------------------------------------------ */

/** Parses the checked-in CSV (`zcta,lat,lng`; `#` comment lines) into a lookup. Malformed rows are skipped. */
export function parseCentroidCsv(text: string): Map<string, LatLng> {
  const out = new Map<string, LatLng>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("zcta,")) continue;
    const [zcta, lat, lng] = line.trim().split(",");
    const la = Number(lat);
    const ln = Number(lng);
    if (/^\d{5}$/.test(zcta) && Number.isFinite(la) && Number.isFinite(ln)) out.set(zcta, { lat: la, lng: ln });
  }
  return out;
}
