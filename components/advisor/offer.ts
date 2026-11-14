import "server-only";
/**
 * What the splash page offers today (specs/product/advisor.md "3. The page", the button's path): while the price isn't
 * live, "Start free" opens the sign-up form and the price line says Quad is in preview (build order step 2); once the
 * owner sets `advisor.price_live_at` and Stripe is configured, the button says the trial and the sign-up comes back to
 * the upgrade sheet, /advisor/start (step 3). One read, the planner's settings read, shared with the plan.
 */
import { loginHref } from "@/lib/accounts";
import { TRIAL_CTA, trialPriceLine } from "@/lib/billing";
import { priceLive } from "@/lib/entitlements";
import { PREVIEW_OFFER, type AdvisorOffer } from "./links";

export { PREVIEW_OFFER, type AdvisorOffer };

export async function advisorOffer(): Promise<AdvisorOffer> {
  if (!(await priceLive())) return PREVIEW_OFFER;
  return { live: true, cta: TRIAL_CTA, priceLine: trialPriceLine(), href: `${loginHref("/advisor/start")}&mode=signup` };
}
