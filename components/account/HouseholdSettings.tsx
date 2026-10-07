"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, Settings } from "lucide-react";
import { leaveHousehold } from "@/app/household/actions";
import { Term } from "@/components/ui/info-tip";
import type { HomeRow } from "@/lib/home-store";
import type { HouseholdView } from "@/lib/household-rules";
import { HomeForm } from "./HomeForm";
import { HouseholdActionButton } from "./HouseholdActionButton";

/** The anchor old links use (/household#home, "Add your household's home address" on a list). */
const ANCHOR = "home";

/**
 * "Household settings" at the bottom of every /household page (app/household/layout.tsx; specs/product/household-hub.md
 * "Redesign (2026-10-06)"): a `<details>` closed by default, because a family sets these once and then works in the
 * lists. Inside: the home address (HomeForm) and the Leave household line. It opens itself, and scrolls into view,
 * when the address bar's hash is #home, on load or when an in-page `<a href="#home">` is followed (a plain anchor,
 * since a hash change made by the router fires no hashchange).
 */
export function HouseholdSettings({
  household,
  home,
  suggestions,
  viewerIsStudent,
}: {
  household: HouseholdView;
  home: HomeRow | null;
  suggestions: boolean;
  viewerIsStudent: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const openOnHash = () => {
      if (window.location.hash !== `#${ANCHOR}` || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    };
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    return () => window.removeEventListener("hashchange", openOnHash);
  }, []);

  const member = household.me.guardian !== null || household.me.student !== null;
  return (
    <details ref={ref} id={ANCHOR} className="group mt-10 scroll-mt-24 rounded-3xl border bg-card print:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 rounded-3xl px-4 py-3 text-sm font-semibold select-none hover:bg-muted/50 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Settings className="size-4 text-muted-foreground" aria-hidden />
        Household settings
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-6 border-t px-4 py-5 sm:px-5">
        <section aria-labelledby="home-title">
          <h2 id="home-title" className="font-display text-lg font-bold">
            <Term term="home-address">Home address</Term>
          </h2>
          <p className="mt-0.5 mb-3 text-sm text-muted-foreground">Explore and lists say how far each college is from here, for everyone in this household.</p>
          <HomeForm household={household.id} home={home} suggestions={suggestions} />
        </section>
        {member && (
          <section className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
              {viewerIsStudent
                ? `Leaving ${household.name} stops its guardians seeing your information.`
                : `Leaving ${household.name} stops you seeing its students' information.`}{" "}
              Coming back takes a new invitation.
            </p>
            <HouseholdActionButton
              action={leaveHousehold}
              fields={{ household: household.id }}
              label="Leave household"
              tone="danger"
              confirm={`Leave ${household.name}? ${viewerIsStudent ? "Its guardians will stop seeing your information right away." : "You'll stop seeing its students' information right away."} To come back you'll need a new invitation.`}
            />
          </section>
        )}
      </div>
    </details>
  );
}
