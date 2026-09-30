import { BedDouble, Home, Utensils } from "lucide-react";
import { getData } from "@/lib/data";
import { num } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { bedsPer100 } from "@/lib/housing";
import type { School } from "@/lib/types";
import { InfoTip, SourceChip } from "@/components/ui/info-tip";

/**
 * Campus life, starting with housing (specs/data-expansion/housing-and-policies.md): beds, beds per 100 undergrads
 * (capacity can include graduate housing, so it's a rough guide), the live-on rule, and meal plans.
 */
export async function CampusLife({ school }: { school: School }) {
  const { citeField, metricMedian } = await getData();
  const h = school.campus?.housing;
  if (!h) return null;
  const cited = citeField("campus.housing", school);
  const per100 = bedsPer100(school);
  const median = metricMedian("bedsPer100");
  const color = DOMAINS.size.color;

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-5 flex items-center gap-1.5 font-display text-lg font-bold">
        Housing <InfoTip term="housing-capacity" cited={cited} />
        <SourceChip cited={cited} />
      </h3>
      {!h.offered ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Home className="size-4" /> No college housing: students live off campus.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <BedDouble className="size-4" style={{ color }} /> Beds
            </p>
            <p className="mt-1 font-display text-3xl font-extrabold">{h.capacity != null ? num(h.capacity) : "—"}</p>
            {per100 !== null && (
              <p className="text-xs text-muted-foreground">
                {per100 >= 100 ? "Room for every undergrad" : `About ${per100} for every 100 undergrads`}
                {median !== null && ` (median college: ${Math.round(median)})`}. Can include graduate housing.
              </p>
            )}
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Home className="size-4" style={{ color }} /> First-years
            </p>
            <p className="mt-1 text-sm font-semibold">
              {h.first_years_required ? "Must live on campus" : h.first_years_required === false ? "Not required to live on campus" : "Not reported"}
              <InfoTip term="live-on-requirement" className="ml-1" />
            </p>
            {h.first_years_required === false && (
              <p className="text-xs text-muted-foreground">Many colleges still expect it, with exceptions such as for local students.</p>
            )}
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Utensils className="size-4" style={{ color }} /> Meal plans
            </p>
            <p className="mt-1 text-sm font-semibold">
              {h.meal_plan === false ? "None offered" : h.meal_plan ? (h.meals_per_week ? `Up to ${h.meals_per_week} meals a week` : "Offered") : "Not reported"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
