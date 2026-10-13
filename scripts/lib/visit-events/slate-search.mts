/**
 * Slate's standard event search (specs/product/visit-events.md, "How Slate publishes"):
 * `GET https://<host>/register/?cmd=search&country=US` lists every public event that has a place as
 * `<li><a href="?id=<guid>">Title</a><br />Wednesday, October 21 at 9:00 AM<br />Gainesville, FL</li>`, grouped under
 * `<p style="font-size: 1.5em…">United States—Florida</p>` headers, after "returned N event(s)". The `&zip=` form of
 * the same page groups the rows under distance bands ("< 25 miles") instead; those headers carry no state and are
 * ignored. Pure: the sync fetches, this parses.
 */
import { decodeEntities } from "../college-reported/documents.mts";

export const STATE_CODES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE",
  Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
  Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR", Guam: "GU",
  "Virgin Islands": "VI",
};

/** Text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
export function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/[\s ]+/g, " ").trim();
}

export interface SearchRow {
  /** Slate's event GUID, lower-cased. */
  slateId: string;
  title: string;
  /** "Wednesday, October 21 at 9:00 AM" as printed (no year). */
  when: string;
  /** "Gainesville, FL" as printed. */
  place: string;
  /** Two-letter state from the section header ("United States—Florida"), else from the place; null when neither says. */
  state: string | null;
  bookUrl: string;
}

export interface StandardSearch {
  /** The page's own "returned N event(s)", or null when it doesn't say (a form page, not a result). */
  total: number | null;
  rows: SearchRow[];
}

const SECTION = /<p style="font-size:\s*1\.5em[^"]*"[^>]*>([\s\S]*?)<\/p>/i;
const ROW = /<li[^>]*>\s*<a href="(?:[^"]*?)\?id=([0-9a-fA-F-]{36})"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/i;

/** The state a section header names: "United States—Florida" → "FL"; a distance band ("< 25 miles") → null. */
function sectionState(header: string): string | null {
  const m = /United States\s*[—–-]\s*(.+)$/.exec(cleanText(header));
  return m ? (STATE_CODES[m[1].trim()] ?? null) : null;
}

/** The standard search's rows (in page order, one per event id) and its stated total. */
export function parseStandardSearch(html: string, host: string): StandardSearch {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const total = /returned\s+([\d,]+)\s+event/i.exec(body);
  const rows: SearchRow[] = [];
  const seen = new Set<string>();
  const token = new RegExp(`${SECTION.source}|${ROW.source}`, "gi");
  let state: string | null = null;
  for (const m of body.matchAll(token)) {
    if (m[1] !== undefined) {
      state = sectionState(m[1]);
      continue;
    }
    const slateId = m[2].toLowerCase();
    if (seen.has(slateId)) continue;
    seen.add(slateId);
    const lines = m[4]
      .split(/<br\s*\/?>/i)
      .map(cleanText)
      .filter(Boolean);
    const when = lines[0] ?? "";
    const place = lines[1] ?? "";
    const placeState = /,\s*([A-Z]{2})$/.exec(place)?.[1] ?? null;
    rows.push({ slateId, title: cleanText(m[3]), when, place, state: state ?? placeState, bookUrl: `https://${host}/register/?id=${slateId}` });
  }
  return { total: total ? Number(total[1].replace(/,/g, "")) : null, rows };
}

/** Whether a page is Slate's "Event Registration" page (the search form or its results): how discovery confirms a host. */
export function isSlateEventRegistration(html: string): boolean {
  return /<h1>\s*Event Registration\s*<\/h1>/i.test(html) && (/returned\s+[\d,]+\s+event/i.test(html) || /name="zip"/i.test(html) || /name="country"/i.test(html));
}

/** The standard search URL for a host. */
export function searchUrl(host: string): string {
  return `https://${host}/register/?cmd=search&country=US`;
}
