import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronDown } from "lucide-react";
import { getData } from "@/lib/data";
import { loadProfile } from "@/lib/profile-data";
import { PROFILE_FIELDS } from "@/lib/profile-topics";
import { satMid } from "@/lib/metrics";
import { similarSchools } from "@/lib/insights";
import { compact, pctSmart } from "@/lib/format";
import { SourceList } from "@/components/sources/SourceNote";
import { crestBrand } from "@/lib/brand";
import { Crest } from "@/components/school/Crest";
import { CompareButton } from "@/components/compare/CompareButton";
import { Panel } from "@/components/profile/Panel";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { TopicCards } from "@/components/profile/TopicCards";
import { AnchorRedirect } from "@/components/profile/AnchorRedirect";
import { ProfileChanges } from "@/components/profile/ProfileChanges";
import { MyHighSchoolLine } from "@/components/high-schools/MyHighSchoolLine";
import { ViewBeacon } from "@/components/profile/ViewBeacon";

// No searchParams and no session read: the overview is prerendered (generateStaticParams + revalidate below) and served
// from the cache; what depends on the person (the event calendar, app/schools/[id]/events) has its own route.
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const school = (await getData()).getSchoolById(id);
  return { title: school ? school.name : "School not found" };
}

// Publishes regenerate profiles on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

/** Pre-render the most-applied-to profiles; the rest render on first visit and are cached. */
export async function generateStaticParams() {
  const { topBy } = await getData();
  return topBy("applicants", "desc", 50).map((s) => ({ id: s.unit_id }));
}

/* ------------------------------------------------------------------ */

/**
 * The profile overview (specs/profile-redesign.md#overview-page): a slim hero, one card per topic page the college
 * has, similar schools, and one collapsed source list. The detail lives on the six topic pages under this route.
 */
export default async function SchoolPage({ params }: Props) {
  const { id } = await params;
  const p = await loadProfile(id);
  if (!p) notFound();
  const { data, school } = p;
  const similar = similarSchools(data, school, 4);

  return (
    <div>
      <AnchorRedirect unitId={school.unit_id} />
      {/* ============================== HERO ============================== */}
      <ProfileHero profile={p} />
      {/* Records that this college was opened (specs/product/college-views.md). Renders nothing. */}
      <ViewBeacon unit={school.unit_id} page="overview" />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="space-y-14 pt-2 sm:space-y-16 sm:pt-4">
          {/* ============================== WHAT CHANGED (nothing without a change in the last year) ============================== */}
          <ProfileChanges school={school} data={data} />

          {/* Quiet, renders nothing unless the signed-in student's high school lists this college (specs/product/high-school-data.md). */}
          <MyHighSchoolLine unitId={school.unit_id} />

          {/* ============================== TOPIC CARDS ============================== */}
          <section id="overview" className="scroll-mt-28 sm:scroll-mt-36" aria-label="At a glance">
            <TopicCards profile={p} />
          </section>

          {/* ============================== SIMILAR ============================== */}
          <Panel id="similar" eyebrow="Keep exploring" title="Schools like this one" fields={[]}>
            <div className="grid gap-3 max-sm:rail max-sm:[--rail-item:72%] sm:grid-cols-2 lg:grid-cols-4">
              {similar.map(({ school: s, reasons }) => (
                <div key={s.unit_id} className="group relative flex flex-col rounded-3xl border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10">
                  <Link href={`/schools/${s.unit_id}`} className="absolute inset-0 z-10 rounded-3xl" aria-label={s.name} />
                  <div className="flex items-start justify-between gap-2">
                    <Crest id={s.unit_id} name={s.name} size="md" brand={crestBrand(s)} />
                    <CompareButton id={s.unit_id} variant="icon" />
                  </div>
                  <p className="mt-3 font-display font-bold group-hover:text-primary">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      s.admissions.acceptance_rate !== null && `${pctSmart(s.admissions.acceptance_rate)} admit`,
                      satMid(s) !== null && `SAT ${satMid(s)}`,
                      `${compact(s.demographics.undergrad_enrollment)} undergrads`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {reasons.map((r) => (
                      <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                        {r}
                      </span>
                    ))}
                  </div>
                  <Link href={`/compare?ids=${school.unit_id},${s.unit_id}`} className="relative z-20 mt-4 inline-flex items-center gap-1 self-start text-xs font-bold text-primary hover:underline">
                    Compare side-by-side <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>

            {/* One sources block for the overview: every number's own source is in its (i) popover. */}
            <details className="group mt-10 rounded-2xl border border-dashed bg-card/50 open:border-solid sm:mt-12">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-primary">Sources for this overview</span>
                  <span className="block text-xs text-muted-foreground">Every dataset and year behind the numbers on this profile; tap any ⓘ for one number&apos;s source</span>
                </span>
                <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="p-2 sm:p-3">
                <SourceList school={school} fields={PROFILE_FIELDS} />
              </div>
            </details>
          </Panel>
        </div>
      </div>
    </div>
  );
}
