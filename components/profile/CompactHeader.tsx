import Link from "next/link";
import { DOMAINS } from "@/lib/metrics";
import { typeLabel } from "@/lib/format";
import { PROFILE_TOPICS, overviewHref, type TopicKey } from "@/lib/profile-topics";
import type { Profile } from "@/lib/profile-data";
import { Crest } from "@/components/school/Crest";
import { CompareButton } from "@/components/compare/CompareButton";
import { TopicPills, type TopicPill } from "./TopicPills";

/** Pills for the topic pages this college has, with their domain colors. */
export function pillsFor(profile: Profile): TopicPill[] {
  return PROFILE_TOPICS.filter((t) => profile.topics.includes(t.key)).map((t) => ({
    key: t.key,
    label: t.label,
    color: t.domain ? DOMAINS[t.domain].color : "var(--primary)",
  }));
}

/**
 * Topic pages' sticky band in place of the hero (specs/profile-redesign.md#topic-pages): crest, name linking back
 * to the overview, city · type, Compare, and the topic pills. Sits under the site header.
 */
export function CompactHeader({ profile, current }: { profile: Profile; current: TopicKey }) {
  const { school } = profile;
  return (
    <div
      data-compact-header
      className="sticky z-30 -mx-4 border-b bg-background/85 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + var(--header-h))" }}
    >
      <div className="flex h-12 items-center gap-3">
        <Link href={overviewHref(school.unit_id)} className="group flex min-w-0 flex-1 items-center gap-2.5" aria-label={`${school.name} overview`}>
          <Crest id={school.unit_id} name={school.name} size="sm" className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate font-display text-base leading-tight font-extrabold group-hover:text-primary sm:text-lg">{school.name}</span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground sm:text-xs">
              {school.location.city}, {school.location.state} · {typeLabel(school.type)}
            </span>
          </span>
        </Link>
        <CompareButton id={school.unit_id} variant="pill" />
      </div>
      <TopicPills unitId={school.unit_id} current={current} pills={pillsFor(profile)} className="flex h-11 items-center" />
    </div>
  );
}
