import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getData, getDetail, getHistory, getHistoryFiles, type Dataset } from "./data";
import type { FinanceForm, MajorShare, School, SchoolFinances } from "./types";
import type { SchoolDetail } from "./detail";
import type { SchoolHistory } from "./history";
import type { HistoryFiles } from "./supabase";
import { diversityIndex, hasAdmissionCounts, hasTestScores, paybackYears, satMid, satTotal, yieldRate } from "./metrics";
import { hasGradByGroup } from "./graduation-groups";
import { isShown } from "./outcome-measures";
import { hasLgbtq } from "./lgbtq";
import { INSTRUCTION_METRIC, endowmentMetricFor } from "./finances";
import { PROFILE_TOPICS, type TopicKey } from "./profile-topics";
import { religionView } from "./religion";
import { greekCard } from "./cds/greek-display";

/** A college's history shard and the shared history files, when both exist (specs/trends-data.md). */
export interface ProfileHistory {
  history: SchoolHistory;
  files: HistoryFiles;
}

/**
 * Everything the overview and the topic pages share: the dataset, the college, its history and detail files, and
 * the derived values and "has data" flags that decide which pages and blocks render.
 */
export interface Profile {
  data: Dataset;
  school: School;
  detail: SchoolDetail | null;
  /** Null when the college has no history shard or history isn't published. */
  history: ProfileHistory | null;

  /** Applied / admitted / enrolled counts are all reported. */
  counts: boolean;
  /** Any SAT or ACT range is reported. */
  scores: boolean;
  hasAdmissions: boolean;
  hasCampus: boolean;
  hasAcademics: boolean;
  /** Anything about cost (what students pay, sticker, net price by income); the old Cost & outcomes condition. */
  hasCost: boolean;
  hasOutcomes: boolean;
  /** Topic pages this college has, in PROFILE_TOPICS order; the pills, links, and prev/next use it. */
  topics: TopicKey[];

  rate: number | null;
  sat: [number, number] | null;
  yld: number | null;
  div: number | null;
  avgCost: number | null;
  earnings: number | null;
  grad: number | null;
  byIncome: (number | null)[] | null;
  payback: number | null;
  /** On the admissions map: reports both an acceptance rate and SAT. */
  onMap: boolean;
  /** On the cost vs. earnings map. */
  onValueMap: boolean;

  ratio: number | null;
  ratioRank: number | null;
  /** "fewer than at 96%" below the median, "more than at 88%" above it. */
  ratioVs: { share: number; word: "fewer" | "more" } | null;
  finances: SchoolFinances | null;
  financeForm: FinanceForm | null;
  instructionKey: (typeof INSTRUCTION_METRIC)[FinanceForm] | null;
  endowmentKey: ReturnType<typeof endowmentMetricFor>;
  instructionRank: number | null;
  endowmentRank: number | null;
  fullTimeShare: number | null;
  facultySalaryValue: number | null;
  majorsTop: MajorShare[] | null;
  hasTopPrograms: boolean;
}

/**
 * Loads one college's profile once per request (React `cache`), so the overview, a topic page, and their metadata
 * share a single data load. Null for an unknown id.
 */
export const loadProfile = cache(async (id: string): Promise<Profile | null> => {
  const data = await getData();
  const school = data.getSchoolById(id);
  if (!school) return null;
  const [history, files, detail] = await Promise.all([getHistory(school.unit_id), getHistoryFiles(), getDetail(school.unit_id)]);
  const { rankOf } = data;
  const { admissions: a } = school;
  const c = school.cost;
  const o = school.outcomes;

  const rate = a.acceptance_rate;
  const counts = hasAdmissionCounts(school);
  const scores = hasTestScores(school);
  const avgCost = c?.avg_paid_all ?? null;
  const earnings = o?.median_earnings_10yr ?? null;
  const grad = o?.graduation_rate ?? null;
  const byIncome = c?.net_price_by_income ?? null;

  const ratio = school.academics?.student_faculty_ratio ?? null;
  const ratioRank = rankOf(school, "studentFaculty");
  const ratioVs = ratioRank === null ? null : ratioRank <= 0.5 ? { share: 1 - ratioRank, word: "fewer" as const } : { share: ratioRank, word: "more" as const };
  // Finances (specs/data-expansion/finances.md): benchmarked only within the same accounting form (sector), never
  // publics against private nonprofits.
  const finances = school.finances ?? null;
  const financeForm = finances?.form ?? null;
  const instructionKey = financeForm ? INSTRUCTION_METRIC[financeForm] : null;
  const endowmentKey = endowmentMetricFor(school);
  const faculty = school.academics?.faculty ?? null;
  const fullTimeShare = faculty?.full_time_share ?? null;
  const facultySalaryValue = faculty?.avg_salary_9mo ?? null;
  const majorsTop = school.academics?.majors_top ?? null;
  const hasTopPrograms = (school.academics?.programs_with_earnings ?? 0) > 0;

  const hasHistory = history !== null && files !== null && Object.keys(history.series).length > 0;
  const hasAdmissions = rate !== null || counts;
  // Greek, religious, and LGBTQ+ life (specs/greek-life.md, specs/religious-life.md, specs/lgbtq-life.md) count too,
  // so the section and its "Campus life" link show for any of them alone.
  const hasCampus =
    !!(school.campus?.housing || school.campus?.athletics || school.campus?.programs || greekCard(school) || religionView(school)) ||
    hasLgbtq(school);
  const hasAcademics = !!majorsTop?.length || hasTopPrograms || ratio !== null || fullTimeShare !== null || facultySalaryValue !== null || finances !== null;
  // The single-page profile showed Cost & outcomes when any of these existed; the split keeps that for cost and
  // adds the outcome blocks' own conditions for the outcomes page.
  const hasCost = avgCost !== null || !!c?.sticker || earnings !== null || grad !== null || byIncome !== null;
  const hasOutcomes = earnings !== null || grad !== null || isShown(o?.eight_year?.all) || hasGradByGroup(school);

  const has: Record<TopicKey, boolean> = { admissions: hasAdmissions, students: true, academics: hasAcademics, cost: hasCost, outcomes: hasOutcomes, history: hasHistory };

  return {
    data,
    school,
    detail,
    history: hasHistory ? { history, files } : null,
    counts,
    scores,
    hasAdmissions,
    hasCampus,
    hasAcademics,
    hasCost,
    hasOutcomes,
    topics: PROFILE_TOPICS.filter((t) => has[t.key]).map((t) => t.key),
    rate,
    // The SAT total the college shows (derived.sat_total: its own CDS total when reported, else the sum; never ranked).
    sat: satTotal(school),
    yld: yieldRate(school),
    div: diversityIndex(school),
    avgCost,
    earnings,
    grad,
    byIncome,
    payback: paybackYears(school),
    onMap: rate !== null && satMid(school) !== null,
    onValueMap: avgCost !== null && earnings !== null,
    ratio,
    ratioRank,
    ratioVs,
    finances,
    financeForm,
    instructionKey,
    endowmentKey,
    instructionRank: instructionKey ? rankOf(school, instructionKey) : null,
    endowmentRank: endowmentKey && finances?.endowment_per_student != null ? rankOf(school, endowmentKey) : null,
    fullTimeShare,
    facultySalaryValue,
    majorsTop,
    hasTopPrograms,
  };
});

/** The profile for a topic page, or a 404 when the college is unknown or has no data for that topic. */
export async function requireTopic(id: string, key: TopicKey): Promise<Profile> {
  const profile = await loadProfile(id);
  if (!profile || !profile.topics.includes(key)) notFound();
  return profile;
}
