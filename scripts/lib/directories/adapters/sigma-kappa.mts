/**
 * Sigma Kappa, "Find a Chapter" (sigmakappa.org/find-a-chapter). NPC (Panhellenic) sorority. Static server-rendered
 * cards: `<article class="chapter-card collegiate-card">` for active collegiate chapters (a separate
 * "alumnae-card" class is left out), each with the chapter's Greek name, "City, ST" location, and school. robots.txt
 * allows everything (checked 2026-10-04); no status field, so colonies aren't distinguished from chartered chapters.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://www.sigmakappa.org/find-a-chapter";

const CARD =
  /<article class="chapter-card collegiate-card"[^>]*>\s*<div class="chapter-name">([^<]*)<\/div>\s*<div class="chapter-location">([^<]*)<\/div>\s*<div class="chapter-school">([^<]*)<\/div>\s*<\/article>/g;

export function entriesFrom(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const m of html.matchAll(CARD)) {
    const [, name, location, school] = m;
    const locMatch = location.trim().match(/^(.*),\s*(.+)$/);
    out.push({
      campus: school.trim(),
      name: name.trim(),
      ...(locMatch ? { city: locMatch[1].trim(), state: locMatch[2].trim() } : {}),
    });
  }
  return out;
}

export default defineAdapter({
  key: "sigma-kappa",
  organization: "Sigma Kappa",
  publisher: "Sigma Kappa",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} collegiate chapter cards`);
    return entries;
  },
});
