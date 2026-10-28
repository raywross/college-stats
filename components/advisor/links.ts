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

/** Counselors' contact until the portal exists (specs/product/counselor-portal.md): the hello address (lib/contacts.ts). */
export const COUNSELOR_CONTACT = mailto(HELLO_EMAIL, { subject: "Counselor access to Quad" });
