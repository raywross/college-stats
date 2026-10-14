/**
 * The season (specs/planner/next-steps/seasons.md "The season"): where a student is in high school by the calendar,
 * from the graduation year alone, so the same sophomore sees the same moves in October whether they signed up in
 * August or yesterday. One set of boundaries for the whole plan: the school year turns on August 1 (the cycle's start,
 * `currentCycle` in lib/planner/cycle.ts), and the planner's older `gradeOf()` is a thin map over `seasonOf()` here.
 *
 * With G the graduation year and S = G − 1 (the senior year's calendar start):
 *   freshman              Aug S−3 → Jul S−2 (and anything earlier: a middle schooler starts on the freshman playbook)
 *   sophomore             Aug S−2 → Jul S−1
 *   junior_fall           Aug–Dec S−1
 *   junior_winter         Jan–Feb S
 *   junior_spring         Mar–May S
 *   summer_before_senior  Jun–Jul S
 *   senior_fall           Aug–Dec S
 *   senior_winter         Jan–Feb G
 *   senior_spring         Mar–May G
 *   summer_after          Jun–Jul G
 *   graduated             from Aug G
 *   unknown               no graduation year
 *
 * Pure; safe in server code, client components, and tests.
 */
import type { Grade } from "./cycle.ts";

export type Season =
  | "freshman"
  | "sophomore"
  | "junior_fall"
  | "junior_winter"
  | "junior_spring"
  | "summer_before_senior"
  | "senior_fall"
  | "senior_winter"
  | "senior_spring"
  | "summer_after"
  | "graduated"
  | "unknown";

/** Every season in calendar order, `unknown` last. */
export const SEASONS: readonly Season[] = [
  "freshman",
  "sophomore",
  "junior_fall",
  "junior_winter",
  "junior_spring",
  "summer_before_senior",
  "senior_fall",
  "senior_winter",
  "senior_spring",
  "summer_after",
  "graduated",
  "unknown",
];

export const SEASON_LABELS: Record<Season, string> = {
  freshman: "Freshman year",
  sophomore: "Sophomore year",
  junior_fall: "Junior fall",
  junior_winter: "Junior winter",
  junior_spring: "Junior spring",
  summer_before_senior: "Summer before senior year",
  senior_fall: "Senior fall",
  senior_winter: "Senior winter",
  senior_spring: "Senior spring",
  summer_after: "Summer after senior year",
  graduated: "In college",
  unknown: "Class year not set",
};

export function isSeason(v: unknown): v is Season {
  return typeof v === "string" && (SEASONS as readonly string[]).includes(v);
}

/**
 * Each dated season's first month, relative to S (the senior year's calendar start): [year offset, month 1–12]. A
 * season runs from its start to the month before the next one's start; graduated is open-ended.
 */
const STARTS: readonly [Exclude<Season, "graduated" | "unknown">, number, number][] = [
  ["freshman", -3, 8],
  ["sophomore", -2, 8],
  ["junior_fall", -1, 8],
  ["junior_winter", 0, 1],
  ["junior_spring", 0, 3],
  ["summer_before_senior", 0, 6],
  ["senior_fall", 0, 8],
  ["senior_winter", 1, 1],
  ["senior_spring", 1, 3],
  ["summer_after", 1, 6],
];
/** graduated starts in August of G (= S + 1). */
const GRADUATED_START: readonly [number, number] = [1, 8];

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

/** The season on `today` (ISO yyyy-mm-dd) for the class of `gradYear`; `unknown` without a usable year. */
export function seasonOf(gradYear: number | null, today: string): Season {
  if (gradYear === null || !Number.isFinite(gradYear)) return "unknown";
  const [y, m] = today.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "unknown";
  const s = gradYear - 1;
  const at = monthIndex(y, m);
  if (at >= monthIndex(s + GRADUATED_START[0], GRADUATED_START[1])) return "graduated";
  let found: Season = "freshman";
  for (const [season, dy, month] of STARTS) {
    if (at >= monthIndex(s + dy, month)) found = season;
  }
  return found;
}

/** The season a date falls in, for the class of `gradYear` (a dated move's season; review note 2). */
export function seasonOfDate(iso: string, gradYear: number): Season {
  return seasonOf(gradYear, iso);
}

const pad = (n: number) => String(n).padStart(2, "0");

function lastDayOf(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(d)}`;
}

/**
 * The first and last day of a season for the class of `gradYear` (ISO, inclusive). Null for `graduated` (open-ended)
 * and `unknown`. Freshman starts in August of S−3 (an earlier date also reads as freshman, but the bounds are the
 * school year's).
 */
export function seasonBounds(season: Season, gradYear: number): { start: string; end: string } | null {
  const i = STARTS.findIndex(([s]) => s === season);
  if (i < 0) return null;
  const s = gradYear - 1;
  const [, dy, month] = STARTS[i];
  const [ndy, nmonth] = i + 1 < STARTS.length ? [STARTS[i + 1][1], STARTS[i + 1][2]] : GRADUATED_START;
  const startYear = s + dy;
  // The last month is the one before the next season's first.
  let endYear = s + ndy;
  let endMonth = nmonth - 1;
  if (endMonth === 0) {
    endMonth = 12;
    endYear -= 1;
  }
  return { start: `${startYear}-${pad(month)}-01`, end: lastDayOf(endYear, endMonth) };
}

/** The season after this one; null after `graduated` and for `unknown`. */
export function nextSeason(season: Season): Season | null {
  if (season === "graduated" || season === "unknown") return null;
  return SEASONS[SEASONS.indexOf(season) + 1];
}

/** The season's position in calendar order (freshman 0 … graduated 10); `unknown` ranks last (11). */
export function seasonRank(season: Season): number {
  return SEASONS.indexOf(season);
}

/** The planner's older Grade for a season: freshman and sophomore are `earlier`; junior fall and winter are one. */
export function gradeForSeason(season: Season): Grade {
  switch (season) {
    case "freshman":
    case "sophomore":
      return "earlier";
    case "junior_fall":
    case "junior_winter":
      return "junior_fall";
    default:
      return season;
  }
}

/**
 * The grade on `today` (ISO) for the class of `gradYear` (timeline.md "The plan by grade"), now a map over
 * `seasonOf()` so the plan has one boundary (seasons.md: the senior fall starts on August 1, not September 1).
 * lib/planner/cycle.ts re-exports it for its existing callers.
 */
export function gradeOf(gradYear: number | null, today: string): Grade {
  return gradeForSeason(seasonOf(gradYear, today));
}
