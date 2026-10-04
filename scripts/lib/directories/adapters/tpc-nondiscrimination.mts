/**
 * Trans Policy Clearinghouse: colleges whose nondiscrimination policy covers gender identity (specs/lgbtq-life.md
 * "Source tiers"; owner decision 4: publish with credit, tier D). robots.txt allows this path (checked 2026-10-04).
 * A few entries say the policy was "removed" (e.g. three Alabama and three Iowa colleges in 2025, by school
 * officials or a state law); the shared parser drops those rather than listing a policy that's gone.
 */
import { defineAdapter } from "../contract.mts";
import { entriesFromAccordion } from "./_tpc-common.mts";

const LIST_URL = "https://www.gennyb.com/research/trans-supportive-campus-policies/nondiscrimination-policies";

export default defineAdapter({
  key: "tpc-nondiscrimination",
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "nondiscrimination_identity",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFromAccordion(html);
    ctx.log(`${entries.length} colleges listed whose nondiscrimination policy covers gender identity`);
    return entries;
  },
});
