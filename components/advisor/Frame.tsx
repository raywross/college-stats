/**
 * The splash page's building blocks (specs/product/advisor.md "Rules"): `SampleBadge`, the lime "Sample: Jordan, class
 * of 2028" pill every frame wears in its corner; `SampleFrame`, the frame that holds one real (or twin) component and
 * rises in as it scrolls into view; `SplashSection`, a title, one line, and the frame (less-text.md: nothing more);
 * `PhoneFrame`, the hero's phone bezel. No hooks, so server components render them.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The corner label: the student is made up, the colleges and figures are real. */
export function SampleBadge({ label }: { label: string }) {
  return (
    <span data-sample-badge className="absolute -top-3 right-4 z-20 inline-flex max-w-[calc(100%-2rem)] items-center truncate rounded-full bg-pop px-2.5 py-0.5 text-[11px] font-bold text-pop-foreground shadow-sm ring-1 ring-black/5">
      {label}
    </span>
  );
}

/**
 * One frame: the badge in its corner, the component inside. `plain` drops the frame's own card (for a component that
 * is a card already). The rise is the site's keyframe, driven by scrolling where the browser can (`splash-rise`,
 * Splash.tsx's style block) and off under Reduce Motion.
 */
export function SampleFrame({ badge, children, className, label }: { badge: string; children: ReactNode; className?: string; label: string }) {
  return (
    <figure aria-label={label} className={cn("splash-rise relative min-w-0 animate-rise rounded-3xl border bg-surface-2/60 p-3 pt-5 shadow-xl shadow-primary/5 sm:p-4 sm:pt-6", className)}>
      <SampleBadge label={badge} />
      {children}
    </figure>
  );
}

/** A section: its title and one line on one side, the frame on the other (from `lg`; stacked on phones). */
export function SplashSection({
  id,
  title,
  line,
  children,
  flip = false,
}: {
  id: string;
  title: string;
  line: ReactNode;
  children?: ReactNode;
  /** Put the frame on the left from `lg`, so the sections alternate. */
  flip?: boolean;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className={cn("grid items-center gap-6 sm:gap-8", children ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : "")}>
        <div className={cn("min-w-0", flip && children && "lg:order-2")}>
          <h2 id={`${id}-title`} className="font-display text-2xl font-extrabold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-2 max-w-xl text-base text-muted-foreground sm:text-lg">{line}</p>
        </div>
        {children && <div className={cn("min-w-0", flip && "lg:order-1")}>{children}</div>}
      </div>
    </section>
  );
}

/** The hero's phone: a bezel around the plain component, about a phone's width. */
export function PhoneFrame({ badge, children }: { badge: string; children: ReactNode }) {
  return (
    <figure aria-label={`${badge}: the Advisor tab on a phone`} className="relative mx-auto w-full max-w-[22rem] animate-rise [animation-delay:200ms]">
      <SampleBadge label={badge} />
      <div className="overflow-hidden rounded-[2.75rem] border-[10px] border-foreground/90 bg-background shadow-2xl shadow-primary/20">
        <div className="mx-auto mt-2 h-5 w-24 rounded-full bg-foreground/90" aria-hidden />
        <div className="max-h-[34rem] overflow-hidden p-3">{children}</div>
      </div>
    </figure>
  );
}
