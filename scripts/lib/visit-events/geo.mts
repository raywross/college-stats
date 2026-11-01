/**
 * Where an event is (specs/product/visit-events.md, "Model"): the event page's ZIP through the ZCTA table (the
 * reference document `zcta-centroids`, built by `npm run build-zcta`, read from the bundled copy's
 * `reference/zcta-centroids.csv` and parsed by lib/home.ts `parseCentroidCsv`, the same table Explore's distance filter
 * and lib/zip-centroids.ts read; that module is server-only, so scripts load the file through the shared parser here). No third-party call per event. A place with no ZIP (or a ZIP with no ZCTA)
 * falls back to the centre of the event page's own map, which Slate geocodes from the venue; else null (shown, never
 * alerted). Online events have no place.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCentroidCsv, roundCoord, type LatLng } from "../../../lib/home.ts";
import { REFERENCE_OBJECTS } from "../../../lib/data-platform/snapshot.ts";
import { bundledDir } from "../data-platform/bundled.mts";

export type ZipTable = ReadonlyMap<string, LatLng>;

/**
 * The ZCTA table: the CSV at `file` when given (a test's fixture), else the bundled copy's
 * `reference/zcta-centroids.csv` (empty when the file is missing).
 */
export function loadZipTable(file?: string): ZipTable {
  const path = file ?? join(bundledDir(), "reference", REFERENCE_OBJECTS.zctaCentroids);
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
