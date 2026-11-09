import "server-only";
/**
 * The college facts the offers stage reads beside each offer (specs/planner/offers.md "Computation", "Context lines"),
 * cut from the dataset and the year-by-year history on the server with every figure cited (`citeField`, shipped as a
 * reference the ⓘ fetches on open: `citeRefWhereSame`, lib/planner/plan-cites.ts; round 4). History is
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
import { cfpView, fourYears, growthRate, isEnteredOffer, offerFlags, type CfpView, type FourYears, type OfferDraft, type OfferFacts, type OfferFlag, type OfferTrend, type WaitListFacts } from "./offers";
import type { PlanContext, PlanItem, PlanOffer, PlanSchool } from "./types";
import { citeRefWhereSame } from "./plan-cites";
import type { AnyCited } from "@/lib/lineage";
import type { SupabaseClient } from "@supabase/supabase-js";

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
      const ref = (c: AnyCited) => citeRefWhereSame(c, id);
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
        fullPriceCite: stickerCite && ref(stickerCite),
        trend: t?.trend ?? null,
        trendSources: t && files ? historySources(t.keys, files.meta, getMeta(), { academic: t.range }).map((s) => ({ label: s.label, years: s.years, url: s.url })) : [],
        avgCost: school.cost?.avg_paid_all ?? null,
        avgCostCite: school.cost?.avg_paid_all != null ? ref(citeField("cost.avg_paid_all", school)) : null,
        generosity: share !== null ? { share, label: generosityTier(share).label, cite: ref(citeField("derived.aid_generosity", school)) } : null,
        earnings: o?.median_earnings_10yr ?? null,
        earningsCite: o?.median_earnings_10yr != null ? ref(citeField("outcomes.median_earnings_10yr", school)) : null,
        debt: o?.median_debt ?? null,
        debtCite: o?.median_debt != null ? ref(citeField("outcomes.median_debt", school)) : null,
        gradRate: o?.graduation_rate ?? null,
        gradRateCite: o?.graduation_rate != null ? ref(citeField("outcomes.graduation_rate", school)) : null,
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
    const ref = (c: AnyCited) => citeRefWhereSame(c, id);
    const w = school?.reported?.admission_profile?.wait_list;
    if (!school || !w || (w.offered === null && w.accepted === null && w.admitted === null)) continue;
    out[id] = {
      unit_id: id,
      offered: w.offered,
      accepted: w.accepted,
      admitted: w.admitted,
      cites: {
        offered: w.offered !== null ? ref(citeField("reported.admission_profile.wait_list.offered", school)) : undefined,
        accepted: w.accepted !== null ? ref(citeField("reported.admission_profile.wait_list.accepted", school)) : undefined,
        admitted: w.admitted !== null ? ref(citeField("reported.admission_profile.wait_list.admitted", school)) : undefined,
      },
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The stage's reads                                                   */
/* ------------------------------------------------------------------ */

/** A shared award letter's row (plan_letters), as the stage lists it; `mine` is the viewer's, decided by the stage. */
export interface OfferLetterRow {
  id: string;
  item_id: string;
  kind: "admission" | "aid" | "other";
  uploaded_by: string;
  created_at: string;
}

/**
 * Everything the Offers stage reads besides the plan (components/planner/stages/OffersStage.tsx): the admitted
 * colleges' cost facts and history, the wait-listed colleges' C2 history, the shared letters, and the outcome-share
 * flag. Serializable; the plan loader reads it in its first wave when the plan has a decision (round 5,
 * lib/planner/load.ts), so the tab switches in place.
 */
export interface OffersRead {
  facts: Record<string, OfferFacts>;
  waits: Record<string, WaitListFacts>;
  letters: OfferLetterRow[];
  /** False until the outcome-share migration is applied: the opt-in is hidden rather than broken. */
  consentReady: boolean;
  consented: boolean;
}

type Db = Pick<SupabaseClient, "from">;

/**
 * The Offers stage's reads, side by side: the cost facts and history (snapshot shards, no database), the wait lists'
 * history, `plan_letters` by the plan's item ids, and the list's `outcome_share_consented_at`, the last two with the
 * viewer's session (row-level security decides). A failed letters read lists none and a failed flag read hides the
 * opt-in, as the stage always did; a history read fails soft inside getHistory.
 */
export async function readOffers(supabase: Db, plan: { list: { id: string }; items: readonly Pick<PlanItem, "id" | "unit_id" | "outcome" | "withdrawn_on">[] }, profile: StudentProfileData | null): Promise<OffersRead> {
  const admitted = plan.items.filter((i) => i.outcome === "admitted").map((i) => i.unit_id);
  const waitlisted = plan.items.filter((i) => i.outcome === "waitlisted" && !i.withdrawn_on).map((i) => i.unit_id);
  const ids = plan.items.map((i) => i.id);
  const [facts, waits, letterRows, consentRow] = await Promise.all([
    offerFacts(admitted, profile),
    waitListFacts(waitlisted),
    ids.length ? supabase.from("plan_letters").select("id, item_id, kind, uploaded_by, created_at").in("item_id", ids).order("created_at") : Promise.resolve({ data: [], error: null }),
    supabase.from("lists").select("outcome_share_consented_at").eq("id", plan.list.id).maybeSingle(),
  ]);
  return {
    facts,
    waits,
    letters: (letterRows.data ?? []) as OfferLetterRow[],
    consentReady: !consentRow.error,
    consented: Boolean((consentRow.data as { outcome_share_consented_at: string | null } | null)?.outcome_share_consented_at),
  };
}

/* ------------------------------------------------------------------ */
/* The stage's and the dossier's columns                               */
/* ------------------------------------------------------------------ */

/** Everything the offers table and the dossier show for one admitted college. */
export interface OfferColumnData {
  item: PlanItem;
  school: PlanSchool;
  offer: PlanOffer | null;
  notes: { pros: string | null; cons: string | null };
  draft: OfferDraft | null;
  view: CfpView | null;
  four: FourYears | null;
  flags: OfferFlag[];
  facts: OfferFacts | null;
  visitRating: number | null;
}

/**
 * One column per admitted college (list order): its entered offer mapped onto the CFP layout with four years and
 * flags, or none yet; its pros and cons (on a notes-only row when there's no offer); its facts; the best visit rating.
 */
export function offerColumns(ctx: Pick<PlanContext, "items" | "schools" | "offers" | "visits">, facts: Record<string, OfferFacts>): OfferColumnData[] {
  const out: OfferColumnData[] = [];
  for (const item of ctx.items) {
    if (item.outcome !== "admitted") continue;
    const school = ctx.schools[item.unit_id];
    if (!school) continue;
    const rows = ctx.offers.filter((o) => o.item_id === item.id);
    const offer = rows.find(isEnteredOffer) ?? null;
    const notesRow = offer ?? rows[0] ?? null;
    const f = facts[item.unit_id] ?? null;
    const view = offer ? cfpView(offer, f?.fullPrice ?? null) : null;
    const ratings = ctx.visits.filter((v) => v.item_id === item.id && v.rating !== null).map((v) => v.rating!);
    out.push({
      item,
      school,
      offer,
      notes: { pros: notesRow?.pros ?? null, cons: notesRow?.cons ?? null },
      draft: offer ? { award_year: offer.award_year, letter_date: offer.letter_date, coa: offer.coa, gift: offer.gift, work_study: offer.work_study, loans: offer.loans } : null,
      view,
      four: offer && view ? fourYears(offer, view, f?.trend ?? null) : null,
      flags: offer && view ? offerFlags(offer, view, school.name) : [],
      facts: f,
      visitRating: ratings.length ? Math.max(...ratings) : null,
    });
  }
  return out;
}
