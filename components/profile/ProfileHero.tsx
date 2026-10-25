import Link from "next/link";
import type { CSSProperties } from "react";
import { ChevronRight, MapPin } from "lucide-react";
import type { Profile } from "@/lib/profile-data";
import { TEST_POLICY_LABELS, sizeBucket } from "@/lib/metrics";
import { standouts } from "@/lib/insights";
import { typeLabel } from "@/lib/format";
import { brandTint, crestBrand } from "@/lib/brand";
import { DESIGNATION_LABELS, DESIGNATION_TERMS, SETTING_SHORT, designationsOf } from "@/lib/campus-profile";
import { Crest } from "@/components/school/Crest";
import { StandoutChip } from "@/components/school/StandoutChip";
import { CompareButton } from "@/components/compare/CompareButton";
import { AddToListButton } from "@/components/lists/AddToListButton";
import { Term } from "@/components/ui/info-tip";
import { HeroIdentity } from "@/components/school/HeroIdentity";
import { StandingChip } from "@/components/chances/StandingChip";
import { SelectivityChip } from "@/components/school/SelectivityChip";
import { EventCalendarButton } from "@/components/visits/EventCalendarButton";

/**
 * The college hero (specs/profile-redesign.md#overview-page): crest, name, the place and type chips, Compare and Add
 * to list, the standouts, and the identity row with the Event calendar button. Shared by the overview
 * (app/schools/[id]/page.tsx, prerendered) and the event calendar (app/schools/[id]/events/page.tsx, rendered per
 * person), so the calendar keeps the college's header without the overview reading the request. No request reads here.
 */
export function ProfileHero({ profile, eventsActive = false }: { profile: Profile; eventsActive?: boolean }) {
  const { data, school } = profile;
  const { admissions: a, demographics: d } = school;
  const size = sizeBucket(d.undergrad_enrollment);
  const tags = standouts(data, school, { trends: true });
  const designations = designationsOf(school);
  const policy = a.test_policy ? TEST_POLICY_LABELS[a.test_policy] : null;
  const tint = brandTint(school, 0.35);

  return (
    <section className="relative isolate overflow-hidden">
      {/* The college's own tint per theme when it has colors (specs/school-identity/brand.md), else the hashed hue. */}
      <div
        className="absolute inset-0 -z-10 [--tint:var(--tint-light)] dark:[--tint:var(--tint-dark)]"
        style={{ "--tint-light": tint.light, "--tint-dark": tint.dark, background: "radial-gradient(ellipse 80% 90% at 15% 0%, var(--tint), transparent 70%)" } as CSSProperties}
      />
      {school.brand?.accent && <div aria-hidden className="absolute inset-x-0 bottom-0 hidden h-[3px] sm:block" style={{ backgroundColor: school.brand.accent }} />}
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
          <Crest id={school.unit_id} name={school.name} size="xl" brand={crestBrand(school)} className="size-14 animate-pop-in rounded-2xl text-lg shadow-xl sm:size-24 sm:rounded-3xl sm:text-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="animate-rise font-display text-[1.75rem] leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{school.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground sm:mt-3 sm:gap-x-4 sm:gap-y-2 sm:text-sm">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5 sm:size-4" /> {school.location.city}, {school.location.state}
                <span className="hidden sm:inline"> · {school.location.region}</span>
              </span>
              <Term term={school.type}>{typeLabel(school.type)}</Term>
              <Term term="size-tier">{size.label} campus</Term>
              {policy && (
                // The newest policy (a coming cycle's from the college's CDS when newer); the ⓘ names the cycle and the replaced value.
                <Term term="test-policy" cited={data.citeField("admissions.test_policy", school)}>
                  {policy}
                </Term>
              )}
              <SelectivityChip school={school} citeField={data.citeField} />
              <StandingChip unitId={school.unit_id} />
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
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:self-end">
            <CompareButton id={school.unit_id} variant="large" className="flex-1 sm:flex-initial" />
            <AddToListButton ids={school.unit_id} variant="large" className="flex-1 sm:flex-initial" />
          </div>
        </div>

        {tags.length > 0 && (
          <div className="no-scrollbar mt-5 flex items-center gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:mt-6 sm:flex-wrap [&>*]:shrink-0">
            <span className="text-xs font-semibold text-muted-foreground">Known for</span>
            {tags.map((t) => (
              <StandoutChip key={t.label} standout={t} size="md" />
            ))}
          </div>
        )}

        {/* Official links and social accounts (specs/school-identity/links.md, social-accounts.md). */}
        <HeroIdentity school={school} trailing={<EventCalendarButton unitId={school.unit_id} active={eventsActive} />} />
      </div>
    </section>
  );
}
