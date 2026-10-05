import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Swords, Table2 } from "lucide-react";
import { getData, toIndexEntry } from "@/lib/data";
import { RADAR_AXES, keyDifferences, radarProfile, similarSchools } from "@/lib/insights";
import { SLOT_COLORS, crestBrand, shortName } from "@/lib/brand";
import { COMPARE_OVERVIEW_FIELDS, compareHref, compareTopicOf } from "@/lib/compare-topics";
import { compareMetadata, loadComparison } from "@/lib/compare-data";
import type { School } from "@/lib/types";
import { CompareHeader } from "@/components/compare/CompareHeader";
import { CompareTopicCards } from "@/components/compare/CompareTopicCards";
import { KeyDifferenceList } from "@/components/compare/CompareTopicPage";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { BaselineNote } from "@/components/ui/BaselineNote";
import { Crest } from "@/components/school/Crest";
import { RadarChart } from "@/components/charts/RadarChart";
import { InfoTip } from "@/components/ui/info-tip";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const MATCHUPS = [
  ["166027", "243744"],
  ["110635", "110662"],
  ["170976", "234076", "199120"],
  ["168342", "121345"],
  ["131520", "199120"],
  ["145637", "204796", "236948"],
];

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), "overview");
}

/**
 * The compare overview (specs/compare-redesign.md#overview-page): the band with the topic pills, Key differences and
 * the radar, a way into each topic page, and the table. Every other block lives on a topic page.
 */
export default async function ComparePage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await loadComparison(typeof params.ids === "string" ? params.ids : "");
  const { data, ids, schools } = comparison;

  if (schools.length === 0) return <EmptyState />;

  const diffs = keyDifferences(schools);
  const table = compareTopicOf("table");

  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-3 sm:mb-6">
        <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Compare</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          {schools.length === 1 ? (
            <>Pick a <span className="highlight">rival</span></>
          ) : (
            <>
              Head-to-<span className="highlight">head</span>
            </>
          )}
        </h1>
      </header>

      <CompareHeader schools={schools.map(toIndexEntry)} current="overview" />

      {schools.length === 1 ? (
        <SinglePrompt school={schools[0]} />
      ) : (
        <div className="space-y-10 pt-5 sm:space-y-14 sm:pt-8">
          {/* Key differences + radar */}
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <section className="rounded-3xl border bg-card p-4 sm:p-6">
              <h2 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Key differences</h2>
              <p className="mb-5 text-sm text-muted-foreground">The biggest gaps between these schools, largest first.</p>
              <KeyDifferenceList diffs={diffs.slice(0, 6)} />
            </section>
            <section className="rounded-3xl border bg-card p-4 sm:p-6">
              <h2 className="flex items-center gap-1 font-display text-xl font-extrabold tracking-tight sm:text-2xl">
                The shape of each school
              </h2>
              <p className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
                Each axis is a national rank among 4-year colleges; further out = more of it.
                <InfoTip term="percentile-rank" />
              </p>
              <RadarChart
                axes={RADAR_AXES.map((a) => a.label)}
                series={schools.map((s, i) => ({
                  id: s.unit_id,
                  label: shortName(s),
                  color: SLOT_COLORS[i],
                  values: radarProfile(data, s),
                }))}
              />
            </section>
          </div>

          <div className="space-y-4">
            <CompareTopicCards comparison={comparison} />
            <Link
              href={compareHref(ids, "table")}
              className="group flex items-center gap-4 rounded-3xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 sm:p-5"
            >
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted">
                <Table2 className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg font-bold group-hover:text-primary">{table.label}</span>
                <span className="block text-sm text-muted-foreground">{table.description}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          </div>

          <div className="space-y-2">
            <MultiSourceNote schools={schools} fields={COMPARE_OVERVIEW_FIELDS} />
            <BaselineNote />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

async function SinglePrompt({ school }: { school: School }) {
  const data = await getData();
  const similar = similarSchools(data, school, 4);
  return (
    <div className="pt-8">
      <p className="mb-4 text-muted-foreground">
        Add at least one more school to see the head-to-head. Here are a few that are a lot like {shortName(school)}:
      </p>
      <div className="grid gap-3 max-sm:rail max-sm:[--rail-item:72%] sm:grid-cols-2 lg:grid-cols-4">
        {similar.map(({ school: s, reasons }) => (
          <Link
            key={s.unit_id}
            href={`/compare?ids=${school.unit_id},${s.unit_id}`}
            className="group rounded-3xl border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10"
          >
            <Crest id={s.unit_id} name={s.name} size="md" brand={crestBrand(s)} />
            <p className="mt-3 font-display font-bold group-hover:text-primary">{s.name}</p>
            <p className="text-xs text-muted-foreground">{reasons.join(" · ")}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary">
              Compare <ArrowRight className="size-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

async function EmptyState() {
  const { getSchoolsByIds } = await getData();
  return (
    <div className="mx-auto max-w-4xl px-4 pt-16 pb-12 text-center sm:px-6">
      <span className="mx-auto inline-flex size-16 animate-pop-in items-center justify-center rounded-3xl bg-pop text-pop-foreground shadow-lg">
        <Swords className="size-8" />
      </span>
      <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
        Pick your <span className="highlight">contenders</span>
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
        Add up to four schools with the <b className="text-foreground">+ Compare</b> button on any card or profile, or
        start with a classic matchup.
      </p>
      <div className="mt-10 grid gap-3 text-left sm:grid-cols-2">
        {MATCHUPS.map((ids) => {
          const schools = getSchoolsByIds(ids);
          return (
            <Link
              key={ids.join()}
              href={`/compare?ids=${ids.join(",")}`}
              className="group flex items-center gap-3 rounded-3xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10"
            >
              <div className="flex -space-x-2">
                {schools.map((s) => (
                  <Crest key={s.unit_id} id={s.unit_id} name={s.name} brand={crestBrand(s)} size="md" className="ring-2 ring-card" />
                ))}
              </div>
              <span className="min-w-0 flex-1 font-semibold">{schools.map((s) => shortName(s)).join(" vs. ")}</span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          );
        })}
      </div>
      <Link href="/explore" className="mt-8 inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background">
        Browse all schools <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
