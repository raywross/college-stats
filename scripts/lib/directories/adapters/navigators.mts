/**
 * The Navigators, Collegiate Ministry "Find a Campus" map (specs/religious-life.md; specs/campus-directories.md).
 * navigators.org/ministries/collegiate redirects to the separate site collegiatenavigators.org, whose "Find a
 * Campus" section server-renders a Google Map's markers as inline `deLocations.push({ title: `<h3>Campus
 * Name</h3>...<p>Address, ST 00000</p>...` })` calls (no API call needed; checked 2026-10-04: 281 markers).
 * robots.txt: `Crawl-delay: 10`, otherwise permissive.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://collegiatenavigators.org/";

const NAME = /<h3>([^<]+)<\/h3>/;
/**
 * "1 Silber Way Boston, MA 2215" → state "MA" (zips print without a leading zero, so length varies). The street
 * address before the city makes the city itself unreliable to isolate ("255 Heisman Dr Auburn, AL"), so only the
 * state — always the two letters right before the address — is read.
 */
const STATE = /,\s*([A-Z]{2})\b/;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
/** Named and numeric entities ("&amp;" → "&"); unknown ones are left as written. */
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] !== "#") return NAMED_ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });

export function entriesFrom(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  const re = /deLocations\.push\(\{[\s\S]*?title:\s*`([\s\S]*?)`,/g;
  for (const m of html.matchAll(re)) {
    const title = m[1];
    const name = decode(NAME.exec(title)?.[1]?.trim() ?? "");
    if (!name) continue;
    const text = title.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ");
    const state = STATE.exec(text)?.[1];
    // No distinct chapter name here (the map names only the campus), so `name` is left out (display falls back to
    // "The Navigators"), the same as the unbranded entries in ruf.mts.
    out.push({ campus: name, ...(state ? { state } : {}) });
  }
  return out;
}

export default defineAdapter({
  key: "navigators",
  organization: "The Navigators",
  publisher: "The Navigators",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "christian",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} campus markers`);
    return entries;
  },
});
