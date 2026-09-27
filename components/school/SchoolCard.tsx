import Link from "next/link";
import type { School } from "@/lib/types";
import { rankOf } from "@/lib/data";
import { standouts } from "@/lib/insights";
import { DOMAINS, admitRatio, satComposite, selectivityTier } from "@/lib/metrics";
import { compact, moneyCompact, pct, pctSmart, range, typeShort } from "@/lib/format";
import { crestTint } from "@/lib/brand";
import { Crest } from "@/components/school/Crest";
import { CompareButton } from "@/components/compare/CompareButton";
import { StandoutChip } from "@/components/school/StandoutChip";

/** Nomad List-style meter: fill = where this school ranks among all colleges. */
function Meter({ label, value, rank, color }: { label: string; value: string | null; rank: number | null; color: string }) {
  return (
    <div className="grid grid-cols-[5.25rem_1fr_auto] items-center gap-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }}>
        {rank !== null && (
          <span
            className="block h-full origin-left animate-grow-x rounded-full"
            style={{ width: `${Math.max(6, rank * 100)}%`, backgroundColor: color }}
          />
        )}
      </span>
      <span className={`w-[4.75rem] text-right whitespace-nowrap tabular-nums ${value === null ? "text-muted-foreground" : "font-semibold"}`}>
        {value ?? "–"}
      </span>
    </div>
  );
}

export function SchoolCard({ school, index = 0 }: { school: School; index?: number }) {
  const rate = school.admissions.acceptance_rate;
  const tier = selectivityTier(rate);
  const tags = standouts(school).slice(0, 2);
  const sat = satComposite(school);
  const acceptanceRank = rankOf(school, "acceptance");
  const n = admitRatio(school);

  return (
    <article
      className="group relative flex animate-rise flex-col overflow-hidden rounded-3xl border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10"
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
    >
      {/* Crest-tinted glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: crestTint(school.unit_id, 0.35) }}
      />
      <Link href={`/schools/${school.unit_id}`} className="absolute inset-0 z-10 rounded-3xl" aria-label={`View ${school.name}`} />

      <div className="relative flex items-start gap-3">
        <Crest id={school.unit_id} name={school.name} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base leading-snug font-bold group-hover:text-primary">{school.name}</h3>
          <p className="text-xs text-muted-foreground">
            {school.location.city}, {school.location.state} · {typeShort(school.type)}
          </p>
        </div>
        <CompareButton id={school.unit_id} variant="icon" />
      </div>

      <div className="relative mt-5 flex items-end justify-between gap-3">
        {rate !== null ? (
          <div>
            <p className="font-display text-4xl leading-none font-extrabold tracking-tight">{pctSmart(rate)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              admitted{n !== null && (
                <>
                  {" "}· about <span className="font-semibold text-foreground">{n}</span>
                </>
              )}
            </p>
          </div>
        ) : (
          <div>
            <p className="font-display text-2xl leading-none font-extrabold tracking-tight text-muted-foreground">No rate</p>
            <p className="mt-1 text-xs text-muted-foreground">open admission or not reported</p>
          </div>
        )}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ backgroundColor: `color-mix(in oklch, var(--d-admissions) ${6 + tier.level * 5}%, transparent)` }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: "var(--d-admissions)" }} />
          {tier.label}
        </span>
      </div>

      {/* Meter order keeps same-looking hues apart (validated color-blind safe). */}
      <div className="relative mt-5 space-y-2">
        <Meter
          label="Selectivity"
          value={rate === null ? null : pctSmart(rate)}
          rank={acceptanceRank === null ? null : 1 - acceptanceRank}
          color={DOMAINS.admissions.color}
        />
        <Meter
          label="Size"
          value={compact(school.demographics.undergrad_enrollment)}
          rank={rankOf(school, "enrollment")}
          color={DOMAINS.size.color}
        />
        <Meter label="SAT range" value={sat ? range(sat) : null} rank={rankOf(school, "sat")} color={DOMAINS.scores.color} />
        <Meter
          label="Pell share"
          value={school.demographics.pell_grant_percent === null ? null : pct(school.demographics.pell_grant_percent)}
          rank={rankOf(school, "pell")}
          color={DOMAINS.access.color}
        />
        <Meter
          label="Net price"
          value={school.cost?.avg_net_price == null ? null : moneyCompact(school.cost.avg_net_price)}
          rank={rankOf(school, "netPrice")}
          color={DOMAINS.value.color}
        />
      </div>

      {tags.length > 0 && (
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <StandoutChip key={t.label} standout={t} />
          ))}
        </div>
      )}
    </article>
  );
}
