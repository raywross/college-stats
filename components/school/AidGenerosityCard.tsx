import type { School } from "@/lib/types";
import { distribution, rankOf } from "@/lib/data";
import { generosityTakeaway } from "@/lib/insights";
import { DOMAINS, aidGenerosity, generosityTier } from "@/lib/metrics";
import { money, pct } from "@/lib/format";
import { Ring } from "@/components/charts/Ring";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { InfoTip } from "@/components/ui/info-tip";

const COLOR = DOMAINS.value.color;

/**
 * Aid generosity: how much of the full price grants cover, averaged over
 * every first-year. The concept that explains why sticker prices mislead.
 */
export function AidGenerosityCard({ school }: { school: School }) {
  const g = aidGenerosity(school);
  const b = school.cost?.breakdown;
  if (g === null || !b) return null;
  const tier = generosityTier(g);

  return (
    <div className="grid gap-6 rounded-3xl border bg-card p-5 sm:p-6 lg:grid-cols-[auto_1fr_1.1fr] lg:items-center lg:gap-8">
      <Ring value={g} color={COLOR} size={120} stroke={13} label={`Grants cover ${pct(g)} of the full price`}>
        <span className="font-display text-3xl font-extrabold">{pct(g)}</span>
        <span className="text-[10px] font-semibold text-muted-foreground">of full price</span>
      </Ring>
      <div className="space-y-2">
        <h3 className="flex items-center gap-1 font-display text-xl font-bold">
          Aid generosity <InfoTip term="aid-generosity" />
        </h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
          style={{ backgroundColor: `color-mix(in oklch, ${COLOR} ${6 + tier.level * 6}%, transparent)` }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: COLOR }} />
          {tier.label}
        </span>
        <p className="text-sm text-muted-foreground">{generosityTakeaway(school)}</p>
        <p className="text-[11px] text-muted-foreground">
          {money(b.grant_per_student)} in grants per first-year ÷ {money(b.full_price)} full price.
        </p>
      </div>
      <DistributionStrip
        label="Compared to every college"
        term="aid-generosity"
        dist={distribution("aidGenerosity")}
        value={g}
        rank={rankOf(school, "aidGenerosity")}
        rankPhrase="more generous than"
        format="pct"
        color={COLOR}
        lowLabel="Limited"
        highLabel="Very generous"
      />
    </div>
  );
}
