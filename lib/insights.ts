import "server-only";
import type { School } from "./types";
import type { Dataset } from "./dataset";
import {
  BY_SEX_MIN_APPLICANTS,
  METRICS,
  admitRateGap,
  admitRatesBySex,
  admitRatio,
  aidGenerosity,
  generosityTier,
  paybackYears,
  satMid,
  selectivityTier,
  sizeBucket,
  yieldRate,
  type Domain,
  type MetricKey,
} from "./metrics";
import { money, moneyCompact, pct, pctSmart, num } from "./format";
import { shortName } from "./brand";
import { SERIES, changeOver, defaultWindow, historyYearLabel, isTinyBase, type SchoolHistory, type SeriesKey } from "./history";
import type { HistoryFiles } from "./supabase";

/* ------------------------------------------------------------------ */
/* "Known for" badges: computed standouts vs. the dataset              */
/* ------------------------------------------------------------------ */

export interface Standout {
  label: string;
  domain: Domain;
  metric: MetricKey;
}

/** Functions below that compare a college with all others take the loaded dataset first (`await getData()`). */
export function standouts({ rankOf }: Dataset, s: School, { trends = false }: { trends?: boolean } = {}): Standout[] {
  const out: Standout[] = [];
  const at = (k: MetricKey, test: (v: number) => boolean) => {
    const v = rankOf(s, k);
    return v !== null && test(v);
  };
  // Rate-based badges need a real applicant pool to mean anything.
  const pool = (s.admissions.applicants ?? 0) >= 500;

  if (pool && at("acceptance", (v) => v <= 0.03)) out.push({ label: "Ultra-selective", domain: "admissions", metric: "acceptance" });
  if (pool && at("yield", (v) => v >= 0.9)) out.push({ label: "High yield", domain: "admissions", metric: "yield" });
  // Neutral wording: a fact about who gets in, not a verdict (specs/data-expansion/admissions-detail.md).
  const gap = admitRateGap(s);
  if (gap !== null && at("admitGapSize", (v) => v >= 0.95))
    out.push({ label: `Admits ${gap > 0 ? "men" : "women"} at a higher rate`, domain: "admissions", metric: "admitGap" });
  if (at("sat", (v) => v >= 0.9)) out.push({ label: "Top test scores", domain: "scores", metric: "sat" });
  if (at("enrollment", (v) => v >= 0.95)) out.push({ label: "Big campus", domain: "size", metric: "enrollment" });
  if (at("enrollment", (v) => v <= 0.1)) out.push({ label: "Intimate campus", domain: "size", metric: "enrollment" });
  if (at("pell", (v) => v >= 0.85)) out.push({ label: "Economic diversity", domain: "access", metric: "pell" });
  if (at("firstGen", (v) => v >= 0.85)) out.push({ label: "First-gen friendly", domain: "access", metric: "firstGen" });
  if (at("diversity", (v) => v >= 0.85)) out.push({ label: "Very diverse", domain: "diversity", metric: "diversity" });
  const cheap = rankOf(s, "avgCost");
  const earns = rankOf(s, "earnings");
  if (cheap !== null && earns !== null && cheap <= 0.25 && earns >= 0.75)
    out.push({ label: "Great value", domain: "value", metric: "earnings" });
  else if (at("earnings", (v) => v >= 0.9)) out.push({ label: "High earners", domain: "value", metric: "earnings" });
  if (at("aidGenerosity", (v) => v >= 0.85)) out.push({ label: "Generous aid", domain: "value", metric: "aidGenerosity" });
  if (at("avgCost", (v) => v <= 0.1)) out.push({ label: "Low average cost", domain: "value", metric: "avgCost" });
  if (at("loanRateLarge", (v) => v <= 0.05)) out.push({ label: "Few students borrow", domain: "value", metric: "loanRate" });
  if (at("gradRate", (v) => v >= 0.9)) out.push({ label: "High graduation rate", domain: "value", metric: "gradRate" });
  const { test_submission_rate_sat: sat, test_submission_rate_act: act } = s.admissions;
  if (sat !== null && act !== null && sat < 0.5 && act < 0.5) {
    out.push({ label: "Test-optional heavy", domain: "scores", metric: "sat" });
  }
  // Trend chips only on the profile (specs/trends-design.md): Explore cards stay unchanged.
  const trend = trends ? trendStandout({ rankOf }, s) : null;
  if (trend) out.push(trend);
  return out;
}

/** "doubled", "tripled", "up 85%": how a relative change reads in a chip. */
function grewBy(change: number): string {
  const times = change + 1;
  if (times >= 2.95 && times < 3.5) return "tripled";
  if (times >= 1.95 && times < 2.5) return "doubled";
  if (times >= 3.5) return `grew ${Math.round(times)}×`;
  return `up ${Math.round(change * 100)}%`;
}

/**
 * At most one trend standout (specs/trends-design.md): only the national top 5% of a 10-year change, and only on a
 * real base (1,000+ applicants or undergrads), so a small college's swing doesn't read as a trend.
 */
export function trendStandout({ rankOf }: Pick<Dataset, "rankOf">, s: School): Standout | null {
  const t = s.trends;
  const top = (k: MetricKey) => (rankOf(s, k) ?? 0) >= 0.95;
  if (t?.applicants && t.applicants.from >= 1000 && t.applicants.change > 0 && top("applicantsChange")) {
    return { label: `Applications ${grewBy(t.applicants.change)} since fall ${t.applicants.since}`, domain: "admissions", metric: "applicantsChange" };
  }
  if (t?.undergrads && t.undergrads.from >= 1000 && t.undergrads.change > 0 && top("sizeChange")) {
    return { label: `Enrollment ${grewBy(t.undergrads.change)} since fall ${t.undergrads.since}`, domain: "size", metric: "sizeChange" };
  }
  const cost = rankOf(s, "avgCostChange");
  if (t?.avg_paid_all && t.avg_paid_all.change < 0 && cost !== null && cost <= 0.05) {
    return { label: `Average cost down ${Math.round(-t.avg_paid_all.change * 100)}% since ${t.avg_paid_all.since}–${String(t.avg_paid_all.since + 1).slice(2)}`, domain: "value", metric: "avgCostChange" };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Plain-English takeaways (Data USA-style one-liners)                 */
/* ------------------------------------------------------------------ */

function share(rank: number): string {
  return `${Math.round(rank * 100)}%`;
}

export function admissionsTakeaway({ rankOf, reportingCount }: Dataset, s: School): string | undefined {
  const rate = s.admissions.acceptance_rate;
  const n = admitRatio(s);
  const rank = rankOf(s, "acceptance");
  if (rate === null || n === null || rank === null) return undefined;
  const tier = selectivityTier(rate).label;
  return `${shortName(s)} admits about ${n} applicants (${pctSmart(rate)}). That puts it in the "${tier}" tier, more selective than ${share(
    1 - rank
  )} of the ${num(reportingCount("acceptance"))} colleges that report admissions.`;
}

export function yieldTakeaway({ rankOf }: Dataset, s: School): string | undefined {
  const y = yieldRate(s);
  const r = rankOf(s, "yield");
  if (y === null || r === null) return undefined;
  const tone = r >= 0.8 ? "one of the highest" : r <= 0.2 ? "on the lower end" : "in the typical range";
  return `${pct(y)} of admitted students enroll, ${tone} nationally.`;
}

export function scoresTakeaway({ metricMedian }: Dataset, s: School): string | undefined {
  const mid = satMid(s);
  const med = metricMedian("sat");
  if (mid === null || med === null) return undefined;
  const diff = mid - med;
  const cmp =
    Math.abs(diff) < 15
      ? "right around the national median"
      : diff > 0
        ? `${Math.round(diff)} points above the median`
        : `${Math.round(-diff)} points below the median`;
  return `The typical admitted student scores around ${mid} on the SAT, ${cmp} for colleges that report scores.`;
}

export function studentsTakeaway({ rankOf }: Dataset, s: School): string {
  const size = sizeBucket(s.demographics.undergrad_enrollment).label.toLowerCase();
  const base = `A ${size} campus of ${num(s.demographics.undergrad_enrollment)} undergrads`;
  const pell = s.demographics.pell_grant_percent;
  const pellRank = rankOf(s, "pell");
  if (pell === null || pellRank === null) return `${base}.`;
  const pellTone = pellRank >= 0.66 ? "a high share" : pellRank <= 0.33 ? "a low share" : "a typical share";
  return `${base}, where ${pct(pell)} receive Pell Grants, ${pellTone} compared to other colleges.`;
}

/** A gap between men's and women's acceptance rates this large (in points) gets its own card on the profile. */
export const BY_SEX_NOTABLE_GAP = 0.03;

/**
 * Men's and women's acceptance rates for the Admissions section (specs/data-expansion/admissions-detail.md): `notable`
 * when the gap is at least 3 points and both have 200+ applicants, otherwise a plain line. Null without both rates.
 */
export function admissionsBySex(s: School): { men: number; women: number; notable: boolean; sentence: string } | null {
  const { men, women } = admitRatesBySex(s);
  if (men === null || women === null) return null;
  const gap = admitRateGap(s);
  const notable = gap !== null && Math.abs(gap) >= BY_SEX_NOTABLE_GAP;
  const [lower, higher] = men < women ? [["Men", men], ["women", women]] as const : [["Women", women], ["men", men]] as const;
  const sentence = notable
    ? `${lower[0]} were admitted at ${pctSmart(lower[1])}, ${higher[0]} at ${pctSmart(higher[1])}.`
    : gap !== null
      ? `Men and women were admitted at similar rates (${pctSmart(men)} and ${pctSmart(women)}).`
      : `Men were admitted at ${pctSmart(men)}, women at ${pctSmart(women)}; with under ${BY_SEX_MIN_APPLICANTS} applicants of one sex, the difference says little.`;
  return { men, women, notable, sentence };
}

/** Above this percentile of colleges, the share of students 25 and older earns a "Many adult students" chip. */
export const ADULT_STUDENTS_RANK = 0.75;

/**
 * Plain-language notes for the profile's student-body card (specs/data-expansion/student-body.md): how many study
 * part-time, and whether adult students are unusually common. Neutral wording; none of these is better or worse.
 */
export function studentBodyNotes({ rankOf }: Dataset, s: School): { study: string | null; manyAdults: boolean } {
  const p = s.demographics.part_time_share;
  const study = p == null ? null : p < 0.03 ? "Almost everyone studies full-time." : `${pctSmart(p)} of undergrads study part-time.`;
  const adultRank = rankOf(s, "adults");
  return { study, manyAdults: adultRank !== null && adultRank >= ADULT_STUDENTS_RANK };
}

/** Sticker phrase for a year, e.g. "$84,412" or "$36,980 in-state / $67,052 out-of-state". */
export function stickerPhrase(s: School): string | null {
  const st = s.cost?.sticker;
  if (!st) return null;
  const inState = st.in_state ?? st.in_district;
  if (inState === null) return null;
  const out = st.out_of_state;
  return s.type === "public" && out !== null && out !== inState ? `${money(inState)} in-state / ${money(out)} out-of-state` : money(inState);
}

export function costTakeaway({ metricMedian }: Dataset, s: School): string | undefined {
  const all = s.cost?.avg_paid_all ?? null;
  const med = metricMedian("avgCost");
  if (all === null || med === null) return undefined;
  const year = s.cost?.year ?? "";
  const diff = all - med;
  const cmp =
    Math.abs(diff) < 1000 ? "about the national median" : `${moneyCompact(Math.abs(diff))} ${diff < 0 ? "less" : "more"} than the national median`;
  const share = s.aid?.grant_pct ?? null;
  const aided = s.cost?.aided_net_price ?? null;
  const sticker = stickerPhrase(s);
  const split =
    share !== null && aided !== null && sticker
      ? ` The ${pct(share)} who received grants paid ${money(aided)} on average; the other ${pct(1 - share)} paid the full sticker price of ${sticker}.`
      : "";
  return `In ${year}, the average first-year paid an estimated ${money(all)} in total (tuition, housing, food, books and other costs, after grants), ${cmp}.${split}`;
}

export function generosityTakeaway({ rankOf }: Dataset, s: School): string | undefined {
  const g = aidGenerosity(s);
  const r = rankOf(s, "aidGenerosity");
  const b = s.cost?.breakdown;
  if (g === null || r === null || !b) return undefined;
  const tier = generosityTier(g).label.toLowerCase();
  const lead = `Grants cover ${pct(g)} of the ${money(b.full_price)} full price on average across all first-years (${tier}), more than at ${Math.round(r * 100)}% of colleges.`;
  const tail =
    g >= 0.4
      ? " The sticker price overstates what most students here actually pay."
      : g < 0.25
        ? " Most students here pay close to the sticker price."
        : "";
  return lead + tail;
}

export function outcomesTakeaway({ rankOf }: Dataset, s: School): string | undefined {
  const earn = s.outcomes?.median_earnings_10yr ?? null;
  const grad = s.outcomes?.graduation_rate ?? null;
  const parts: string[] = [];
  if (earn !== null) {
    const r = rankOf(s, "earnings");
    parts.push(
      `Former students earn a median ${money(earn)} ten years after enrolling${
        r !== null ? `, more than at ${Math.round(r * 100)}% of colleges` : ""
      }`
    );
  }
  if (grad !== null) parts.push(`${pct(grad)} graduate within six years`);
  if (parts.length === 0) return undefined;
  const payback = paybackYears(s);
  const pb = payback !== null ? ` Four years of net price is about ${payback.toFixed(1)} years of that salary.` : "";
  return `${parts.join("; ")}.${pb}`;
}

/* ------------------------------------------------------------------ */
/* Similar schools: nearest neighbours on percentile ranks             */
/* ------------------------------------------------------------------ */

const FEATURES: MetricKey[] = ["acceptance", "sat", "enrollment", "pell", "diversity"];
/** Rank vectors per loaded dataset, so a reload never pairs new data with old ranks. */
const vectorCache = new WeakMap<Dataset, Map<string, (number | null)[]>>();

function vectorOf(data: Dataset, s: School): (number | null)[] {
  const { getAllSchools, rankOf } = data;
  let vectors = vectorCache.get(data);
  if (!vectors) {
    vectors = new Map(getAllSchools().map((x) => [x.unit_id, FEATURES.map((k) => rankOf(x, k))]));
    vectorCache.set(data, vectors);
  }
  return vectors.get(s.unit_id) ?? FEATURES.map((k) => rankOf(s, k));
}

export function similarSchools(data: Dataset, s: School, n = 4): { school: School; reasons: string[] }[] {
  const me = vectorOf(data, s);
  const results: { school: School; dist: number; v: (number | null)[] }[] = [];
  for (const o of data.getAllSchools()) {
    if (o.unit_id === s.unit_id) continue;
    const v = vectorOf(data, o);
    let sum = 0;
    let shared = 0;
    for (let i = 0; i < FEATURES.length; i++) {
      if (me[i] === null || v[i] === null) continue;
      sum += (me[i]! - v[i]!) ** 2;
      shared++;
    }
    // Need at least 3 comparable features to call two schools similar.
    if (shared < 3) continue;
    const dist = Math.sqrt(sum / shared) + (o.type === s.type ? 0 : 0.08);
    results.push({ school: o, dist, v });
  }
  return results
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(({ school: o, v }) => {
      const close = (i: number) => me[i] !== null && v[i] !== null && Math.abs(me[i]! - v[i]!) < 0.08;
      const reasons: string[] = [];
      if (close(0)) reasons.push("Similar selectivity");
      if (close(1)) reasons.push("Similar scores");
      if (close(2)) reasons.push("Similar size");
      if (o.location.region === s.location.region) reasons.push(`Also ${o.location.region}`);
      if (o.type === s.type) reasons.push(o.type === "public" ? "Also public" : "Also private");
      return { school: o, reasons: reasons.slice(0, 3) };
    });
}

/* ------------------------------------------------------------------ */
/* Compare: Versus-style "key differences"                             */
/* ------------------------------------------------------------------ */

export interface Difference {
  metric: MetricKey;
  headline: string;
  leader: School;
  trailer: School;
  /** 0..1 magnitude used to sort and size the gap bar. */
  magnitude: number;
}

export function keyDifferences(list: School[]): Difference[] {
  if (list.length < 2) return [];
  const keys: MetricKey[] = [
    "acceptance",
    "avgCost",
    "aidGenerosity",
    "earnings",
    "gradRate",
    "enrollment",
    "sat",
    "pell",
    "firstGen",
    "diversity",
    "yield",
  ];
  const diffs: Difference[] = [];

  for (const key of keys) {
    const m = METRICS[key];
    const withValue = list.filter((s) => m.get(s) !== null);
    if (withValue.length < 2) continue;
    const sorted = [...withValue].sort((a, b) => m.get(b)! - m.get(a)!);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    const hv = m.get(hi)!;
    const lv = m.get(lo)!;
    if (hv === lv || lv <= 0) continue;

    let headline: string;
    let magnitude: number;
    switch (key) {
      case "acceptance": {
        const ratio = hv / lv;
        headline =
          ratio >= 1.5
            ? `${shortName(lo)} is ${ratio.toFixed(1)}× more selective than ${shortName(hi)}`
            : `${shortName(lo)} admits ${pctSmart(lv)} vs. ${pctSmart(hv)} at ${shortName(hi)}`;
        magnitude = Math.min(1, Math.log(ratio) / Math.log(15));
        diffs.push({ metric: key, headline, leader: lo, trailer: hi, magnitude });
        continue;
      }
      case "enrollment": {
        const ratio = hv / lv;
        headline =
          ratio >= 1.5
            ? `${shortName(hi)} has ${ratio.toFixed(1)}× as many undergrads as ${shortName(lo)}`
            : `${shortName(hi)} is a bit larger (${num(hv)} vs. ${num(lv)})`;
        magnitude = Math.min(1, Math.log(ratio) / Math.log(20));
        break;
      }
      case "avgCost":
        headline = `${shortName(lo)} costs about ${moneyCompact(hv - lv)} less per year on average than ${shortName(hi)} (${money(lv)} vs. ${money(hv)}, all students)`;
        magnitude = Math.min(1, (hv - lv) / 30000);
        diffs.push({ metric: key, headline, leader: lo, trailer: hi, magnitude });
        continue;
      case "aidGenerosity":
        headline = `${shortName(hi)}'s grants cover ${pct(hv)} of its full price on average, vs. ${pct(lv)} at ${shortName(lo)}`;
        magnitude = Math.min(1, (hv - lv) / 0.4);
        break;
      case "earnings":
        headline = `${shortName(hi)} grads earn ${moneyCompact(hv - lv)} more ten years out than ${shortName(lo)}'s (${money(hv)} vs. ${money(lv)})`;
        magnitude = Math.min(1, (hv - lv) / 40000);
        break;
      case "gradRate":
        headline = `${shortName(hi)} graduates ${Math.round((hv - lv) * 100)} pts more of its students than ${shortName(lo)} (${pct(hv)} vs. ${pct(lv)})`;
        magnitude = Math.min(1, (hv - lv) / 0.4);
        break;
      case "sat":
        headline = `${shortName(hi)}'s SAT midpoint is ${Math.round(hv - lv)} points higher than ${shortName(lo)}'s`;
        magnitude = Math.min(1, (hv - lv) / 400);
        break;
      case "diversity":
        headline = `${shortName(hi)} is more diverse (index ${hv.toFixed(2)} vs. ${lv.toFixed(2)})`;
        magnitude = Math.min(1, (hv - lv) / 0.4);
        break;
      default: {
        const pts = Math.round((hv - lv) * 100);
        headline =
          key === "yield"
            ? `${shortName(hi)}'s yield is ${pts} pts higher than ${shortName(lo)}'s`
            : `${shortName(hi)} has ${pts} pts ${m.more} than ${shortName(lo)} (${m.format(hv)} vs. ${m.format(lv)})`;
        magnitude = Math.min(1, (hv - lv) / 0.4);
      }
    }
    diffs.push({ metric: key, headline, leader: hi, trailer: lo, magnitude });
  }

  return diffs.sort((a, b) => b.magnitude - a.magnitude);
}

/** Percentile profile used by the compare radar chart (0..1, outward = "more"). */
export const RADAR_AXES: { key: MetricKey; label: string; invert?: boolean }[] = [
  { key: "acceptance", label: "Selectivity", invert: true },
  { key: "sat", label: "Test scores" },
  { key: "enrollment", label: "Size" },
  { key: "pell", label: "Pell share" },
  { key: "firstGen", label: "First-gen" },
  { key: "diversity", label: "Diversity" },
];

/** Missing values are returned as null so the chart can mark them. */
export function radarProfile({ rankOf }: Dataset, s: School): (number | null)[] {
  return RADAR_AXES.map(({ key, invert }) => {
    const r = rankOf(s, key);
    return r === null ? null : invert ? 1 - r : r;
  });
}

/* ------------------------------------------------------------------ */
/* Over time (specs/trends-design.md)                                  */
/* ------------------------------------------------------------------ */

/** "rose 12%", "fell 3%", "held about steady" for a relative change. */
export function movedBy(change: number): string {
  if (Math.abs(change) < 0.015) return "held about steady";
  return `${change > 0 ? "rose" : "fell"} ${Math.round(Math.abs(change) * 100)}%`;
}

/**
 * One or two sentences atop the profile's "Over time" section: how the full price and what students actually paid
 * moved over the default window (after inflation), and why when grants explain the gap; then applications and the
 * acceptance rate.
 */
export function historyTakeaway(h: SchoolHistory, files: Pick<HistoryFiles, "cpi" | "meta">): string | undefined {
  const ch = (k: SeriesKey) => changeOver(k, h.series[k], defaultWindow(files.meta, SERIES[k].kind), files.cpi);
  const sentences: string[] = [];

  const full = ch("full_price");
  const paid = ch("avg_paid_all");
  const gen = ch("aid_generosity");
  if (full && paid) {
    const since = historyYearLabel(Math.max(full.from.year, paid.from.year), "academic");
    const gap = paid.change - full.change;
    if (Math.abs(gap) < 0.03) {
      sentences.push(`Since ${since}, the full price ${movedBy(full.change)} after inflation, and what the average first-year paid moved with it.`);
    } else {
      const why = gap < 0 && gen && gen.change > 0.01 ? ", because grants grew faster" : gap > 0 && gen && gen.change < -0.01 ? ", as grants covered less of it" : "";
      sentences.push(`Since ${since}, the full price ${movedBy(full.change)} after inflation, while what the average first-year paid ${movedBy(paid.change)}${why}.`);
    }
  } else if (full) {
    sentences.push(`Since ${historyYearLabel(full.from.year, "academic")}, the full price ${movedBy(full.change)} after inflation.`);
  }

  const apps = ch("applicants");
  const rate = ch("acceptance_rate");
  if (apps && !isTinyBase(apps)) {
    const r = rate ? `, and the acceptance rate went from ${pctSmart(rate.from.value)} to ${pctSmart(rate.to.value)}` : "";
    sentences.push(`Applications ${movedBy(apps.change)} since ${historyYearLabel(apps.from.year, "fall").toLowerCase()}${r}.`);
  }
  return sentences.length ? sentences.join(" ") : undefined;
}
