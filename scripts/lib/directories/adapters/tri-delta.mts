/**
 * Tri Delta (Delta Delta Delta), collegiate chapters (tridelta.org/our-members/find-a-chapter/). NPC (Panhellenic)
 * sorority. The locator page itself is a client-rendered map, but the custom post type backing it
 * (`tri_delta_chapters_c`, distinct from the alumnae `tri_delta_chapters_a`) is exposed on WordPress's public REST
 * API at `/wp-json/wp/v2/chapters_c`, titled "<Chapter> &#8211; <College>"; paginated (100/page, `X-WP-TotalPages`).
 * robots.txt allows everything (checked 2026-10-04).
 */
import { splitChapterCollege } from "./_text.mts";
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://www.tridelta.org/our-members/find-a-chapter/";
const API_URL = "https://www.tridelta.org/wp-json/wp/v2/chapters_c";

interface WpPost {
  title: { rendered: string };
  link: string;
}

export function entriesFrom(posts: readonly WpPost[]): RawEntry[] {
  const out: RawEntry[] = [];
  for (const post of posts) {
    const split = splitChapterCollege(post.title.rendered);
    if (!split) continue;
    const [chapter, college] = split;
    out.push({ campus: college, name: chapter, url: post.link });
  }
  return out;
}

export default defineAdapter({
  key: "tri-delta",
  organization: "Tri Delta",
  publisher: "Tri Delta",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const all: WpPost[] = [];
    for (let page = 1; page <= 10; page++) {
      const posts = await ctx.fetchJson<WpPost[]>(`${API_URL}?per_page=100&page=${page}`);
      all.push(...posts);
      if (posts.length < 100) break;
    }
    const entries = entriesFrom(all);
    ctx.log(`${all.length} collegiate-chapter posts, ${entries.length} parsed`);
    return entries;
  },
});
