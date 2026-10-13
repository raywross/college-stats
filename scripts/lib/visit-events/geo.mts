/**
 * Where an event is (specs/product/visit-events.md, "Model"): the event page's ZIP through the checked-in ZCTA table
 * (data/reference/zcta-centroids.csv, built by `npm run build-zcta`, parsed by lib/home.ts `parseCentroidCsv`, the
 * same table Explore's distance filter and lib/zip-centroids.ts read; that module is server-only, so scripts load the
 * file through the shared parser here). No third-party call per event. A place with no ZIP (or a ZIP with no ZCTA)
 * falls back to the centre of the event page's own map, which Slate geocodes from the venue; else null (shown, never
 * alerted). Online events have no place.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCentroidCsv, roundCoord, type LatLng } from "../../../lib/home.ts";

export type ZipTable = ReadonlyMap<string, LatLng>;

/** The ZCTA table from `root`/data/reference/zcta-centroids.csv (empty when the file is missing). */
export function loadZipTable(root: string): ZipTable {
  const path = join(root, "data", "reference", "zcta-centroids.csv");
  return existsSync(path) ? parseCentroidCsv(readFileSync(path, "utf8")) : new Map();
}

export interface Located {
  lat: number | null;
  lng: number | null;
  /** Which source placed it: the ZIP's ZCTA centre, the event page's map, or nothing. */
  by: "zip" | "map" | null;
}

/** An event's point: its ZIP's centre, else the page map's centre, else none. Online events are never placed. */
export function locate(table: ZipTable, place: { zip: string | null; online: boolean; mapLat?: number | null; mapLng?: number | null }): Located {
  if (place.online) return { lat: null, lng: null, by: null };
  const z = place.zip ? table.get(place.zip) : undefined;
  if (z) return { lat: z.lat, lng: z.lng, by: "zip" };
  if (place.mapLat != null && place.mapLng != null) return { lat: roundCoord(place.mapLat), lng: roundCoord(place.mapLng), by: "map" };
  return { lat: null, lng: null, by: null };
}
