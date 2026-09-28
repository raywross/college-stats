/**
 * Admissions, aid and price calculations from one year of IPEDS rows, shared by `npm run sync-data` (today's snapshot) and
 * `npm run sync-history` (every past year), so a trend line always ends on the number the profile shows
 * (specs/trends-data.md, rule 1). Pure: plain objects in, plain objects out; no I/O.
 */
import type { ResidencyPrices, School, SchoolType } from "./types";

/** One institution's row from an IPEDS CSV, keyed by upper-case column name. */
export type IpedsRow = Record<string, string>;

const round = (v: number, places = 4) => Math.round(v * 10 ** places) / 10 ** places;

/** A number from an IPEDS cell; blank and "." (not applicable) are null. */
export function ipedsNum(row: IpedsRow | undefined, key: string): number | null {
  const v = row?.[key];
  if (!v || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** College Scorecard's race/ethnicity fields (under `student.demographics.race_ethnicity`). */
export const SCORECARD_RACE_FIELDS = ["white", "black", "hispanic", "asian", "aian", "nhpi", "two_or_more", "non_resident_alien", "unknown"] as const;

/**
 * The site's seven race/ethnicity shares from Scorecard's nine: American Indian/Alaska Native, Native
 * Hawaiian/Pacific Islander, and unknown fold into "other". Null unless White and Asian are reported.
 */
export function raceShares(race: (field: (typeof SCORECARD_RACE_FIELDS)[number]) => number | null): School["demographics"]["racial_diversity"] {
  const values = {
    asian: race("asian"),
    black: race("black"),
    hispanic: race("hispanic"),
    white: race("white"),
    two_or_more: race("two_or_more"),
    international: race("non_resident_alien"),
    other: (race("aian") ?? 0) + (race("nhpi") ?? 0) + (race("unknown") ?? 0),
  };
  if (values.white === null || values.asian === null) return null;
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, round(v ?? 0)])) as NonNullable<School["demographics"]["racial_diversity"]>;
}

/** Admitted ÷ applicants, rounded to 4 places; null under 10 applicants, where a rate is meaningless (0 of 1). */
export function acceptanceRate(applicants: number | null, admitted: number | null): number | null {
  return applicants && applicants >= 10 && admitted !== null ? round(Math.min(1, admitted / applicants)) : null;
}

/**
 * Enrolled ÷ admitted. Null when nobody was admitted, or when a college reports more enrollees than admits (a
 * reporting error in a few past years; an impossible yield would distort charts and national medians).
 */
export function yieldOf(admitted: number | null, enrolled: number | null): number | null {
  if (!admitted || enrolled === null || enrolled > admitted) return null;
  return enrolled / admitted;
}

/**
 * Which price columns hold the file's own academic year. `IC{Y}_AY` files carry four years ending with Y–Y+1 in
 * `…AY3`; `COST1_{Y+1}` files (2023–24 on) carry Y–Y+1 in `…AY2` and the following year in `…AY3`.
 */
export function priceSuffix(fileName: string): "2" | "3" {
  return /^COST1_/i.test(fileName) ? "2" : "3";
}

/** IPEDS SFA: percents are whole numbers; suffix "2" on GRN4 fields is the file's newest year. */
export function toAid(sfa: IpedsRow | undefined): School["aid"] {
  if (!sfa) return undefined;
  const n = (k: string) => ipedsNum(sfa, k);
  const p = (k: string) => {
    const v = n(k);
    return v === null ? null : v / 100;
  };
  const bands = [1, 2, 3, 4, 5];
  const counts = bands.map((b) => n(`GRN4N${b}2`));
  const cohort = n("SCUGFFN");
  const grantCount = n("AGRNT_N");
  const aid = {
    cohort,
    any_aid_pct: p("ANYAIDP"),
    // Exact share from counts; the published percent (AGRNT_P) is rounded to a whole number.
    grant_pct: cohort && grantCount !== null ? round(grantCount / cohort) : p("AGRNT_P"),
    grant_avg: n("AGRNT_A"),
    grant_count: grantCount,
    grant_total: n("AGRNT_T"),
    institutional_pct: p("IGRNT_P"),
    institutional_avg: n("IGRNT_A"),
    pell_pct: p("PGRNT_P"),
    pell_avg: n("PGRNT_A"),
    state_pct: p("SGRNT_P"),
    loan_pct: p("LOAN_P"),
    loan_avg: n("LOAN_A"),
    by_income: counts.some((c) => c !== null)
      ? {
          counts,
          avg_grant: bands.map((b) => n(`GRN4A${b}2`)),
          granted: bands.map((b) => n(`GRN4G${b}2`)),
          total_grants: bands.map((b) => n(`GRN4T${b}2`)),
        }
      : null,
  };
  return aid.cohort === null && aid.grant_pct === null ? undefined : aid;
}

/** The IPEDS price fields of `School["cost"]`, plus the full price even when grant data is missing. */
export interface Prices {
  sticker: ResidencyPrices;
  tuition_fees: ResidencyPrices;
  residency: ResidencyPrices;
  components: { books: number | null; room_board: number | null; other: number | null };
  aided_net_price: number | null;
  breakdown: NonNullable<NonNullable<School["cost"]>["breakdown"]> | null;
  avg_paid_all: number | null;
  /**
   * Residency-weighted tuition & fees + books + room & board + other (the breakdown's `full_price`), computed
   * whenever prices and residency are reported, so years before grant data (2007–08) still have one. Not stored
   * in data/schools.json.
   */
  full_price: number | null;
  /** True when the grant dollars per student were approximated as share × average (no total reported). */
  approx: boolean;
}

/**
 * Same-year sticker prices by residency and the estimated average paid by all first-years (not just grant
 * recipients):
 *
 *   avg paid ≈ Σ residency share × on-campus sticker price − grant dollars ÷ first-years
 *
 * Students without grants are counted at the full sticker price. Assumes on-campus living costs (so it runs high at
 * commuter-heavy schools). Returns null when the price file has no tuition for the college.
 */
export function computePrices(
  type: SchoolType,
  ic: IpedsRow | undefined,
  suffix: "2" | "3",
  sfa: IpedsRow | undefined,
  aid: School["aid"]
): Prices | null {
  if (!ic) return null;
  const n = (k: string) => ipedsNum(ic, `${k}${suffix}`);
  const extras = [n("CHG4AY"), n("CHG5AY"), n("CHG6AY")];
  const onCampusExtras = extras.every((v) => v !== null) ? extras.reduce((a, b) => a! + b!, 0)! : null;
  const tf = { in_district: n("CHG1AY"), in_state: n("CHG2AY"), out_of_state: n("CHG3AY") };
  const sticker = {
    in_district: tf.in_district !== null && onCampusExtras !== null ? tf.in_district + onCampusExtras : null,
    in_state: tf.in_state !== null && onCampusExtras !== null ? tf.in_state + onCampusExtras : null,
    out_of_state: tf.out_of_state !== null && onCampusExtras !== null ? tf.out_of_state + onCampusExtras : null,
  };
  if (Object.values(tf).every((v) => v === null)) return null;

  const pctOf = (k: string) => {
    const v = ipedsNum(sfa, k);
    return v === null ? null : v / 100;
  };
  let residency = { in_district: pctOf("SCFA11P"), in_state: pctOf("SCFA12P"), out_of_state: pctOf("SCFA13P") };
  const resTotal = Object.values(residency).reduce<number>((a, b) => a + (b ?? 0), 0);
  // Private colleges charge everyone the same; treat missing residency as all in-state.
  if (resTotal <= 0) residency = { in_district: 0, in_state: 1, out_of_state: 0 };
  const total = Object.values(residency).reduce<number>((a, b) => a + (b ?? 0), 0) || 1;

  // Tuition & fees averaged over the residency mix. Room & board, books, and other costs don't vary by residency.
  let weightedTuition = 0;
  let covered = 0;
  for (const k of ["in_district", "in_state", "out_of_state"] as const) {
    const share = (residency[k] ?? 0) / total;
    if (share === 0) continue;
    const price = tf[k] ?? tf.in_state;
    if (price === null) continue;
    weightedTuition += share * price;
    covered += share;
  }
  const [books, roomBoard, other] = extras;
  // Round each piece first so the displayed breakdown adds up exactly to the stored total.
  const tuition = covered >= 0.95 ? Math.round(weightedTuition / covered) : null;
  const fullPrice = tuition !== null && books !== null && roomBoard !== null && other !== null ? tuition + books + roomBoard + other : null;

  const grantPct = aid?.grant_pct ?? null;
  const grantAvg = aid?.grant_avg ?? null;
  const grantTotal = aid?.grant_total ?? null;
  const cohort = aid?.cohort ?? null;
  const exact = grantTotal !== null && !!cohort;
  const breakdown =
    fullPrice !== null && grantPct !== null && grantAvg !== null
      ? {
          tuition_fees: tuition!,
          books: books!,
          room_board: roomBoard!,
          other: other!,
          full_price: fullPrice,
          // Total paid ÷ students: total grant dollars spread over every first-year (exact when counts are reported).
          grant_per_student: Math.round(exact ? grantTotal / cohort : grantPct * grantAvg),
        }
      : null;
  const avgPaid = breakdown ? breakdown.full_price - breakdown.grant_per_student : null;
  // Guard against inconsistent inputs (e.g. grants reported larger than the price).
  const valid = avgPaid !== null && avgPaid > 0;

  return {
    sticker,
    tuition_fees: tf,
    residency: {
      in_district: residency.in_district === null ? null : round(residency.in_district / total),
      in_state: residency.in_state === null ? null : round(residency.in_state / total),
      out_of_state: residency.out_of_state === null ? null : round(residency.out_of_state / total),
    },
    components: { books, room_board: roomBoard, other },
    aided_net_price: type === "public" ? ipedsNum(sfa, "NPIST2") : ipedsNum(sfa, "NPGRN2"),
    breakdown: valid ? breakdown : null,
    avg_paid_all: valid ? avgPaid : null,
    full_price: fullPrice,
    approx: valid && !exact,
  };
}

/**
 * Net price by family income ($0–30K … $110K+) for first-years receiving federal aid: publics report in-state
 * students (`NPIS4{band}2`), privates everyone (`NPT4{band}2`). The same figures College Scorecard publishes.
 */
export function netPriceByIncome(type: SchoolType, sfa: IpedsRow | undefined): (number | null)[] {
  const prefix = type === "public" ? "NPIS4" : "NPT4";
  return [1, 2, 3, 4, 5].map((b) => ipedsNum(sfa, `${prefix}${b}2`));
}
