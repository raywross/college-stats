/**
 * Trans Policy Clearinghouse: colleges that let students use a chosen name and pronouns on campus records
 * ("Name and Pronouns"; specs/lgbtq-life.md "Source tiers"; owner decision 4: publish with credit, tier D).
 * robots.txt allows this path (checked 2026-10-04). A trailing "**" on some entries is the source's own footnote
 * marker (not explained inline); dropped, like the start year, by the shared parser.
 */
import { defineAdapter } from "../contract.mts";
import { entriesFromAccordion } from "./_tpc-common.mts";

const LIST_URL = "https://www.gennyb.com/research/trans-supportive-campus-policies/name-and-pronouns/";

export default defineAdapter({
  key: "tpc-name-pronouns",
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "name_on_records",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFromAccordion(html);
    ctx.log(`${entries.length} colleges listed that allow a chosen name and pronouns on campus records`);
    return entries;
  },
});
