import "server-only";
/**
 * ZIP code centers (specs/product/home-and-distance.md): data/reference/zcta-centroids.csv, built by
 * `npm run build-zcta` from the Census Bureau's Gazetteer file, read once per server instance. Explore's
 * "Distance from home" filter measures from a ZIP's center (so a shared link carries a ZIP code, never an
 * address), and a home address that can't be matched falls back to its ZIP's center (lib/geocode.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_WITHIN, parseCentroidCsv, type LatLng } from "./home";
import type { SearchFilters } from "./types";

let table: Map<string, LatLng> | null = null;

function load(): Map<string, LatLng> {
  if (table) return table;
  const path = join(process.cwd(), "data", "reference", "zcta-centroids.csv");
  table = existsSync(path) ? parseCentroidCsv(readFileSync(path, "utf8")) : new Map();
  return table;
}

/** The center of a five-digit ZIP code (its ZCTA), or null when the table doesn't have it. */
export function zipCentroid(zip: string): LatLng | null {
  return load().get(zip) ?? null;
}

/**
 * Fills `filters.near` from `nearZip`/`withinMiles` (lib/params.ts) so lib/dataset.ts's getSchools() can filter
 * and sort by distance. An unknown ZIP leaves `near` unset: nothing is filtered, and the page says so.
 */
export function resolveNear(filters: SearchFilters): SearchFilters {
  if (!filters.nearZip) return filters;
  const center = zipCentroid(filters.nearZip);
  if (!center) return filters;
  return { ...filters, near: { zip: filters.nearZip, lat: center.lat, lng: center.lng, miles: filters.withinMiles ?? DEFAULT_WITHIN } };
}
