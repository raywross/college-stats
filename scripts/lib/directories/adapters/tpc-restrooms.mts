/**
 * Trans Policy Clearinghouse: colleges with gender-inclusive restrooms listed online (specs/lgbtq-life.md
 * "Source tiers"; owner decision 4: publish with credit, tier D). robots.txt allows this path (checked 2026-10-04).
 */
import { defineAdapter } from "../contract.mts";
import { entriesFromAccordion } from "./_tpc-common.mts";

const LIST_URL = "https://www.gennyb.com/research/trans-supportive-campus-policies/gender-inclusive-restrooms";

export default defineAdapter({
  key: "tpc-restrooms",
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "inclusive_restrooms",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFromAccordion(html);
    ctx.log(`${entries.length} colleges listed with gender-inclusive restrooms online`);
    return entries;
  },
});
