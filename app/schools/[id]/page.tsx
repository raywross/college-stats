import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { getData } from "@/lib/data";
import { loadProfile } from "@/lib/profile-data";
import { OVERVIEW_FIELDS, PROFILE_FIELDS } from "@/lib/profile-topics";
import { TEST_POLICY_LABELS, satMid, sizeBucket } from "@/lib/metrics";
import { similarSchools, standouts } from "@/lib/insights";
import { compact, pctSmart, typeLabel } from "@/lib/format";
import { SourceList } from "@/components/sources/SourceNote";
import { crestTint } from "@/lib/brand";
import { Crest } from "@/components/school/Crest";
import { StandoutChip } from "@/components/school/StandoutChip";
import { CompareButton } from "@/components/compare/CompareButton";
import { DESIGNATION_LABELS, DESIGNATION_TERMS, SETTING_SHORT, designationsOf } from "@/lib/campus-profile";
import { Term } from "@/components/ui/info-tip";
import { Panel } from "@/components/profile/Panel";
import { SourceExceptions } from "@/components/profile/SourceExceptions";
import { TopicCards } from "@/components/profile/TopicCards";
import { AnchorRedirect } from "@/components/profile/AnchorRedirect";

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
  const { admissions: a, demographics: d } = school;
  const size = sizeBucket(d.undergrad_enrollment);
  const tags = standouts(data, school, { trends: true });
  const similar = similarSchools(data, school, 4);
  const designations = designationsOf(school);
  const policy = a.test_policy ? TEST_POLICY_LABELS[a.test_policy] : null;

  return (
    <div>
      <AnchorRedirect unitId={school.unit_id} />
      {/* ============================== HERO ============================== */}
      <section className="relative isolate overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: `radial-gradient(ellipse 80% 90% at 15% 0%, ${crestTint(school.unit_id, 0.35)}, transparent 70%)` }}
        />
        <div className="absolute inset-0 -z-10 bg-dots opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="mx-auto max-w-6xl px-4 pt-5 pb-6 sm:px-6 sm:pt-8 sm:pb-10">
          <nav aria-label="Breadcrumb" className="mb-6 hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
            <Link href="/explore" className="hover:text-foreground">
              Explore
            </Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <Link href={`/explore?states=${school.location.state}`} className="hover:text-foreground">
              {school.location.state}
            </Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">{school.name}</span>
          </nav>

          {/* Phones: crest beside the name, then facts, then a full-width Compare. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-4 sm:flex-nowrap sm:items-end sm:gap-6">
            <Crest id={school.unit_id} name={school.name} size="xl" className="size-14 animate-pop-in rounded-2xl text-lg shadow-xl sm:size-24 sm:rounded-3xl sm:text-2xl" />
            <div className="min-w-0 flex-1">
              <h1 className="animate-rise font-display text-[1.75rem] leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{school.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground sm:mt-3 sm:gap-x-4 sm:gap-y-2 sm:text-sm">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5 sm:size-4" /> {school.location.city}, {school.location.state}
                  <span className="hidden sm:inline"> · {school.location.region}</span>
                </span>
                <Term term={school.type}>{typeLabel(school.type)}</Term>
                <Term term="size-tier">{size.label} campus</Term>
                {policy && <Term term="test-policy">{policy}</Term>}
                {school.campus?.setting && <Term term="locale">{SETTING_SHORT[school.campus.setting.locale]}</Term>}
                {school.campus?.carnegie?.research && (
                  <Term term="r1">{school.campus.carnegie.research === "RCU" ? "Research college" : school.campus.carnegie.research}</Term>
                )}
                {designations.map((d) => (
                  <Term key={d} term={DESIGNATION_TERMS[d]}>
                    {DESIGNATION_LABELS[d]}
                  </Term>
                ))}
              </div>
            </div>
            <CompareButton id={school.unit_id} variant="large" className="w-full sm:w-auto sm:self-end" />
          </div>

          {tags.length > 0 && (
            <div className="no-scrollbar mt-5 flex items-center gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:mt-6 sm:flex-wrap [&>*]:shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">Known for</span>
              {tags.map((t) => (
                <StandoutChip key={t.label} standout={t} size="md" />
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="space-y-14 pt-2 sm:space-y-16 sm:pt-4">
          {/* ============================== TOPIC CARDS ============================== */}
          <section id="overview" className="scroll-mt-28 sm:scroll-mt-36" aria-label="At a glance">
            <SourceExceptions fields={OVERVIEW_FIELDS} school={school} />
            <TopicCards profile={p} />
          </section>

          {/* ============================== SIMILAR ============================== */}
          <Panel id="similar" eyebrow="Keep exploring" title="Schools like this one" fields={[]}>
            <div className="grid gap-3 max-sm:rail max-sm:[--rail-item:72%] sm:grid-cols-2 lg:grid-cols-4">
              {similar.map(({ school: s, reasons }) => (
                <div key={s.unit_id} className="group relative flex flex-col rounded-3xl border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10">
                  <Link href={`/schools/${s.unit_id}`} className="absolute inset-0 z-10 rounded-3xl" aria-label={s.name} />
                  <div className="flex items-start justify-between gap-2">
                    <Crest id={s.unit_id} name={s.name} size="md" />
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
