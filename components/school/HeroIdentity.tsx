import type { School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import { getData } from "@/lib/data";
import { SOCIAL_LABELS, SOCIAL_NETWORKS } from "@/lib/social";
import { OfficialLinks, officialLinkPills } from "@/components/school/OfficialLinks";
import { SocialLinks } from "@/components/school/SocialIcons";
import { SourcesTip, type SourceGroup } from "@/components/ui/info-tip";

/**
 * The profile hero's official links and social accounts, under the "Known for" chips (specs/school-identity/links.md,
 * social-accounts.md), with one (i) at the end that names every source behind them. The links pill row needs the full
 * scrolling width on phones (like the chips above it), so it forces a line break there and the icons and the (i) drop
 * to their own line; from `sm:` up they share the row. Hidden entirely when the college has neither.
 */
export async function HeroIdentity({ school }: { school: School }) {
  const shown: { label: string; field: FieldPath }[] = [
    ...officialLinkPills(school).map((p) => ({ label: p.label, field: p.field })),
    ...SOCIAL_NETWORKS.filter((n) => school.social?.[n]).map((n) => ({ label: SOCIAL_LABELS[n], field: `social.${n}` as FieldPath })),
  ];
  if (!shown.length) return null;

  // Each source once, with the links and accounts it covers. A quote belongs to one item, so a shared source drops it.
  const { citeField } = await getData();
  const groups = new Map<string, SourceGroup>();
  for (const { label, field } of shown) {
    const cited = citeField(field, school);
    const id = `${cited.key}|${cited.url}|${cited.year ?? ""}`;
    const group = groups.get(id);
    if (group) {
      group.items.push(label);
      delete group.cited.quote;
    } else groups.set(id, { items: [label], cited });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-5">
      <OfficialLinks school={school} />
      <span className="inline-flex items-center gap-2">
        <SocialLinks school={school} />
        <SourcesTip title="Where these links come from" groups={[...groups.values()]} />
      </span>
    </div>
  );
}
