/**
 * Trans Policy Clearinghouse: colleges with a trans-inclusive athletic policy (intramurals and club sports only;
 * varsity eligibility is set nationally by the NCAA, per lgbtq-life.md open question 3). Same shared accordion as
 * the other five lists; robots.txt allows this path (checked 2026-10-04). 63 colleges across 22 states (2026-10-04).
 */
import { defineAdapter } from "../contract.mts";
import { entriesFromAccordion } from "./_tpc-common.mts";

const LIST_URL = "https://www.gennyb.com/research/trans-supportive-campus-policies/athletic-policies";

export default defineAdapter({
  key: "tpc-athletics",
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "trans_athletics",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFromAccordion(html);
    ctx.log(`${entries.length} colleges listed with a trans-inclusive athletic policy`);
    return entries;
  },
});
