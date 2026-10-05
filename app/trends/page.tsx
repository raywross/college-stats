import type { Metadata } from "next";
import { getTrendFile } from "@/lib/data";
import { STUDIES, type StudyDef } from "@/lib/trend-studies";
import type { TrendCard } from "@/lib/trends";
import { ComingSection } from "@/components/trends/ComingSection";
import { StudyCard } from "@/components/trends/StudyCard";
import { Term } from "@/components/ui/info-tip";

export const metadata: Metadata = {
  title: "National trends",
  description: "How U.S. four-year colleges are changing: studies of the whole landscape from 20+ years of federal data, broken down by region, type, size, and selectivity.",
};

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

/**
 * /trends (specs/national-trends.md#where-it-appears): one card per study whose file exists, newest first, then the
 * entry sections for Movers, By conference, and By state.
 */
export default async function TrendsPage() {
  const index = await getTrendFile("index");
  const cards = (STUDIES as readonly StudyDef[])
    .map((study, order) => ({ study, order, card: index?.cards.find((c) => c.slug === study.slug) }))
    .filter((x): x is { study: StudyDef; order: number; card: TrendCard } => x.card !== undefined)
    .sort((a, b) => b.study.added.localeCompare(a.study.added) || a.order - b.order);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-8 max-w-3xl sm:mb-10">
        <p className="mb-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">National trends</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          How college is <span className="highlight">changing</span>
        </h1>
        <p className="mt-3 text-muted-foreground">
          Every other page answers a question about one college. These look at the whole landscape: what changed across
          the site&apos;s four-year colleges over the years of federal data, and where. Each study compares the same
          colleges at both ends (a <Term term="fixed-panel">fixed panel</Term>), says whether it counts{" "}
          <Term term="colleges-or-students">colleges or students</Term>, and shows where a change happened, not why.
        </p>
      </header>

      <div className="space-y-14 sm:space-y-20">
        <section aria-labelledby="studies">
          <h2 id="studies" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Studies
          </h2>
          {cards.length ? (
            <div className="mt-5 grid gap-4 max-sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
              {cards.map(({ study, card }) => (
                <StudyCard key={study.slug} study={study} card={card} />
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-3xl border border-dashed p-6 text-sm text-muted-foreground">
              The studies appear once the year-by-year history is published.
            </p>
          )}
        </section>

        {/* ── Entry sections. Each unit replaces ITS placeholder line with one import + one component, e.g.
            <MoversEntry /> from components/trends/movers/MoversEntry.tsx. Keep this order: Movers, conferences, states. ── */}
        <ComingSection id="movers" title="Biggest movers" description="Ten colleges per measure that changed the most: applications, selectivity, size, and what students pay, with the rules that keep the lists fair." />
        <ComingSection id="conferences" title="By athletic conference" description="How each conference's members compare and changed, the Power 4 side by side, and who joined or left." />
        <ComingSection id="states" title="By state" description="How each state's colleges changed: size, applications, cost, and where their students come from." />
      </div>
    </div>
  );
}
