/**
 * Trans Policy Clearinghouse: trans admission policies at historically women's and men's colleges
 * (specs/lgbtq-life.md "Source tiers"; owner decision 4: publish with credit, tier D). robots.txt allows this path
 * (checked 2026-10-04). Unlike the other six lists, this page is prose, not the shared accordion: each college gets
 * a paragraph naming it in bold (sometimes linked to its policy page) followed by Dr. Beemyn's description or a
 * quote from the policy. One adapter, not split per section, because every section is the same policy key
 * (trans_admission) at a different kind of college; the section becomes the entry's `name` (a short label, not a
 * chapter name, but the nearest fit in the shared Listing shape) — three colleges (Bennett, Stephens, Sweet Briar)
 * appear in two sections with the same URL, and the runner's de-duplication is keyed on campus/name/url, so without
 * a distinct name per section the second, different finding would silently vanish into the first.
 */
import { MAX_QUOTE } from "../../../../lib/directories.ts";
import { defineAdapter, type RawEntry } from "../contract.mts";
import { clean } from "./_tpc-common.mts";

const LIST_URL = "https://www.gennyb.com/research/trans-supportive-campus-policies/historically-womens-mens-colleges";

/** Section heading anchors, in the order the page lists them, and the short label each college's entry gets. */
const SECTIONS: Record<string, string> = {
  womenscollegesformalpolicies: "Admits some trans students (women's college)",
  womenscollegespreventtranswomen: "Prevents most trans women from being admitted (women's college)",
  womenscollegesbantransmen: "Bans trans men from remaining enrolled (women's college)",
  menscollegesformalpolicies: "Admission policy (men's college)",
};

const truncate = (s: string, max = MAX_QUOTE) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** One `<p class="wp-block-paragraph">…</p>` inner HTML → a college entry, or null when it names none (no `<strong>`). */
export function entryFromParagraph(p: string, name: string): RawEntry | null {
  const strong = /<strong>([\s\S]*?)<\/strong>/.exec(p);
  if (!strong) return null;
  const campus = clean(strong[1]).replace(/:\s*$/, "").trim();
  if (!campus) return null;
  const rest = clean(p.slice(strong.index + strong[0].length).replace(/^<\/a>/, "")).replace(/^:\s*/, "");
  const url = /<a href="(https?:\/\/[^"]+)"/.exec(p)?.[1];
  return { campus, name, ...(rest ? { quote: truncate(rest) } : {}), ...(url ? { url } : {}) };
}

/** Every college named across the four sections (anchor order), each paragraph parsed to one entry. */
export function entriesFrom(html: string): RawEntry[] {
  const headings = [...html.matchAll(/<h4 id="([a-z]+)" class="wp-block-heading"><strong>[\s\S]*?<\/strong><\/h4>/g)].map((m) => ({ anchor: m[1], tagStart: m.index!, contentStart: m.index! + m[0].length }));
  const out: RawEntry[] = [];
  for (let i = 0; i < headings.length; i++) {
    const name = SECTIONS[headings[i].anchor];
    if (!name) continue;
    const slice = html.slice(headings[i].contentStart, headings[i + 1]?.tagStart);
    for (const p of slice.matchAll(/<p class="wp-block-paragraph">([\s\S]*?)<\/p>/g)) {
      const e = entryFromParagraph(p[1], name);
      if (e) out.push(e);
    }
  }
  return out;
}

export default defineAdapter({
  key: "tpc-trans-admission",
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "trans_admission",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} colleges named across the trans admission policy sections`);
    return entries;
  },
});
