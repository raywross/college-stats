/**
 * Pi Kappa Phi "Chapters" (specs/greek-life.md phase 4; NIC member). The page's map is a "WP Google Maps Pro"
 * widget: its markers are a base64-encoded JSON blob assigned to `window.wpgmp.mapdata1` right in the page's HTML
 * (see `_wpgmp.mts`). robots.txt allows the page (checked 2026-10-04; the WordPress site itself, distinct from the
 * org's https://pikapp.org domain for "Pi Kappa Phi" — not to be confused with Pi Kappa Alpha, "Pike"). Each
 * marker's title is "<Chapter> (<College>)"; its `categories[0].name` is "Active" or "Inactive" — only Active
 * markers become entries, matching "active chapters only."
 */
import { defineAdapter, type RawEntry } from "../contract.mts";
import { decodeEntities } from "./_html.mts";
import { wpgmpPlaces } from "./_wpgmp.mts";

const LIST_URL = "https://www.pikapp.org/about/chapters/";

/** "Alpha (College of Charleston)" → { chapter: "Alpha", campus: "College of Charleston" }; null if there's no "(...)". */
export function splitTitle(title: string): { chapter: string; campus: string } | null {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(title.trim());
  return m ? { chapter: decodeEntities(m[1].trim()), campus: decodeEntities(m[2].trim()) } : null;
}

export function entriesFrom(places: readonly { title?: string; location?: { city?: string; state?: string }; categories?: { name?: string }[] }[]): RawEntry[] {
  return places.flatMap((p) => {
    if (!p.title) return [];
    const status = p.categories?.[0]?.name;
    if (status && status.toLowerCase() !== "active") return [];
    const split = splitTitle(p.title);
    if (!split) return [];
    const entry: RawEntry = { campus: split.campus, name: `${split.chapter} (Pi Kappa Phi)` };
    if (p.location?.city) entry.city = p.location.city;
    if (p.location?.state) entry.state = p.location.state;
    return [entry];
  });
}

export default defineAdapter({
  key: "pi-kappa-phi",
  organization: "Pi Kappa Phi",
  publisher: "Pi Kappa Phi",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "nic",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const places = wpgmpPlaces(html);
    if (!places.length) throw new Error("pi-kappa-phi: no wpgmp map data found on the chapters page (layout may have changed)");
    const entries = entriesFrom(places);
    ctx.log(`${places.length} map markers, ${entries.length} active chapters`);
    return entries;
  },
});
