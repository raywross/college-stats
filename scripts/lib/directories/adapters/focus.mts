/**
 * FOCUS (Fellowship of Catholic University Students), "Campuses" (specs/religious-life.md; specs/campus-directories.md).
 * https://focus.org/about/campuses/ (focusoncampus.org/find-my-campus redirects here) is one static page, campuses
 * grouped under a state heading (`<span class="vc_tta-title-text">`); 216 campuses across 48 states, checked
 * 2026-10-04. robots.txt: `Crawl-delay: 10`, otherwise permissive.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://focus.org/about/campuses/";

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
/** Named and numeric entities ("&#038;" → "&", "&#8211;" → "–"); unknown ones are left as written. */
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] !== "#") return NAMED_ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });

/** The page's own heading for Washington, D.C. campuses, so `postalOf` can resolve it (religious-life.md#measures). */
const STATE_HEADING: Record<string, string> = { "Washington, DC": "DC" };

/** State sections in order, each heading applying to the campuses listed under it until the next heading. */
export function entriesFrom(html: string): RawEntry[] {
  const re = /vc_tta-title-text">([^<]+)<\/span>|campusmoredh5"><a href="([^"]+)">([^<]+)<\/a>/g;
  const out: RawEntry[] = [];
  let state: string | null = null;
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      const heading = decode(m[1]).trim();
      state = STATE_HEADING[heading] ?? heading;
    } else out.push({ campus: decode(m[3]).trim(), url: m[2], ...(state ? { state } : {}) });
  }
  return out;
}

export default defineAdapter({
  key: "focus",
  organization: "FOCUS (Fellowship of Catholic University Students)",
  publisher: "FOCUS",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "catholic",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} campuses`);
    return entries;
  },
});
