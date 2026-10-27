/**
 * Quad Advisor's splash page (specs/product/advisor.md "3. The page: /advisor, signed out"): what the Advisor tab
 * shows a visitor without an account, in place of the old signed-out plan. Every section is a title, one line, and a
 * frame that renders the product's own components (or a presentational twin with the same primitives where the real
 * one needs a plan's context or store) for one labeled sample student, `data/reference/sample-plan.json`. College
 * figures come from the dataset and are cited as everywhere else.
 *
 * Dynamic, not the spec's daily-revalidated static page: `/advisor` reads the session first (app/advisor/page.tsx
 * calls `connection()` and `getUser()`), and this is its signed-out branch. Until the trial ships (build order step
 * 3), the buttons start a plain account and the price line says Quad is free in preview.
 */
import sampleFile from "@/data/reference/sample-plan.json";
import { getData } from "@/lib/data";
import { offerFacts } from "@/lib/planner/offers-server";
import { emptyProfile } from "@/lib/student-profile";
import { buildSplash, type SampleFixture } from "./sample";
import { SplashBeacon } from "./SplashBeacon";
import { Hero } from "./sections/Hero";
import { WhereYouStand } from "./sections/WhereYouStand";
import { ThisSeason } from "./sections/ThisSeason";
import { NeverMissADate } from "./sections/NeverMissADate";
import { ForParents } from "./sections/ForParents";
import { Offers } from "./sections/Offers";
import { WhatItReads } from "./sections/WhatItReads";
import { WhatItNeverDoes } from "./sections/WhatItNeverDoes";
import { Counselors } from "./sections/Counselors";
import { Questions } from "./sections/Questions";
import { Close } from "./sections/Close";

const SAMPLE = sampleFile as SampleFixture;

/**
 * The frames rise (and the pills pop) as they scroll into view where the browser supports scroll-driven animation;
 * elsewhere they play once on load. Unlayered, so it wins over Tailwind's `animate-*` shorthand, which would reset the
 * timeline. Reduce Motion turns both off (app/globals.css shortens every animation; a scroll timeline ignores that).
 */
const MOTION_CSS = `@supports (animation-timeline: view()) {
  .splash-rise, .splash-pop { animation-timeline: view(); animation-range: entry 0% entry 60%; animation-delay: 0s !important; }
}
@media (prefers-reduced-motion: reduce) {
  .splash-rise, .splash-pop { animation: none !important; }
}`;

export async function Splash({ signedIn = false }: { signedIn?: boolean }) {
  const ds = await getData();
  const base = emptyProfile();
  const profile = { ...base, basics: { ...base.basics, stateOfResidence: SAMPLE.homeState } };
  const facts = await offerFacts(
    SAMPLE.offers.map((o) => o.unit_id),
    profile,
  );
  const data = buildSplash(SAMPLE, ds, facts);
  // The wrapper undoes the advisor layout's gutters and top space (app/advisor/layout.tsx), so the hero runs edge to
  // edge; each section sets its own.
  return (
    <div className="-mx-4 -mt-5 -mb-12 sm:-mx-6 sm:-mt-10" data-splash>
      <style>{MOTION_CSS}</style>
      <SplashBeacon signedIn={signedIn} />
      <Hero data={data} />
      <WhereYouStand data={data} />
      <ThisSeason data={data} />
      <NeverMissADate data={data} />
      <ForParents data={data} />
      <Offers data={data} />
      <WhatItReads data={data} />
      <WhatItNeverDoes />
      <Counselors />
      <Questions />
      <Close />
    </div>
  );
}

export default Splash;
