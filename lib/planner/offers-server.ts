import "server-only";
/**
 * The college facts the offers stage reads beside each offer (specs/planner/offers.md "Computation", "Context lines"),
 * cut from the dataset and the year-by-year history on the server with every figure cited (`citeField`). History is
 * read only for admitted colleges (one small file each). Not a "use server" module: OffersStage and the dossier call it.
 *
 * The cost trend is nominal (not inflation-adjusted): what the bill does. History has tuition and full-price series by
 * residency but no housing series, so housing is the gap between the full price and tuition, year by year.
 */
import { getData, getHistory, getHistoryFiles } from "@/lib/data";
import { aidGenerosity, generosityTier } from "@/lib/metrics";
import { historySources, historyYearLabel, type SchoolHistory, type Series, type SeriesKey } from "@/lib/history";
import type { School } from "@/lib/types";
import type { StudentProfileData } from "@/lib/student-profile";
import { growthRate, type OfferFacts, type OfferTrend, type WaitListFacts } from "./offers";

/** Which price applies to this student at this college. */
export function residencyFor(school: Pick<School, "type" | "location" | "cost">, profile: StudentProfileData | null): OfferFacts["residency"] {
  const s = school.cost?.sticker;
  if (!s || s.in_state === null || s.out_of_state === null || s.in_state === s.out_of_state) return "single";
  const home = profile?.basics.stateOfResidence ?? null;
  if (home === null) return "in_state";
  return home === school.location?.state ? "in_state" : "out_of_state";
}

function points(s: Series | undefined): { year: number; value: number | null }[] {
  return s ? s.values.map((value, i) => ({ year: s.start + i, value })) : [];
}

/** The college's nominal cost trend from its history: tuition, housing (full price − tuition), and full price. */
export function trendFrom(history: SchoolHistory | null, residency: OfferFacts["residency"]): { trend: OfferTrend; keys: SeriesKey[]; range: [number, number] } | null {
  if (!history) return null;
  const out = residency === "out_of_state";
  const tKey: SeriesKey = out ? "tuition_out_of_state" : "tuition_in_state";
  const sKey: SeriesKey = out ? "sticker_out_of_state" : "sticker_in_state";
  const tuition = points(history.series[tKey]);
  const sticker = points(history.series[sKey]);
  const byYear = new Map(tuition.map((p) => [p.year, p.value]));
  const housing = sticker.map((p) => {
    const t = byYear.get(p.year);
    return { year: p.year, value: p.value !== null && t != null && p.value > t ? p.value - t : null };
  });
  const gt = growthRate(tuition);
  const gh = growthRate(housing);
  const gs = growthRate(sticker);
  const found = [gt, gh, gs].filter((g): g is NonNullable<typeof g> => g !== null);
  if (!found.length) return null;
  const from = Math.min(...found.map((g) => g.from));
  const to = Math.max(...found.map((g) => g.to));
  return {
    trend: { tuition: gt?.rate ?? null, housing: gh?.rate ?? null, fullPrice: gs?.rate ?? null, from: historyYearLabel(from, "academic"), to: historyYearLabel(to, "academic") },
    keys: [tKey, sKey],
    range: [from, to],
  };
}

/** Offer facts for each admitted college (by unit id). Colleges missing from the dataset are left out. */
export async function offerFacts(unitIds: string[], profile: StudentProfileData | null): Promise<Record<string, OfferFacts>> {
  if (!unitIds.length) return {};
  const { getSchoolById, citeField, getMeta } = await getData();
  const files = await getHistoryFiles();
  const out: Record<string, OfferFacts> = {};
  await Promise.all(
    [...new Set(unitIds)].map(async (id) => {
      const school = getSchoolById(id);
      if (!school) return;
      const residency = residencyFor(school, profile);
      const sticker = school.cost?.sticker;
      const amount = sticker ? (residency === "out_of_state" ? sticker.out_of_state : (sticker.in_state ?? sticker.out_of_state)) : null;
      const stickerCite = amount !== null ? citeField("cost.sticker", school) : null;
      const t = trendFrom(await getHistory(id), residency);
      const share = aidGenerosity(school);
      const o = school.outcomes;
      out[id] = {
        unit_id: id,
        residency,
        fullPrice: { amount: amount ?? null, year: stickerCite?.year ?? null },
        fullPriceCite: stickerCite,
        trend: t?.trend ?? null,
        trendSources: t && files ? historySources(t.keys, files.meta, getMeta(), { academic: t.range }).map((s) => ({ label: s.label, years: s.years, url: s.url })) : [],
        avgCost: school.cost?.avg_paid_all ?? null,
        avgCostCite: school.cost?.avg_paid_all != null ? citeField("cost.avg_paid_all", school) : null,
        generosity: share !== null ? { share, label: generosityTier(share).label, cite: citeField("derived.aid_generosity", school) } : null,
        earnings: o?.median_earnings_10yr ?? null,
        earningsCite: o?.median_earnings_10yr != null ? citeField("outcomes.median_earnings_10yr", school) : null,
        debt: o?.median_debt ?? null,
        debtCite: o?.median_debt != null ? citeField("outcomes.median_debt", school) : null,
        gradRate: o?.graduation_rate ?? null,
        gradRateCite: o?.graduation_rate != null ? citeField("outcomes.graduation_rate", school) : null,
      };
    }),
  );
  return out;
}

/** CDS C2 wait-list history for each waitlisted college, cited; colleges that publish none are left out. */
export async function waitListFacts(unitIds: string[]): Promise<Record<string, WaitListFacts>> {
  if (!unitIds.length) return {};
  const { getSchoolById, citeField } = await getData();
  const out: Record<string, WaitListFacts> = {};
  for (const id of new Set(unitIds)) {
    const school = getSchoolById(id);
    const w = school?.reported?.admission_profile?.wait_list;
    if (!school || !w || (w.offered === null && w.accepted === null && w.admitted === null)) continue;
    out[id] = {
      unit_id: id,
      offered: w.offered,
      accepted: w.accepted,
      admitted: w.admitted,
      cites: {
        offered: w.offered !== null ? citeField("reported.admission_profile.wait_list.offered", school) : undefined,
        accepted: w.accepted !== null ? citeField("reported.admission_profile.wait_list.accepted", school) : undefined,
        admitted: w.admitted !== null ? citeField("reported.admission_profile.wait_list.admitted", school) : undefined,
      },
    };
  }
  return out;
}
