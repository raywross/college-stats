import "server-only";
/**
 * Turns a typed home address into coordinates (specs/product/home-and-distance.md "Research"), with the U.S.
 * Census Bureau's public geocoder: no key, no account, U.S. addresses only, and a federal service rather than a
 * commercial one for a family's home. The request carries only the address text; what the app keeps is the match
 * (lib/home.ts parseCensusGeocode), rounded to about 100 m.
 *
 * A bare ZIP code skips the geocoder and uses the ZIP's center from the checked-in table (lib/zip-centroids.ts);
 * an address the geocoder can't match falls back to the same when it contains a ZIP.
 */
import { parseCensusGeocode, parseZip, zipHome, zipIn, type HomeLocation } from "./home";
import { zipCentroid } from "./zip-centroids";

export const CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export type GeocodeResult = { ok: true; home: HomeLocation; via: "address" | "zip" } | { ok: false; reason: "no-match" | "unavailable" };

export async function geocodeAddress(
  input: string,
  { fetchImpl = fetch, timeoutMs = 8000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GeocodeResult> {
  const text = input.trim().replace(/\s+/g, " ");
  const bareZip = parseZip(text);
  if (bareZip) return fromZip(bareZip);

  let json: unknown = null;
  let unavailable = false;
  try {
    const url = `${CENSUS_GEOCODER}?${new URLSearchParams({ address: text, benchmark: "Public_AR_Current", format: "json" })}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (res.ok) json = await res.json();
    else unavailable = true;
  } catch {
    unavailable = true;
  }
  const home = json ? parseCensusGeocode(json) : null;
  if (home) return { ok: true, home, via: "address" };

  const zip = zipIn(text);
  if (zip) {
    const fallback = fromZip(zip);
    if (fallback.ok) return fallback;
  }
  return { ok: false, reason: unavailable ? "unavailable" : "no-match" };
}

function fromZip(zip: string): GeocodeResult {
  const center = zipCentroid(zip);
  return center ? { ok: true, home: zipHome(zip, center), via: "zip" } : { ok: false, reason: "no-match" };
}
