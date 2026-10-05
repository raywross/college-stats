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
import { normalizeAddressInput, parseGoogleAutocomplete, shouldSuggest, type SuggestResult } from "./address-suggest";
import { zipCentroid } from "./zip-centroids";

export const CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
export const GOOGLE_AUTOCOMPLETE = "https://places.googleapis.com/v1/places:autocomplete";

/**
 * Suggestions as you type, from Google's Place Autocomplete (New), U.S. addresses only, with the site's key
 * (GOOGLE_MAPS_API_KEY; never sent to the browser). Without a key, or when Google doesn't answer in time, the
 * field just works as a plain field: `{ suggestions: [], provider: null }`. The session token groups one field
 * session's keystrokes for Google's billing (lib/address-suggest.ts isSessionToken).
 */
export async function suggestAddresses(
  input: string,
  sessionToken: string,
  { fetchImpl = fetch, timeoutMs = 5000, apiKey = process.env.GOOGLE_MAPS_API_KEY }: { fetchImpl?: typeof fetch; timeoutMs?: number; apiKey?: string | undefined } = {},
): Promise<SuggestResult> {
  const text = input.trim().replace(/\s+/g, " ");
  if (!apiKey || !shouldSuggest(text)) return { suggestions: [], provider: null };
  try {
    const res = await fetchImpl(GOOGLE_AUTOCOMPLETE, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey },
      body: JSON.stringify({ input: text, sessionToken, includedRegionCodes: ["us"], languageCode: "en-US" }),
    });
    if (!res.ok) {
      console.error(`address suggestions: Google answered ${res.status}`);
      return { suggestions: [], provider: null };
    }
    return { suggestions: parseGoogleAutocomplete(await res.json()), provider: "google" };
  } catch (err) {
    console.error(`address suggestions failed: ${err instanceof Error ? err.message : String(err)}`);
    return { suggestions: [], provider: null };
  }
}

export type GeocodeResult = { ok: true; home: HomeLocation; via: "address" | "zip" } | { ok: false; reason: "no-match" | "unavailable" };

export async function geocodeAddress(
  input: string,
  { fetchImpl = fetch, timeoutMs = 8000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GeocodeResult> {
  // A picked suggestion ends in ", USA"; the Census geocoder copes, but the ZIP fallback reads better without it.
  const text = normalizeAddressInput(input);
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
