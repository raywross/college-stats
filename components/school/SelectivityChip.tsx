import type { School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import type { Cited } from "@/lib/lineage";
import type { SelectivityTier } from "@/lib/chances/types";
import { selectivityFacts } from "@/lib/selectivity-facts";
import { chipTiers, tierRank } from "@/lib/selectivity-tier";
import { SELECTIVITY_TIER_LABELS } from "@/lib/chances/levels";
import { shortName } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { SelectivityPanel } from "./SelectivityPanel";

/** One tier as a pill: deeper for a harder tier, the word always carrying the meaning. */
export function TierPill({ tier, pool, className }: { tier: SelectivityTier; pool?: string; className?: string }) {
  const level = 4 - (tierRank(tier) ?? 4);
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap text-foreground", className)}
      style={{
        borderColor: `color-mix(in oklch, var(--d-admissions) ${20 + level * 10}%, transparent)`,
        backgroundColor: `color-mix(in oklch, var(--d-admissions) ${4 + level * 5}%, transparent)`,
      }}
    >
      {SELECTIVITY_TIER_LABELS[tier]}
      {pool && <span className="font-medium text-muted-foreground">{pool}</span>}
    </span>
  );
}

/**
 * "Quad's selectivity: Elite ⓘ" on the profile hero and the overview's admissions card (specs/chances/selectivity-index.md
 * "Where it shows"): the stored tier, or a public's two where they differ ("Highly selective from Georgia · Elite from
 * other states"), and an ⓘ listing the figures it reads, each cited. Renders nothing for a college that isn't rated.
 * Server component: the facts are worded here and only their words and citations reach the client.
 */
export function SelectivityChip({ school, citeField, label = true, className }: { school: School; citeField: (path: FieldPath, s?: School) => Cited; label?: boolean; className?: string }) {
  const tiers = chipTiers(school);
  if (!tiers.length) return null;
  const facts = selectivityFacts(school).map(({ field, ...f }) => ({ ...f, cited: citeField(field, school) }));
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {label && <span className="text-xs font-semibold text-muted-foreground">Quad&apos;s selectivity</span>}
      {tiers.map((t, i) => (
        <span key={t.pool} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground" aria-hidden>·</span>}
          <TierPill tier={t.tier} pool={t.pool === "in_state" ? `from ${t.stateName}` : t.pool === "out_of_state" ? "from other states" : undefined} />
        </span>
      ))}
      <SelectivityPanel college={shortName(school)} facts={facts} />
    </span>
  );
}
