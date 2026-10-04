/**
 * Pi Beta Phi, Find a Chapter or Club (pibetaphi.org/join/find-a-chapter/). NPC (Panhellenic) sorority. The visible
 * widget loads through "Ajax Load More", but the same markup is also server-rendered in a `<noscript>` fallback as
 * plain `.map-result` divs, each tagged `data-chapter-type="chapter"` (active collegiate chapters) or `"club"`
 * (alumnae clubs, left out). robots.txt allows everything (checked 2026-10-04).
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://pibetaphi.org/join/find-a-chapter/";

const RESULT =
  /<div class="map-result"[^>]*data-chapter-type="chapter">\s*<div class="result-wrapper">\s*<span>[^<]*<\/span>\s*<h2 class="h3">([^<]*)<\/h2>\s*<p class="meta">\s*([^|<]*)\|\s*([^<]*?)\s*<\/p>/g;

export function entriesFrom(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const m of html.matchAll(RESULT)) {
    const [, name, location, college] = m;
    const locMatch = location.trim().match(/^(.*),\s*(.+)$/);
    out.push({
      campus: college.trim(),
      name: name.trim(),
      ...(locMatch ? { city: locMatch[1].trim(), state: locMatch[2].trim() } : {}),
    });
  }
  return out;
}

export default defineAdapter({
  key: "pi-beta-phi",
  organization: "Pi Beta Phi",
  publisher: "Pi Beta Phi",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} collegiate chapters (noscript fallback)`);
    return entries;
  },
});
