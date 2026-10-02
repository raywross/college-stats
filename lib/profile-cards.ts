/**
 * The overview's topic cards (specs/profile-redesign.md#overview-page): what each card says in its title and footer,
 * the chips it picks from the college, and the ten-year lines under the cards. Pure (runtime imports only from other
 * pure modules, by extension), so tests load it directly; the card components add the citations and layout.
 */
import type { School } from "./types";
import type { TopicKey } from "./profile-topics";
import type { FieldPath } from "./fields";
import type { TermKey } from "./glossary";
import {
  SERIES,
  changeOver,
  defaultWindow,
  diversityIndexAt,
  formatChange,
  historyYearLabel,
  inDollarsOf,
  isTinyBase,
  valueAt,
  type Change,
  type CpiTable,
  type HistoryMeta,
  type SchoolHistory,
  type SeriesKey,
  type YearKind,
} from "./history.ts";
import { formatBy, type FormatKind } from "./format.ts";
import { SETTING_SHORT } from "./campus-profile.ts";
import { DIVISION_SHORT, divisionFilterOf } from "./campus-services.ts";

/** Footer link text, the whole card's destination spelled out (the mockup's wording). */
export const CARD_FOOTERS: Record<TopicKey, string> = {
  admissions: "Getting in, in detail: funnel, what they look at, your scores",
  students: "Students and campus life in detail",
  academics: "All majors with search, earnings by major, and faculty",
  cost: "Prices, who gets aid, and borrowing in detail",
  outcomes: "Earnings, finishing, 8-year outcomes, by group",
  history: "Every series, year by year",
};

/** Card titles; the admissions card's comes from `admissionsTitle`. */
export const CARD_TITLES: Record<Exclude<TopicKey, "admissions">, string> = {
  students: "Who's on campus",
  academics: "Majors and faculty",
  cost: "What it costs",
  outcomes: "What it pays",
  history: "How it's changed",
};

/** "1 in 27 applicants admitted" / "6 in 10 applicants admitted" from `admitRatio`, or "Getting in" without a rate. */
export function admissionsTitle(ratio: string | null): string {
  return ratio ? `${ratio} applicants admitted` : "Getting in";
}

export interface CardChip {
  label: string;
  /** The value the chip reads, for its (i) citation. */
  field: FieldPath;
  term: TermKey;
}

/** The students card's campus chips: setting, the live-on rule, athletics, and programs, each with its field. */
export function campusChips(s: Pick<School, "campus">): CardChip[] {
  const c = s.campus;
  const out: CardChip[] = [];
  if (c?.setting) out.push({ label: SETTING_SHORT[c.setting.locale] ?? c.setting.label, field: "campus.setting", term: "locale" });
  const h = c?.housing;
  if (h?.first_years_required) out.push({ label: "First-years live on campus", field: "campus.housing", term: "live-on-requirement" });
  else if (h && !h.offered) out.push({ label: "No college housing", field: "campus.housing", term: "housing-capacity" });
  const a = c?.athletics;
  if (a) {
    const division = divisionFilterOf(s);
    const level = division === null ? null : division === "naia" ? "NAIA" : `NCAA ${DIVISION_SHORT[division]}`;
    const label = [level, a.conference?.name].filter((x): x is string => !!x).join(" · ");
    if (label) out.push({ label, field: "campus.athletics", term: "ncaa-division" });
  }
  const p = c?.programs;
  if (p?.rotc.length) out.push({ label: "ROTC", field: "campus.programs", term: "rotc" });
  if (p?.study_abroad) out.push({ label: "Study abroad", field: "campus.programs", term: "study-abroad" });
  if (p?.undergrad_research) out.push({ label: "Undergrad research", field: "campus.programs", term: "undergrad-research" });
  return out;
}

/** The family-income band the cost card shows beside full price and net price with grants ($48–75K: INCOME_BANDS[2]). */
export const MIDDLE_INCOME_BAND = 2;

export function middleBand(byIncome: readonly (number | null)[] | null | undefined): number | null {
  return byIncome?.[MIDDLE_INCOME_BAND] ?? null;
}

/** "since fall 2014", "since 2013–14", "since the class that entered fall 2014". */
export function sinceLabel(year: number, kind: YearKind): string {
  if (kind === "cohort") return `since the class that entered fall ${year}`;
  const label = historyYearLabel(year, kind);
  return `since ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** The history files a ten-year line needs: the default window and the inflation table. */
export type TenYearFiles = { meta: Pick<HistoryMeta, "latest">; cpi: CpiTable };

/** One series over the default ten-year window: the change in words and the values for a sparkline. */
export interface TenYear {
  key: SeriesKey;
  change: Change;
  /** "+57% since fall 2014", "+5% after inflation since 2013–14", or "6% → 4% since fall 2014" for shares and tiny bases. */
  text: string;
  /** "6% → 4%" */
  fromTo: string;
  start: number;
  kind: YearKind;
  format: FormatKind;
  /** Money in end-year dollars; null where a year is missing. */
  values: (number | null)[];
}

export function tenYear(key: SeriesKey, history: SchoolHistory, files: TenYearFiles): TenYear | null {
  const def = SERIES[key];
  const s = history.series[key];
  const window = defaultWindow(files.meta, def.kind);
  const change = changeOver(key, s, window, files.cpi);
  if (!change || !s) return null;
  const fmt = (v: number) => formatBy(def.format, v);
  const fromTo = `${fmt(change.from.value)} → ${fmt(change.to.value)}`;
  const since = sinceLabel(change.from.year, def.kind);
  const text = def.unit === "share" || isTinyBase(change) ? `${fromTo} ${since}` : `${formatChange(change)}${def.unit === "usd" ? " after inflation" : ""} ${since}`;
  const shown = inDollarsOf(s, def.unit, files.cpi, window[1]);
  return {
    key,
    change,
    text,
    fromTo,
    start: window[0],
    kind: def.kind,
    format: def.format,
    values: Array.from({ length: window[1] - window[0] + 1 }, (_, i) => valueAt(shown, window[0] + i)),
  };
}

/** The diversity index each fall of the default window, for the sparkline; null when no fall has it. */
export function diversityValues(history: SchoolHistory, files: Pick<TenYearFiles, "meta">): { start: number; values: (number | null)[] } | null {
  const [start, end] = defaultWindow(files.meta, "fall");
  const values = Array.from({ length: end - start + 1 }, (_, i) => diversityIndexAt(history, start + i));
  return values.some((v) => v !== null) ? { start, values } : null;
}
