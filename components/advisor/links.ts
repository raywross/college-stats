/**
 * Where the splash page's buttons go (specs/product/advisor.md "The button's path", build order step 2): until the
 * trial ships, "Start free" opens the sign-up form and comes back to /advisor, which is the plan as today. Pure and
 * client-safe (lib/accounts.ts' `loginHref` is), so the client `CtaLink` and the server sections share it.
 */
import { loginHref } from "@/lib/accounts";
import { HELLO_EMAIL, mailto } from "@/lib/contacts";
import { ADVISOR_PATH } from "@/lib/planner/advisor";

/** `/login?next=%2Fadvisor&mode=signup`: the sign-in page opened on "Create an account" (LoginForm's `initialMode`). */
export const START_HREF = `${loginHref(ADVISOR_PATH)}&mode=signup`;

/** `/login?next=%2Fadvisor`: "Already have an account? Sign in". */
export const SIGN_IN_HREF = loginHref(ADVISOR_PATH);

/** The price line under every "Start free" button until the trial ships (no trial wording before part 3). */
export const PRICE_LINE = "Free while Quad is in preview.";

/** What the splash page's buttons offer (components/advisor/offer.ts decides which, from the price-live setting). */
export interface AdvisorOffer {
  live: boolean;
  cta: string;
  priceLine: string;
  /** Where the button goes: sign-up, back to /advisor (preview) or on to /advisor/start (the trial). */
  href: string;
}

/** The button every section that has one uses (and the upgrade sheet's): violet, pill, 48px. */
export const START_BUTTON =
  "inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 hover:bg-primary/90";

/** The preview's offer (build order step 2): "Start free", the preview price line, sign-up back to /advisor. */
export const PREVIEW_OFFER: AdvisorOffer = { live: false, cta: "Start free", priceLine: PRICE_LINE, href: START_HREF };

/** Counselors' contact until the portal exists (specs/product/counselor-portal.md): the hello address (lib/contacts.ts). */
export const COUNSELOR_CONTACT = mailto(HELLO_EMAIL, { subject: "Counselor access to Quad" });
