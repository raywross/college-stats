import Link from "next/link";
import type { School } from "@/lib/types";
import { DOMAINS, satComposite } from "@/lib/metrics";
import { compact, moneyCompact, pctSmart, range, typeShort } from "@/lib/format";
import { Crest } from "@/components/school/Crest";
import { crestBrand } from "@/lib/brand";
import { CompareButton } from "@/components/compare/CompareButton";
import { AddToListButton } from "@/components/lists/AddToListButton";
import { distanceFromHome, formatMiles, type NearHome } from "@/lib/home";
import type { PriceLine } from "@/lib/cost-at-income";

/**
 * Phone result row (Explore, below sm): one headline number and three facts in ~90px, so a screen shows
 * five or six schools instead of one card. The full SchoolCard (meters, trends, standouts) takes over from sm.
 * With Explore's distance filter set (`home`), the location line adds the straight-line miles. With a family income set
 * (`priceAt`, specs/product/cost-by-income.md), "About $41K at $200K" replaces the average cost.
 */
export function SchoolRow({ school, home = null, priceAt = null }: { school: School; home?: NearHome | null; priceAt?: PriceLine | null }) {
  const rate = school.admissions.acceptance_rate;
  const sat = satComposite(school);
  const cost = school.cost?.avg_paid_all ?? null;
  const distance = home ? distanceFromHome(school.location, home) : null;
  const facts = [
    { key: "sat", color: DOMAINS.scores.color, text: sat ? `SAT ${range(sat)}` : null },
    { key: "size", color: DOMAINS.size.color, text: `${compact(school.demographics.undergrad_enrollment)} undergrads` },
    priceAt
      ? { key: "cost", color: DOMAINS.value.color, text: `${priceAt.text}${priceAt.estimate ? " · estimate" : ""}` }
      : { key: "cost", color: DOMAINS.value.color, text: cost === null ? null : `${moneyCompact(cost)}/yr` },
  ].filter((f): f is { key: string; color: string; text: string } => f.text !== null);

  return (
    <article className="relative flex items-center gap-3 rounded-2xl border bg-card p-3 transition-colors active:bg-muted/60">
      <Link href={`/schools/${school.unit_id}`} className="absolute inset-0 z-10 rounded-2xl" aria-label={`View ${school.name}`} />
      <Crest id={school.unit_id} name={school.name} size="sm" brand={crestBrand(school)} />
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 font-display text-[15px] leading-snug font-bold">{school.name}</h3>
        <p className="truncate text-xs text-muted-foreground">
          {school.location.city}, {school.location.state} · {typeShort(school.type)}
          {distance !== null && <> · {formatMiles(distance)} away</>}
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] font-medium tabular-nums">
          {facts.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: f.color }} aria-hidden />
              {f.text}
            </span>
          ))}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <p className="text-right leading-none">
          <span className={`block font-display text-xl font-extrabold tracking-tight ${rate === null ? "text-muted-foreground" : ""}`}>
            {rate === null ? "–" : pctSmart(rate)}
          </span>
          <span className="text-[10px] text-muted-foreground">{rate === null ? "no rate" : "admitted"}</span>
        </p>
        <div className="flex items-center gap-1">
          <CompareButton id={school.unit_id} variant="icon" className="size-7" />
          <AddToListButton ids={school.unit_id} variant="icon" className="size-7" />
        </div>
      </div>
    </article>
  );
}
