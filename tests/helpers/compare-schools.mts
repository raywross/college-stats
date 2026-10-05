/**
 * Fixture colleges for the compare overview's cards and takeaways (tests/compare-cards.test.mts,
 * tests/compare-insights.test.mts): the pilot colleges' figures from data/schools.json, and colleges that report little.
 * Only the fields the cards and sentences read are filled. Not a test file itself (no `.test.`).
 */
import type { School, TrendSummary } from "../../lib/types";

export interface Fixture {
  id: string;
  name: string;
  rate?: number | null;
  admitted?: number | null;
  enrolled?: number | null;
  /** SAT Reading & Writing and Math, 25th–75th. */
  sat?: [[number, number], [number, number]] | null;
  act?: [number, number] | null;
  policy?: string;
  undergrads?: number;
  pell?: number | null;
  ratio?: number | null;
  major?: { title: string; share: number } | null;
  cost?: number | null;
  price?: { full: number; grants: number } | null;
  earnings?: number | null;
  grad?: number | null;
  apps?: TrendSummary | null;
  rateTrend?: TrendSummary | null;
}

export function school(f: Fixture): School {
  return {
    unit_id: f.id,
    name: f.name,
    type: "private-nonprofit",
    admissions: {
      year: 2024,
      applicants: f.admitted ? Math.round(f.admitted / (f.rate ?? 1)) : null,
      admitted: f.admitted ?? null,
      enrolled: f.enrolled ?? null,
      acceptance_rate: f.rate ?? null,
      sat_reading_25_75: f.sat?.[0] ?? null,
      sat_math_25_75: f.sat?.[1] ?? null,
      act_composite_25_75: f.act ?? null,
      test_submission_rate_sat: null,
      test_submission_rate_act: null,
      ...(f.policy ? { test_policy: f.policy } : {}),
    },
    demographics: { undergrad_enrollment: f.undergrads ?? 1000, pell_grant_percent: f.pell ?? null, first_gen_percent: null, racial_diversity: null },
    academics: {
      student_faculty_ratio: f.ratio ?? null,
      majors_top: f.major ? [{ cip: "00.0000", title: f.major.title, share: f.major.share }] : null,
    },
    cost: {
      avg_paid_all: f.cost ?? null,
      breakdown: f.price ? { tuition_fees: 0, books: 0, room_board: 0, other: 0, full_price: f.price.full, grant_per_student: f.price.grants } : null,
    },
    outcomes: { median_earnings_10yr: f.earnings ?? null, graduation_rate: f.grad ?? null },
    ...(f.apps || f.rateTrend ? { trends: { ...(f.apps ? { applicants: f.apps } : {}), ...(f.rateTrend ? { acceptance_rate: f.rateTrend } : {}) } } : {}),
  } as unknown as School;
}

export const HARVARD = school({
  id: "166027", name: "Harvard University", rate: 0.0418, admitted: 2003, enrolled: 1675, sat: [[740, 780], [770, 800]], act: [34, 36], policy: "required",
  undergrads: 7601, pell: 0.1643, ratio: 7, major: { title: "Econometrics and Quantitative Economics", share: 0.1288 },
  cost: 48312, price: { full: 86705, grants: 38393 }, earnings: 101817, grad: 0.9835,
  apps: { since: 2014, from: 34295, to: 54008, change: 0.5748 }, rateTrend: { since: 2014, from: 0.0596, to: 0.0365, change: -0.0231 },
});

export const OHIO_STATE = school({
  id: "204796", name: "Ohio State University-Main Campus", rate: 0.6057, admitted: 44116, enrolled: 9607, sat: [[640, 720], [670, 760]], act: [28, 32], policy: "considered",
  undergrads: 45638, pell: 0.2016, ratio: 16, major: { title: "Finance, General", share: 0.0756 },
  cost: 30715, price: { full: 39903, grants: 9188 }, earnings: 60409, grad: 0.8219,
  apps: { since: 2014, from: 36788, to: 72829, change: 0.9797 }, rateTrend: { since: 2014, from: 0.5296, to: 0.6057, change: 0.0761 },
});

/** Test-blind: no SAT or ACT ranges. */
export const UCLA = school({
  id: "110662", name: "University of California-Los Angeles", rate: 0.0897, admitted: 13114, enrolled: 6610, policy: "not-considered",
  undergrads: 33475, pell: 0.2824, ratio: 20, major: { title: "Econometrics and Quantitative Economics", share: 0.0791 },
  cost: 32201, price: { full: 44802, grants: 12601 }, earnings: 82511, grad: 0.9344,
  apps: { since: 2014, from: 86537, to: 146272, change: 0.6903 }, rateTrend: { since: 2014, from: 0.1856, to: 0.0897, change: -0.0959 },
});

/** Reports almost nothing (open admission, no scores, cost, outcomes, or history): its size, ratio, and one major. */
export const ADLER = school({ id: "142832", name: "Adler University", undergrads: 9, ratio: 1, major: { title: "Applied Psychology", share: 1 } });

/** Reports nothing a card shows but its size. */
export const BLANK = school({ id: "900001", name: "Blank College", undergrads: 500 });
