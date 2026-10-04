/**
 * Shared helper for chapter-locator pages built on the "WP Google Maps Pro" plugin (`wpgmp`; specs/greek-life.md
 * phase 4): the map's markers are a JSON object, base64-encoded, assigned to `window.wpgmp.mapdataN` right in the
 * page's HTML — no separate request needed. Used by pi-kappa-phi.mts; prefixed with `_` so the adapter registry
 * skips this file.
 */

export interface WpgmpPlace {
  id?: string;
  title?: string;
  location?: { city?: string; state?: string };
  categories?: { name?: string }[];
}

/** The decoded `places` array from the first `window.wpgmp.mapdataN = "<base64>"` assignment found, or []. */
export function wpgmpPlaces(html: string): WpgmpPlace[] {
  const m = /wpgmp\.mapdata\d*\s*=\s*"([^"]+)"/.exec(html);
  if (!m) return [];
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], "base64").toString("utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(decoded) as { places?: WpgmpPlace[] };
    return Array.isArray(parsed.places) ? parsed.places : [];
  } catch {
    return [];
  }
}
