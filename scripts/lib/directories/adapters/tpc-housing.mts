/**
 * Trans Policy Clearinghouse (Dr. Genny Beemyn, gennyb.com): colleges with gender-inclusive housing
 * (specs/lgbtq-life.md "Source tiers"; owner decision 4: publish with credit, tier D). robots.txt allows this path
 * (Crawl-delay: 10, checked 2026-10-04). "At least 488 colleges," last updated 9/21/26 per the page itself.
 */
import { defineAdapter } from "../contract.mts";
import { entriesFromAccordion } from "./_tpc-common.mts";

const LIST_URL = "https://www.gennyb.com/research/trans-supportive-campus-policies/colleges-and-universities-that-provide-gender-inclusive-housing";

export default defineAdapter({
  key: "tpc-housing",
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "inclusive_housing",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFromAccordion(html);
    ctx.log(`${entries.length} colleges listed with gender-inclusive housing`);
    return entries;
  },
});
