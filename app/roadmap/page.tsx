import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Map as MapIcon } from "lucide-react";
import { ComplexityMeter } from "@/components/roadmap/ComplexityMeter";
import { getRoadmapDoc } from "@/lib/roadmap-docs";
import {
  COMPLEXITY,
  ROADMAP,
  ROADMAP_GROUPS,
  ROADMAP_OVERVIEWS,
  STATUS_LABELS,
  roadmapSpec,
  type Complexity,
  type RoadmapGroupKey,
} from "@/lib/roadmap";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "What's coming to Quad: the planned features, how complex each one is, and the full spec for each.",
};

const LEVELS: Complexity[] = [1, 2, 3, 4];

/** Groups whose section links to a readable overview page (one of ROADMAP_OVERVIEWS). */
const GROUP_OVERVIEWS: Partial<Record<RoadmapGroupKey, string>> = { "college-reported": "data-expansion", chances: "chances", ideas: "ideas" };

export default function RoadmapPage() {
  const planned = ROADMAP.filter((s) => s.status !== "idea");
  const ideas = ROADMAP.length - planned.length;
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-primary uppercase">Roadmap</p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            What&apos;s <span className="highlight">coming</span> next
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Every planned feature starts as a written spec: the question it answers, where the data comes from, how
            it will appear on the site, and what&apos;s still open. Plans change as the research does, so treat these
            as working documents, not promises. The Ideas section holds directions that aren&apos;t planned yet.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-start rounded-3xl border bg-card px-5 py-4 sm:self-auto">
          <MapIcon className="size-6 text-primary" />
          <div>
            <p className="font-display text-3xl leading-none font-extrabold">{planned.length}</p>
            <p className="text-xs text-muted-foreground">specs planned{ideas > 0 && ` · ${ideas} ideas`}</p>
          </div>
        </div>
      </header>

      <section aria-labelledby="complexity-heading" className="mb-12 rounded-3xl border bg-surface-2 p-5 sm:p-6">
        <h2 id="complexity-heading" className="text-sm font-bold">
          How complexity is rated
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((level) => (
            <div key={level}>
              <dt className="flex items-center justify-between gap-2">
                <ComplexityMeter value={level} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ROADMAP.filter((s) => s.complexity === level).length} specs
                </span>
              </dt>
              <dd className="mt-1.5 text-sm text-muted-foreground">{COMPLEXITY[level].description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="space-y-14">
        {ROADMAP_GROUPS.map((group) => {
          const specs = ROADMAP.filter((s) => s.group === group.key);
          const overview = ROADMAP_OVERVIEWS.find((o) => o.slug === GROUP_OVERVIEWS[group.key]);
          return (
            <section key={group.key} aria-labelledby={`group-${group.key}`}>
              <div className="mb-4">
                <h2 id={`group-${group.key}`} className="font-display text-2xl font-bold tracking-tight">
                  {group.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
                {overview && (
                  <Link
                    href={`/roadmap/${overview.slug}`}
                    className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                  >
                    Read the {overview.title.toLowerCase()} <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
              <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
                {specs.map((spec) => {
                  const doc = getRoadmapDoc(spec.slug);
                  const after = (spec.after ?? []).map((slug) => roadmapSpec(slug)).filter((s) => s != null);
                  return (
                    <li key={spec.slug}>
                      <Link
                        href={`/roadmap/${spec.slug}`}
                        className="group grid gap-3 p-5 transition-colors hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_9rem_1.25rem] sm:items-center sm:gap-6"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-semibold group-hover:text-primary">{doc?.title ?? spec.slug}</span>
                            {spec.status !== "planned" && (
                              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                                {STATUS_LABELS[spec.status]}
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">{spec.summary}</p>
                          {(doc?.source || after.length > 0) && (
                            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              {doc?.source && <span>Source: {doc.source}</span>}
                              {after.length > 0 && <span>After: {after.map((s) => getRoadmapDoc(s.slug)?.title).join(", ")}</span>}
                            </p>
                          )}
                        </div>
                        <ComplexityMeter value={spec.complexity} />
                        <ArrowRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary sm:block" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
