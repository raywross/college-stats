import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LineChart } from "lucide-react";
import { getHistoryFiles } from "@/lib/data";
import { historyYearLabel } from "@/lib/history";
import { GROUP_FLOOR } from "@/lib/trend-groups";
import type { StudyDef } from "@/lib/trend-studies";
import type { StudyFile } from "@/lib/trends";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { Term } from "@/components/ui/info-tip";

function Section({ id, title, children, intro }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {intro && <p className="mt-2 max-w-3xl text-muted-foreground">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * The layout every national trend study uses (specs/national-trends.md#what-a-study-is): the question, the headline
 * figures, the national chart, small charts per group, the takeaway, the method note (panel, years, floors, colleges
 * or students, today's classification, the universe), links, and the history sources with their years. Each study's
 * page (app/trends/{slug}/page.tsx) fills the slots from its trend file; with no file (not built or not published
 * yet) the page says so instead.
 */
export async function StudyPage({
  study,
  file,
  headline,
  national,
  nationalIntro,
  breakdowns,
  breakdownsIntro,
  takeaway,
  method,
  links = [],
  children,
}: {
  study: StudyDef;
  /** The study's trend file, or null when it isn't available. */
  file: StudyFile<unknown> | null;
  /** One to three TrendStat tiles. */
  headline: ReactNode;
  /** The national chart(s). */
  national: ReactNode;
  nationalIntro?: ReactNode;
  /** SmallMultiples. */
  breakdowns: ReactNode;
  breakdownsIntro?: ReactNode;
  /** Two or three hand-written sentences, numbers from the file. */
  takeaway: ReactNode;
  /** Study-specific method lines (each a <li>'s content), after the standard ones. */
  method?: ReactNode[];
  links?: { href: string; label: string }[];
  /** Extra sections between the breakdowns and the takeaway. */
  children?: ReactNode;
}) {
  const files = await getHistoryFiles();
  const year = (y: number) => (file ? historyYearLabel(y, file.yearKind).toLowerCase() : "");
  const allLinks = [...(study.explore ? [study.explore] : []), ...links, { href: "/trends", label: "All national trends" }];

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <Link href="/trends" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> National trends
      </Link>
      <header className="mt-4 mb-8 max-w-3xl sm:mb-10">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">
          <LineChart className="size-4" /> Study {study.number}
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{study.title}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{study.question}</p>
      </header>

      {!file || !files ? (
        <div className="rounded-3xl border border-dashed p-6 text-muted-foreground sm:p-8">
          <p className="font-semibold text-foreground">This study isn&apos;t available yet.</p>
          <p className="mt-1 text-sm">It&apos;s computed from the site&apos;s year-by-year history, and appears once that data is published.</p>
          <Link href="/trends" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
            All national trends <ArrowRight className="size-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-14 sm:space-y-20">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{headline}</div>

          <Section id="national" title="The national picture" intro={nationalIntro}>
            {national}
          </Section>

          <Section id="breakdowns" title="Where it changed" intro={breakdownsIntro}>
            {breakdowns}
          </Section>

          {children}

          <Section id="takeaway" title="What it means">
            <div className="max-w-3xl space-y-3 rounded-3xl border bg-surface-2 p-5 text-base leading-relaxed sm:p-6 sm:text-lg">{takeaway}</div>
          </Section>

          <Section id="method" title="How this was measured">
            <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm text-muted-foreground marker:text-border">
              <li>
                <b className="text-foreground">Which colleges.</b> {study.panelRule}: {file.n.toLocaleString("en-US")} colleges in {year(file.from)} and{" "}
                {year(file.to)}. It&apos;s a <Term term="fixed-panel">fixed panel</Term>, so colleges entering or leaving the data don&apos;t look like change.
              </li>
              <li>
                <b className="text-foreground">Groups.</b> Colleges are grouped by <Term term="todays-classification">today&apos;s classification</Term>. A group
                needs {GROUP_FLOOR} or more colleges in the panel; smaller ones show <Term term="too-few-colleges">too few colleges to say</Term>.
              </li>
              {(method ?? []).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
              <li>
                <b className="text-foreground">The universe.</b> The site&apos;s four-year colleges, not all of U.S. higher education. Breakdowns show where a
                change happened, not why.
              </li>
            </ul>
          </Section>

          <nav aria-label="Related" className="flex flex-wrap gap-2">
            {allLinks.map((l) => (
              <Link key={l.href} href={l.href} className="group inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary">
                {l.label} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </nav>

          <HistorySourceNote keys={study.series} files={files} range={[file.lineFrom, file.to]} />
        </div>
      )}
    </div>
  );
}
