/**
 * Phi Mu, Chapter Locator (phimu.org/about-phi-mu/chapter-locator/). NPC (Panhellenic) sorority. The page only
 * server-renders a handful of chapters; the full list loads through the "Ajax Load More" WordPress plugin, whose
 * admin-ajax action accepts the listing's own `data-*` attributes as a plain GET (WordPress's admin-ajax.php reads
 * `$_REQUEST`, so the plugin's nonce-guarded action works over GET as well as the POST its own JS uses). Two
 * requests: the locator page (to read the page's `alm_nonce`) then one `alm_get_posts` call asking for every
 * `chapter_type=collegiate` post. robots.txt allows everything (checked 2026-10-04).
 */
import { decodeEntities } from "./_text.mts";
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://phimu.org/about-phi-mu/chapter-locator/";
const AJAX_URL = "https://phimu.org/wp-admin/admin-ajax.php";

export function parseNonce(html: string): string | null {
  const m = html.match(/"alm_nonce":"([a-f0-9]+)"/);
  return m ? m[1] : null;
}

const ITEM =
  /<div class="chapter_item" data-state="([a-z]{2})">\s*<span class="chapter_item_label">\s*([^<]*?)\s*<\/span>\s*<h3>\s*([^<]*?)\s*<\/h3>[\s\S]*?(?:<p class="chapter_item_location">\s*([^<]*?)\s*<\/p>)?\s*<\/div>/g;

export function entriesFrom(json: string): RawEntry[] {
  const data = JSON.parse(json) as { html?: string };
  const html = data.html ?? "";
  const out: RawEntry[] = [];
  for (const m of html.matchAll(ITEM)) {
    const [, , name, college, location] = m;
    const locParts = location?.split(",").map((p) => p.trim());
    out.push({
      campus: decodeEntities(college),
      name: decodeEntities(name),
      ...(locParts?.length === 2 ? { city: locParts[0], state: locParts[1] } : {}),
    });
  }
  return out;
}

export default defineAdapter({
  key: "phi-mu",
  organization: "Phi Mu",
  publisher: "Phi Mu",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const page = await ctx.fetchText(LIST_URL);
    const nonce = parseNonce(page);
    if (!nonce) throw new Error("phi-mu: no alm_nonce found on the locator page; its Ajax Load More markup may have changed");
    const params = new URLSearchParams({
      action: "alm_get_posts",
      post_type: "chapter",
      posts_per_page: "600",
      meta_key: "chapter_type",
      meta_value: "collegiate",
      meta_compare: "=",
      order: "ASC",
      orderby: "title",
      page: "0",
      repeater: "template_3",
      alm_nonce: nonce,
      canonical_url: LIST_URL,
    });
    const json = await ctx.fetchText(`${AJAX_URL}?${params}`);
    const entries = entriesFrom(json);
    ctx.log(`${entries.length} collegiate chapters (Ajax Load More)`);
    return entries;
  },
});
