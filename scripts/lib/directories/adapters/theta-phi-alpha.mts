/**
 * Theta Phi Alpha, Find a Chapter (thetaphialpha.org/find-a-chapter/). NPC (Panhellenic) sorority. The page uses the
 * "WP Store Locator" plugin, whose chapters all load through one AJAX call
 * (`admin-ajax.php?action=store_search`); asking for a radius covering the continental US in one request returns
 * every chapter (49, well under its `max_results`), each with the college in parentheses ahead of the street
 * address and the chapter's Greek name in `store`. robots.txt allows everything (checked 2026-10-04).
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://thetaphialpha.org/find-a-chapter/";
const AJAX_URL = "https://thetaphialpha.org/wp-admin/admin-ajax.php";

interface WpslStore {
  store: string;
  address: string;
  city?: string;
  state?: string;
}

export function entriesFrom(json: string): RawEntry[] {
  const stores = JSON.parse(json) as WpslStore[];
  const out: RawEntry[] = [];
  for (const s of stores) {
    const m = s.address.match(/^\(([^)]*)\)/);
    if (!m) continue;
    out.push({ campus: m[1].trim(), name: s.store.trim(), ...(s.city ? { city: s.city } : {}), ...(s.state ? { state: s.state } : {}) });
  }
  return out;
}

export default defineAdapter({
  key: "theta-phi-alpha",
  organization: "Theta Phi Alpha",
  publisher: "Theta Phi Alpha",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const params = new URLSearchParams({
      action: "store_search",
      autoload: "1",
      lat: "39.5",
      lng: "-98.35",
      max_results: "500",
      search_radius: "5000",
      units: "km",
    });
    const json = await ctx.fetchText(`${AJAX_URL}?${params}`);
    const entries = entriesFrom(json);
    ctx.log(`${entries.length} chapters (WP Store Locator)`);
    return entries;
  },
});
