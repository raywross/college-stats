/**
 * Address suggestions as you type (specs/product/home-and-distance.md "Autocomplete"): the pure parts. The home
 * form asks the server for suggestions once the visitor has typed a few characters; the server asks Google's
 * Place Autocomplete (New) with the site's key (lib/geocode.ts) and sends back plain text suggestions. Picking one
 * only fills the field: the saved coordinates still come from the Census geocoder, as for a typed address.
 */

export interface AddressSuggestion {
  /** The full line to put in the field: "77 Massachusetts Avenue, Cambridge, MA 02139, USA". */
  text: string;
  /** "77 Massachusetts Avenue" */
  main: string;
  /** "Cambridge, MA 02139, USA" */
  secondary: string;
}

export type SuggestProvider = "google";

export interface SuggestResult {
  suggestions: AddressSuggestion[];
  /** Which service answered (for the attribution it requires), or null when none is configured or it failed. */
  provider: SuggestProvider | null;
}

/** Don't ask before this many characters: shorter input returns noise and spends quota. */
export const SUGGEST_MIN_CHARS = 3;
export const SUGGEST_MAX_CHARS = 200;
/** How many suggestions to show. */
export const SUGGEST_LIMIT = 5;

export function shouldSuggest(input: string): boolean {
  const t = input.trim();
  return t.length >= SUGGEST_MIN_CHARS && t.length <= SUGGEST_MAX_CHARS;
}

/** Trims and collapses spaces, and drops a trailing country that suggestion text carries ("…, USA"). */
export function normalizeAddressInput(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,?\s*(USA|U\.S\.A\.|United States( of America)?)\s*$/i, "")
    .trim();
}

interface GooglePrediction {
  placePrediction?: {
    text?: { text?: unknown };
    structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } };
  };
}

/**
 * Google's Place Autocomplete (New) answer (`places.googleapis.com/v1/places:autocomplete`): each
 * `placePrediction` as a suggestion. Query predictions (free-text searches, not places) and malformed entries are
 * skipped; at most SUGGEST_LIMIT come back.
 */
export function parseGoogleAutocomplete(json: unknown): AddressSuggestion[] {
  const list = (json as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: AddressSuggestion[] = [];
  for (const item of list as GooglePrediction[]) {
    const p = item?.placePrediction;
    const text = typeof p?.text?.text === "string" ? p.text.text.trim() : "";
    if (!text) continue;
    const main = typeof p?.structuredFormat?.mainText?.text === "string" ? p.structuredFormat.mainText.text.trim() : text;
    const secondary = typeof p?.structuredFormat?.secondaryText?.text === "string" ? p.structuredFormat.secondaryText.text.trim() : "";
    out.push({ text, main, secondary });
    if (out.length >= SUGGEST_LIMIT) break;
  }
  return out;
}

/** A session token groups one field session's keystrokes for Google's billing: any UUID v4-shaped string. */
export function isSessionToken(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
