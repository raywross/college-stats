/**
 * Kappa Delta, Find a Chapter (kappadelta.org/find-a-chapter). NPC (Panhellenic) sorority. Server-rendered map
 * markers, each a `<div class="single-mod-marker" ... data-chapter-name="…" data-school="…" data-state="…"
 * data-shortstate="…" data-chapter="Collegiate Chapters|Alumnae Chapters" ...>`; alumnae chapters (and the markers
 * that only name a chapter without a school, i.e. alumnae groups) are filtered out by `data-chapter`. robots.txt
 * allows everything (checked 2026-10-04).
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://kappadelta.org/find-a-chapter/";

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

export function entriesFrom(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const m of html.matchAll(/<div class="single-mod-marker"[^>]*>/g)) {
    const tag = m[0];
    if (attr(tag, "data-chapter") !== "Collegiate Chapters") continue;
    const name = attr(tag, "data-chapter-name");
    const school = attr(tag, "data-school");
    const shortstate = attr(tag, "data-shortstate");
    if (!name || !school) continue;
    out.push({ campus: school, name, ...(shortstate ? { state: shortstate } : {}) });
  }
  return out;
}

export default defineAdapter({
  key: "kappa-delta",
  organization: "Kappa Delta",
  publisher: "Kappa Delta",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} collegiate chapter markers`);
    return entries;
  },
});
