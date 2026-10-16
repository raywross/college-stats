/**
 * The Build your list guide's pure parts (specs/planner/v3/guides/list-size.md): how alike two colleges are, the
 * sentence that says so, the order the cards come in, and the freshman view's preference chips. The server half
 * (lib/planner/list-guide-server.ts) reads the dataset and runs the estimate; this module never does either, so it is
 * client-safe and testable without the dataset (tests/planner-list-guide.test.mts).
 *
 * **Likeness** is six yes/no facts the owner named, one point each: control, size, setting, place, character, and
 * the student's first intended major. Selectivity is deliberately not one of them: the point of the guide is the same
 * kind of college at a different level, so nothing a college publishes about who it admits reaches `likeness`
 * (`LikenessInput` has no field for it at all). Two colleges are alike at three points, or two when the anchor has
 * fewer than four facts known (a college with no setting or region on file can't reach three as often).
 *
 * Every sentence names levels and public facts about two colleges: never a number from the estimate (no percentage,
 * no closeness, no "odds"). Closeness to the next level is passed into `rankAlike` as a number the server computed,
 * used only for the order, and never carried on a card.
 */
import type { StandingLevel } from "../chances/types.ts";
import type { SchoolType, SettingGroup, SizeBucket } from "../types.ts";
import type { Shape, ShapeGap, ShapeGapKind } from "./list-shape.ts";
import { hasAnyMappedPreference, preferencesToExploreParams } from "../explore-fit.ts";
import type { StudentProfilePreferences } from "../student-profile.ts";

/* ------------------------------------------------------------------ */
/* Size                                                                */
/* ------------------------------------------------------------------ */

/** Undergraduate size bands (list-size.md "Likeness"): under 2,000 · 2,000–5,000 · 5,000–15,000 · 15,000–30,000 · over 30,000. Each is `[min, maxExclusive)`. */
export const SIZE_BANDS: readonly (readonly [number, number])[] = [
  [0, 2000],
  [2000, 5000],
  [5000, 15000],
  [15000, 30000],
  [30000, Infinity],
];

/** The band index for an undergraduate count; null when the count is missing or zero (nothing on file). */
export function sizeBand(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return null;
  const i = SIZE_BANDS.findIndex(([min, max]) => n >= min && n < max);
  return i === -1 ? null : i;
}

/* ------------------------------------------------------------------ */
/* Likeness                                                            */
/* ------------------------------------------------------------------ */

export type LikenessFact = "control" | "size" | "setting" | "place" | "character" | "major";
/** The sentence's order: the most specific first (list-size.md). */
export const FACT_ORDER: readonly LikenessFact[] = ["character", "place", "setting", "size", "control", "major"];

/** Within this many miles of the anchor, two colleges share a place whatever their regions (owner assumption, review note 14). */
export const PLACE_MILES = 150;

/** The slice of a school each fact reads. Built on the server from `School` (`likenessInputOf`); no selectivity field, on purpose. */
export interface LikenessInput {
  type: SchoolType;
  undergrad: number | null;
  settingGroup: SettingGroup | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  /** IPEDS `RELAFFIL` (code and NCES's label); null when the college has none. */
  affiliation: { code: number; label: string } | null;
  hbcu: boolean;
  womens: boolean;
  /** Two-digit CIP families the college awards first-major bachelor's in. */
  majorFamilies: string[];
}

export interface LikenessResult {
  /** One point per fact matched. */
  score: number;
  /** The facts matched, in `FACT_ORDER`. */
  facts: LikenessFact[];
  /** How many facts the anchor has on file (or that apply to it): the few-facts exception reads this. */
  known: number;
  /** Each matched fact's words for the sentence ("also private", "near Wake Forest"). */
  phrases: Partial<Record<LikenessFact, string>>;
  /** Place matched by distance (the sentence reads "nearby") rather than by region. */
  placeByDistance: boolean;
}

const EARTH_MILES = 3958.8;
/** Great-circle miles (lib/home.ts milesBetween's formula, kept here so this module stays import-light). */
export function milesApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isPrivate = (t: SchoolType) => t !== "public";

const SETTING_PHRASE: Record<SettingGroup, string> = {
  city: "also in a city",
  town: "also a college town",
  suburb: "also suburban",
  rural: "also rural",
};

/** A region's words ("also Southeast"); the territories read as a place, not a region name. */
function regionPhrase(region: string): string {
  return region === "Territories" ? "also in the U.S. territories" : `also ${region}`;
}

/** Short words for a religious affiliation: the families people name in one word, else NCES's own label. */
const AFFILIATION_WORD: Record<number, string> = { 30: "Catholic", 80: "Jewish", 94: "Latter-day Saint" };
export function affiliationWord(a: { code: number; label: string }): string {
  return AFFILIATION_WORD[a.code] ?? a.label;
}

/** A major family's name as it reads mid-sentence ("has computer science"; "English" keeps its capital). */
export function majorWord(name: string): string {
  return /^English\b/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

function hasCoords(s: LikenessInput): s is LikenessInput & { lat: number; lng: number } {
  return typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}

/**
 * How alike `candidate` is to `anchor` (list-size.md "Likeness"), as six yes/no facts, one point each:
 * - **control**: both public, or both private (non-profit and for-profit both count as private);
 * - **size**: the same `SIZE_BANDS` band;
 * - **setting**: the same NCES locale group;
 * - **place**: the same region, or within `PLACE_MILES` of the anchor;
 * - **character**: the same religious affiliation when the anchor has one, both HBCUs, or both women's colleges;
 * - **major**: the candidate awards bachelor's in the student's first intended major family (`opts.majorFamily`).
 * A fact the anchor has nothing on file for isn't "known" and can't match; one the candidate lacks just doesn't match.
 */
export function likeness(
  anchor: LikenessInput,
  candidate: LikenessInput,
  opts: { majorFamily: string | null; majorName?: string | null; anchorName?: string },
): LikenessResult {
  const facts = new Set<LikenessFact>();
  const phrases: Partial<Record<LikenessFact, string>> = {};
  let known = 0;
  let placeByDistance = false;

  // Control: always known (every college has a type).
  known++;
  if (isPrivate(anchor.type) === isPrivate(candidate.type)) {
    facts.add("control");
    phrases.control = isPrivate(anchor.type) ? "also private" : "also public";
  }

  const aBand = sizeBand(anchor.undergrad);
  if (aBand !== null) {
    known++;
    if (sizeBand(candidate.undergrad) === aBand) {
      facts.add("size");
      phrases.size = "similar size";
    }
  }

  if (anchor.settingGroup) {
    known++;
    if (candidate.settingGroup === anchor.settingGroup) {
      facts.add("setting");
      phrases.setting = SETTING_PHRASE[anchor.settingGroup];
    }
  }

  if (anchor.region || hasCoords(anchor)) {
    known++;
    const near = hasCoords(anchor) && hasCoords(candidate) && milesApart(anchor, candidate) <= PLACE_MILES;
    if (near) {
      facts.add("place");
      placeByDistance = true;
      phrases.place = `near ${opts.anchorName ?? "it"}`;
    } else if (anchor.region && candidate.region === anchor.region) {
      facts.add("place");
      phrases.place = regionPhrase(anchor.region);
    }
  }

  if (anchor.affiliation || anchor.hbcu || anchor.womens) {
    known++;
    if (anchor.hbcu && candidate.hbcu) phrases.character = "also an HBCU";
    else if (anchor.womens && candidate.womens) phrases.character = "also a women's college";
    else if (anchor.affiliation && candidate.affiliation?.code === anchor.affiliation.code) phrases.character = `also ${affiliationWord(anchor.affiliation)}`;
    if (phrases.character) facts.add("character");
  }

  if (opts.majorFamily) {
    known++;
    if (candidate.majorFamilies.includes(opts.majorFamily)) {
      facts.add("major");
      phrases.major = `has ${majorWord(opts.majorName ?? "your major")}`;
    }
  }

  const ordered = FACT_ORDER.filter((f) => facts.has(f));
  return { score: ordered.length, facts: ordered, known, phrases, placeByDistance };
}

/** Alike at three points, or two when the anchor has fewer than four facts known (review note 14). */
export const ALIKE_POINTS = 3;
export const FEW_FACTS = 4;
export function alike(result: Pick<LikenessResult, "score" | "known">): boolean {
  return result.score >= ALIKE_POINTS || (result.known < FEW_FACTS && result.score >= ALIKE_POINTS - 1);
}

/** Facts a sentence names at most. */
export const SENTENCE_FACTS = 3;

/**
 * "Like Wake Forest: also private, similar size, also Southeast" (list-size.md "Card"): up to three matched facts,
 * most specific first. A place matched by distance reads "nearby" (the anchor is already named; "Like Wake Forest:
 * near Wake Forest" would say it twice). Public facts only; never a level, never a number.
 */
export function likenessSentence(anchorName: string, result: Pick<LikenessResult, "facts" | "phrases" | "placeByDistance">): string {
  const words = FACT_ORDER.filter((f) => result.facts.includes(f))
    .slice(0, SENTENCE_FACTS)
    .map((f) => (f === "place" && result.placeByDistance ? "nearby" : (result.phrases[f] ?? "")))
    .filter((w) => w !== "");
  return words.length > 0 ? `Like ${anchorName}: ${words.join(", ")}` : `Like ${anchorName}`;
}

/* ------------------------------------------------------------------ */
/* Cards and their order                                               */
/* ------------------------------------------------------------------ */

/** Candidates estimated at most, by best likeness (list-size.md "Candidates"). */
export const GUIDE_CANDIDATE_CAP = 200;
/** Cards a section shows at a time; "Show more" adds this many. */
export const GUIDE_PAGE = 12;

/**
 * One college card (list-size.md "Card"). No closeness and no estimate number: the level is the only thing from the
 * estimate, and it is null on the freshman view, which says nothing about levels. `likeness` is the score (0 on the
 * near-home fallback and the freshman view), for `plan_guide_added`.
 */
export interface AlikeCard {
  unitId: string;
  name: string;
  state: string | null;
  brand?: unknown;
  level: StandingLevel | null;
  sentence: string;
  distanceMiles: number | null;
  likeness: number;
}

/** What `rankAlike` orders by: the likeness score, closeness to the level above (the server's number, never shown), distance from home. */
export interface RankableAlike {
  likeness: number;
  closeness: number | null;
  distanceMiles: number | null;
  name: string;
}

/** Likeness first; ties by closeness to the level above (so a Likely nearly a Target leads); then distance from home; then name, so the order is stable. */
export function rankAlike<T extends RankableAlike>(cards: readonly T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      b.likeness - a.likeness ||
      (b.closeness ?? -1) - (a.closeness ?? -1) ||
      (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}

/** The near-home fallback's order (list-size.md "Nothing alike found"): distance from home, then closeness, then name. */
export function rankNearHome<T extends RankableAlike>(cards: readonly T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) ||
      (b.closeness ?? -1) - (a.closeness ?? -1) ||
      a.name.localeCompare(b.name),
  );
}

/** A card without the ranking-only fields: what leaves the server. */
export function toCard<T extends RankableAlike & Omit<AlikeCard, "likeness">>(r: T): AlikeCard {
  return { unitId: r.unitId, name: r.name, state: r.state, brand: r.brand, level: r.level, sentence: r.sentence, distanceMiles: r.distanceMiles, likeness: r.likeness };
}

/** One page of a ranked list. */
export function pageOf<T>(rows: readonly T[], offset: number): T[] {
  const start = Math.max(0, Math.floor(offset));
  return rows.slice(start, start + GUIDE_PAGE);
}

/** Excludes anything over the family's cost limit when the gap is affordability (the rail's rule, list-shape.md "The rail"; the gap is hidden while financial moves are). */
export function excludeOverLimit<T extends { cost?: { avg_paid_all?: number | null } | null }>(schools: readonly T[], gap: ShapeGapKind, limit: number | null): T[] {
  if (gap !== "affordable" || limit === null) return [...schools];
  return schools.filter((s) => {
    const cost = s.cost?.avg_paid_all ?? null;
    return cost === null || cost <= limit;
  });
}

/* ------------------------------------------------------------------ */
/* The freshman view: preference chips                                 */
/* ------------------------------------------------------------------ */

/** The chips the freshman view offers, pre-set from the profile's `preferences` (size, setting, states or regions, type). */
export interface PreferenceChips {
  sizes: SizeBucket[];
  settings: SettingGroup[];
  /** USPS codes, Scorecard regions, or OUTSIDE_US: only what the profile already names (there are too many to offer). */
  places: string[];
  types: SchoolType[];
}

export const SIZE_CHIPS: readonly { key: SizeBucket; label: string; word: string }[] = [
  { key: "small", label: "Small", word: "Small" },
  { key: "medium", label: "Medium", word: "Mid-sized" },
  { key: "large", label: "Large", word: "Large" },
  { key: "xl", label: "Very large", word: "Very large" },
];
export const SETTING_CHIPS: readonly { key: SettingGroup; label: string; word: string }[] = [
  { key: "city", label: "City", word: "in a city" },
  { key: "suburb", label: "Suburb", word: "suburban" },
  { key: "town", label: "Town", word: "a college town" },
  { key: "rural", label: "Rural", word: "rural" },
];
export const TYPE_CHIPS: readonly { key: SchoolType; label: string; word: string }[] = [
  { key: "public", label: "Public", word: "public" },
  { key: "private-nonprofit", label: "Private", word: "private" },
];

/** lib/student-profile.ts's size buckets (the same boundaries as lib/metrics.ts SIZE_BUCKETS). */
export function sizeBucketOf(enrollment: number): SizeBucket {
  if (enrollment < 5000) return "small";
  if (enrollment < 15000) return "medium";
  if (enrollment < 30000) return "large";
  return "xl";
}

export function chipsFromPreferences(p: { sizes: SizeBucket[]; settings: SettingGroup[]; statesOrRegions: string[]; types: SchoolType[] } | null | undefined): PreferenceChips {
  return { sizes: [...(p?.sizes ?? [])], settings: [...(p?.settings ?? [])], places: [...(p?.statesOrRegions ?? [])], types: [...(p?.types ?? [])] };
}

/** Untrusted chips (the route's body) as chips; anything unknown dropped. `places` keeps only what `allowedPlaces` lists. */
export function parseChips(v: unknown, allowedPlaces: readonly string[]): PreferenceChips | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pick = <T extends string>(x: unknown, ok: readonly T[]): T[] => (Array.isArray(x) ? [...new Set(x.filter((s): s is T => typeof s === "string" && (ok as readonly string[]).includes(s)))] : []);
  return {
    sizes: pick(o.sizes, SIZE_CHIPS.map((c) => c.key)),
    settings: pick(o.settings, SETTING_CHIPS.map((c) => c.key)),
    places: pick(o.places, allowedPlaces),
    types: pick(o.types, ["public", "private-nonprofit", "private-forprofit"] as const),
  };
}

export const noChips = (c: PreferenceChips) => c.sizes.length + c.settings.length + c.places.length + c.types.length === 0;

/** What the preference sentence reads of a college. */
export interface PreferenceInput {
  undergrad: number | null;
  settingGroup: SettingGroup | null;
  state: string | null;
  region: string | null;
  type: SchoolType;
}

/**
 * The preferences a college matched, as the card's sentence ("Mid-sized, suburban, Northeast"; list-size.md
 * "Freshmen"): only chips that are set, in the order size, setting, place, type. Empty with no chips set.
 * `placeName` turns a USPS code into its name (the server passes lib/states.ts stateName).
 */
export function preferenceSentence(s: PreferenceInput, chips: PreferenceChips, placeName: (place: string) => string = (p) => p): string {
  const words: string[] = [];
  if (chips.sizes.length > 0 && s.undergrad) {
    const b = sizeBucketOf(s.undergrad);
    if (chips.sizes.includes(b)) words.push(SIZE_CHIPS.find((c) => c.key === b)!.word);
  }
  if (chips.settings.length > 0 && s.settingGroup && chips.settings.includes(s.settingGroup)) words.push(SETTING_CHIPS.find((c) => c.key === s.settingGroup)!.word);
  if (chips.places.length > 0) {
    if (s.state && chips.places.includes(s.state)) words.push(placeName(s.state));
    else if (s.region && chips.places.includes(s.region)) words.push(s.region);
  }
  if (chips.types.length > 0 && chips.types.includes(s.type)) words.push(s.type === "public" ? "public" : "private");
  if (words.length === 0) return "";
  const out = words.join(", ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The freshman view's order (list-size.md "Freshmen"): distance from home, nearest first (unknown distance last), then name. */
export function preferenceCards<T extends { distanceMiles: number | null; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* The page's words                                                    */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** "Three" for 3 (sentence start); the digits past ten. */
export function countWord(n: number): string {
  return n >= 1 && n <= 10 ? NUMBER_WORDS[n] : String(n);
}

/**
 * The over-maximum reading (list-size.md "The shape"): "Three High reaches crowd out colleges you'd get into; which
 * would you drop?" The colleges are named beside it by the page, each linked to its profile; nothing is removed.
 */
export function overMaxLine(highReaches: number): string {
  return `${countWord(highReaches)} High reaches crowd out colleges you'd get into; which would you drop?`;
}

/** The unsorted section's line: "2 colleges aren't sorted yet: add your numbers". */
export function unsortedSectionLine(n: number): string {
  return n === 1 ? "One college isn't sorted yet: add your numbers" : `${countWord(n)} colleges aren't sorted yet: add your numbers`;
}

/** "Quad didn't find a Likely much like your list. These are Likely for you near home:" (list-size.md). */
export function nothingAlikeLine(levelLabel: string, hasHome: boolean): string {
  return hasHome
    ? `Quad didn't find a ${levelLabel} much like your list. These are ${levelLabel} for you near home:`
    : `Quad didn't find a ${levelLabel} much like your list. These are ${levelLabel} for you:`;
}

/** The distance on a card: "140 mi from home". */
export function distanceText(miles: number): string {
  return `${Math.round(miles).toLocaleString("en-US")} mi from home`;
}

/**
 * "Why this shape" (list-size.md "1. The shape"): the advisor consensus in plain words, cited by name to the research
 * the next-steps specs summarize (specs/planner/next-steps/README.md "Research (2026-10-13)"). Never a percentage;
 * the level meanings that follow it come from the estimate's note catalog (lib/chances/notes.ts), not from here.
 */
export const SHAPE_EXPLAINER: readonly { heading: string; text: string }[] = [
  {
    heading: "Two Likelies you'd be happy at",
    text: "Every source we read now says the same thing first: at least two colleges where you're Likely or Safe that you would happily attend, not ones added only to be safe. Several add that one of them should be a college your family can afford.",
  },
  {
    heading: "One or two High reaches is plenty",
    text: "A High reach is worth applying to when you love it. More than two crowd out the colleges you'd get into: each one asks for its own essays, fees, and time in the fall of senior year.",
  },
  {
    heading: "12–15, not twenty-five",
    text: "Advisors' lists run from about eight to fifteen colleges. Common App's own average is about seven applications per applicant. Past fifteen, the essays for each college get thinner, and a longer list rarely adds a college you'd choose.",
  },
  {
    heading: "Juniors keep a longer list",
    text: "In junior fall and winter the list is for visiting and cutting, so it runs longer: 15–20, with at least three Likely or Safe among them. It settles to the senior shape by August.",
  },
];

/** The sources the explainer names (next-steps README "Research (2026-10-13)", "The balanced list"). */
export const SHAPE_EXPLAINER_SOURCES =
  "From the advisor guidance Quad's planner is built on: College Board, CollegeVine, Scoir, IvyWise, College Transitions, College Kickstart, and Common App's own application counts.";

/* ------------------------------------------------------------------ */
/* The shape row                                                       */
/* ------------------------------------------------------------------ */

/**
 * One box in the shape row (list-size.md "1. The shape"): `filled` a college at this level, `dream` the Dream (drawn
 * in the Dream's color), `overflow` a college past the level's maximum (a muted tint past the outline), `need` an
 * outlined box up to the minimum, `room` a lighter outlined box between the minimum and the maximum.
 */
export type ShapeSlot = "filled" | "dream" | "overflow" | "need" | "room";

export interface ShapeLevelRow {
  level: StandingLevel;
  /** The level's range this season, or null (the junior long list bounds only the total). */
  range: readonly [number, number] | null;
  count: number;
  slots: ShapeSlot[];
  /** "5–8 · you 2" or "you 2". */
  countText: string;
}

export interface ShapeRowView {
  levels: ShapeLevelRow[];
  total: { range: readonly [number, number] | null; count: number; text: string };
}

const SHAPE_LEVELS: readonly StandingLevel[] = ["high_reach", "reach", "target", "likely", "safe"];

/**
 * The slot row for a shape and the list's counts. `dreamLevel` is the Dream's level (its box is the first one at that
 * level). `unsorted` counts toward the total only. Null shape (freshmen, sophomores) has no row.
 */
export function shapeRow(
  shape: { total: readonly [number, number]; levels: Partial<Record<StandingLevel, readonly [number, number]>> } | null,
  counts: Record<StandingLevel, number>,
  dreamLevel: StandingLevel | null,
  unsorted = 0,
): ShapeRowView | null {
  if (!shape) return null;
  const levels = SHAPE_LEVELS.map((level): ShapeLevelRow => {
    const range = shape.levels[level] ?? null;
    const count = counts[level];
    const n = Math.max(count, range ? range[1] : 0);
    const slots: ShapeSlot[] = [];
    for (let i = 0; i < n; i++) {
      if (i < count) slots.push(dreamLevel === level && i === 0 ? "dream" : range && i >= range[1] ? "overflow" : "filled");
      else slots.push(range && i < range[0] ? "need" : "room");
    }
    return { level, range, count, slots, countText: range ? `${range[0]}–${range[1]} · you ${count}` : `you ${count}` };
  });
  const count = SHAPE_LEVELS.reduce((s, l) => s + counts[l], 0) + unsorted;
  return { levels, total: { range: shape.total, count, text: `${shape.total[0]}–${shape.total[1]} in all · you ${count}` } };
}

/* ------------------------------------------------------------------ */
/* "Show me more" (specs/planner/record/explore-levels.md)             */
/* ------------------------------------------------------------------ */

/**
 * Explore at one level for the plan's student, narrowed by the record's preferences as Explore's own params
 * (lib/explore-fit.ts preferencesToExploreParams: sizes, setting, states, types, maxCost): `/explore?forMe=target&
 * sizes=medium&setting=suburban`. With no preferences the link carries only `forMe`.
 */
export function showMoreHref(level: StandingLevel, preferences: StudentProfilePreferences | null | undefined): string {
  const q = new URLSearchParams({ forMe: level });
  if (preferences) for (const [k, v] of Object.entries(preferencesToExploreParams(preferences).params)) if (v !== null) q.set(k, v);
  return `/explore?${q.toString()}`;
}

export interface ShowMoreLink {
  href: string;
  /** Below the shape's minimum at this level: the link is the filled, primary one. A level with no range is quiet. */
  emphasized: boolean;
}

/** One "Show me more" link per level of the shape row, emphasized where the count is below the level's minimum. */
export function showMoreLinks(row: ShapeRowView, preferences: StudentProfilePreferences | null | undefined): Record<StandingLevel, ShowMoreLink> {
  const out = {} as Record<StandingLevel, ShowMoreLink>;
  for (const l of row.levels) out[l.level] = { href: showMoreHref(l.level, preferences), emphasized: l.range !== null && l.count < l.range[0] };
  return out;
}

/** Whether the record has any preference Explore can filter by (else the table's footer line asks for one). */
export function hasExplorePreferences(preferences: StudentProfilePreferences | null | undefined): boolean {
  return !!preferences && hasAnyMappedPreference(preferencesToExploreParams(preferences));
}

/** The footer line under the shape table when the record has no preferences (explore-levels.md). */
export const NO_PREFERENCES_LINE = "Add where you'd go to your record and these show colleges that fit it too";

/** The season's sentence under the row (list-size.md "1. The shape"). */
export function shapeSentence(season: string): string {
  switch (season) {
    case "junior_fall":
    case "junior_winter":
      return "15–20 to visit and cut, with at least three Likely or Safe among them.";
    case "junior_spring":
    case "summer_before_senior":
      return "The senior shape: aim for it by August. Until then a longer list to visit and cut is fine.";
    case "senior_fall":
    case "senior_winter":
    case "senior_spring":
      return "The shape advisors aim for when you apply.";
    default:
      return "A long list of places that interest you; sorting comes in junior year.";
  }
}

/* ------------------------------------------------------------------ */
/* What the server sends the page (lib/planner/list-guide-server.ts)   */
/* ------------------------------------------------------------------ */

export interface GuideSection {
  gap: ShapeGapKind;
  /** The level the section's cards are at; null for an informational gap. */
  level: StandingLevel | null;
  title: string;
  /** Cards for the open section only; `[]` for the folded ones until they're opened. */
  cards: AlikeCard[];
  /** How many cards there are in all; -1 while unknown (a folded section). */
  total: number;
  /** True when nothing alike was found at the level and the cards are the near-home fallback. */
  fallback: boolean;
}

export interface FreshmanView {
  chips: PreferenceChips;
  /** The place chips the profile names, with their words ("North Carolina", "Northeast"). */
  places: { key: string; label: string }[];
  cards: AlikeCard[];
  total: number;
}

export interface ListGuideData {
  counts: Record<StandingLevel, number>;
  unsorted: number;
  shape: Shape | null;
  row: ShapeRowView | null;
  /** The season's sentence under the row. */
  sentence: string;
  /** "Your list has 3 Reaches, 2 Targets, and no Likely yet."; null on the freshman view. */
  countLine: string | null;
  gaps: ShapeGap[];
  openGap: ShapeGapKind | null;
  sections: GuideSection[];
  /** The High reaches, named, when the over-maximum gap is open (each links to its profile). */
  overMax: { unitId: string; name: string }[];
  overMaxLine: string | null;
  freshman: FreshmanView | null;
  /** The built "Fits my scores" navigation: Explore with the student's own scores; plain Explore for a guardian. */
  exploreHref: string;
}

export interface GuidePageResult {
  cards: AlikeCard[];
  total: number;
  fallback: boolean;
}

/**
 * Which section the guide shows open right after the server's `load` runs again (list-size.md "Card": "advances
 * the open section to the next gap when this one is filled"). Pure: `ListGuide.tsx` calls this with the fresh
 * page's `openGap` both on first load and after a refresh, so the open section always matches what the server
 * just computed — never a client guess about whether an add closed the previous gap.
 */
export function openSectionsFor(openGap: ShapeGapKind | null): ReadonlySet<ShapeGapKind> {
  return new Set(openGap ? [openGap] : []);
}

