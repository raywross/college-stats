import { ArrowRight } from "lucide-react";
import { CtaLink } from "@/components/advisor/CtaLink";
import { PhoneFrame } from "@/components/advisor/Frame";
import { SampleNow } from "@/components/advisor/SampleNow";
import { PRICE_LINE, START_HREF } from "@/components/advisor/links";
import type { SplashData } from "@/components/advisor/sample";
import { ADVISOR_NAME } from "@/lib/planner/advisor";

/** The button every section that has one uses: violet, pill, 48px. */
export const START_BUTTON =
  "inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 hover:bg-primary/90";

/**
 * The hero (advisor.md "3. The page", Hero): the eyebrow, the headline in the display face, the one sentence, "Start
 * free" with the preview price line, and on the right a phone showing the sample student's Advisor tab (the Three
 * things frame, reused). On phones the phone is left out: the same cards are the third section, a scroll away.
 */
export function Hero({ data }: { data: SplashData }) {
  return (
    <section className="relative isolate border-b" aria-labelledby="advisor-hero-title">
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-dots opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="absolute -top-40 -left-32 size-[36rem] animate-[drift_18s_ease-in-out_infinite] rounded-full blur-3xl" style={{ background: "var(--hero-glow-1)" }} />
        <div className="absolute top-10 right-[-10rem] size-[30rem] animate-[drift_22s_ease-in-out_infinite_reverse] rounded-full blur-3xl" style={{ background: "var(--hero-glow-2)" }} />
      </div>
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-8 pb-10 sm:px-6 sm:pt-16 sm:pb-20 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="inline-flex animate-rise items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-semibold backdrop-blur">
            <span className="size-2 rounded-full bg-primary" aria-hidden />
            {ADVISOR_NAME}
          </p>
          <h1 id="advisor-hero-title" className="mt-4 animate-rise font-display text-[2.5rem] leading-[0.98] font-extrabold tracking-tight [animation-delay:60ms] sm:mt-5 sm:text-6xl">
            An advisor for the whole road to college, <span className="highlight">in your pocket.</span>
          </h1>
          <p className="mt-4 max-w-xl animate-rise text-base text-muted-foreground [animation-delay:120ms] sm:mt-5 sm:text-lg">
            It reads your record, sorts your list by where you stand, tells you the three things to do this season and how, and never misses a date.
          </p>
          <div className="mt-6 flex animate-rise flex-col items-start gap-2 [animation-delay:180ms] sm:mt-8">
            <CtaLink href={START_HREF} section="hero" className={START_BUTTON}>
              Start free <ArrowRight className="size-4" aria-hidden />
            </CtaLink>
            <p className="text-sm text-muted-foreground">{PRICE_LINE}</p>
          </div>
        </div>
        <div className="hidden min-w-0 md:block">
          <PhoneFrame badge={data.badge}>
            <SampleNow heading={data.seasonHeading} moves={data.moves} />
          </PhoneFrame>
        </div>
      </div>
    </section>
  );
}
