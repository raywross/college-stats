/**
 * Trans Policy Clearinghouse: colleges whose student health insurance covers transition-related care ("Medical
 * Expense Coverage"; specs/lgbtq-life.md "Source tiers"; owner decision 4: publish with credit, tier D). robots.txt
 * allows this path (checked 2026-10-04).
 */
import { defineAdapter } from "../contract.mts";
import { entriesFromAccordion } from "./_tpc-common.mts";

const LIST_URL = "https://www.gennyb.com/research/trans-supportive-campus-policies/medical-expense-coverage";

export default defineAdapter({
  key: "tpc-health-plan",
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "health_plan_transition",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFromAccordion(html);
    ctx.log(`${entries.length} colleges listed whose student health plan covers transition-related care`);
    return entries;
  },
});
