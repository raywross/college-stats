import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CtaLink } from "@/components/advisor/CtaLink";
import { PRICE_LINE, SIGN_IN_HREF, START_HREF } from "@/components/advisor/links";
import { START_BUTTON } from "@/components/advisor/sections/Hero";
import { ADVISOR_NAME } from "@/lib/planner/advisor";

/** Close: the button again, the price line, and sign-in for someone who already has an account. */
export function Close() {
  return (
    <section aria-labelledby="advisor-close-title" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="relative isolate overflow-hidden rounded-3xl border bg-card px-5 py-10 text-center sm:px-10 sm:py-14">
        <div className="absolute -top-20 -right-20 -z-10 size-64 rounded-full blur-3xl" style={{ background: "var(--hero-glow-1)" }} aria-hidden />
        <h2 id="advisor-close-title" className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          Start <span className="highlight">{ADVISOR_NAME}</span>
        </h2>
        <div className="mt-6 flex flex-col items-center gap-2">
          <CtaLink href={START_HREF} section="close" className={START_BUTTON}>
            Start free <ArrowRight className="size-4" aria-hidden />
          </CtaLink>
          <p className="text-sm text-muted-foreground">{PRICE_LINE}</p>
          <p className="text-sm">
            Already have an account?{" "}
            <Link href={SIGN_IN_HREF} className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
