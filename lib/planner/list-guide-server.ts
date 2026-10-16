import "server-only";
/**
 * The Build your list guide's server half (specs/planner/v3/guides/list-size.md): the list's counts against the
 * season's shape, the gaps in order, and for the open gap the colleges **like the ones already on the list** at the
 * level that's missing. Replaces the next-steps rail (lib/planner/rail-server.ts), whose candidates matched on
 * selectivity and so came back thin for a list of Reaches.
 *
 * - **Anchors**: the list's open rows (withdrawn ones out), the Dream first.
 * - **Candidates**: every college in the dataset not on the list that is alike (lib/planner/list-guide.ts `alike`)
 *   to at least one anchor, capped at `GUIDE_CANDIDATE_CAP` by best likeness, then how many anchors it is alike to,
 *   then distance from home.
 * - **Level**: `estimateMany` over the candidates with the plan's own hooks, keeping the missing level; ordered by
 *   likeness, then closeness to the level above (never shown), then distance (`rankAlike`).
 * - **Nothing alike at the level**: the colleges at that level nearest home (the built rail's idea, by distance).
 * - **Freshmen, sophomores, and an empty list**: no shape and no levels; colleges that fit the preference chips,
 *   nearest first.
 *
 * Server-only: the page's `load` (lib/planner/guides-server.ts) and POST /api/plan/list-guide call it. Nothing an
 * estimate computes leaves this module except the level: cards are `AlikeCard`s, built by `toCard`.
 */
import { getData } from "@/lib/data";
import { crestBrand } from "@/lib/brand";
import { estimateContext, estimateMany } from "@/lib/chances/estimate";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import { gradeNow } from "@/lib/chances/courses";
import type { EstimateResult, StandingLevel } from "@/lib/chances/types";
import { distanceFromHome, type LatLng } from "@/lib/home";
import { MAJOR_FAMILIES, isMajorFamily } from "@/lib/majors";
import { stateName } from "@/lib/states";
import { fitsPreferences, type StudentProfileData } from "@/lib/student-profile";
import type { School } from "@/lib/types";
import { hooksFromPlan } from "./hooks";
import {
  alike,
  chipsFromPreferences,
  excludeOverLimit,
  GUIDE_CANDIDATE_CAP,
  likeness,
  likenessSentence,
  overMaxLine,
  pageOf,
  preferenceCards,
  preferenceSentence,
  rankAlike,
  rankNearHome,
  shapeRow,
  shapeSentence,
  toCard,
  type AlikeCard,
  type GuidePageResult,
  type GuideSection,
  type ListGuideData,
  type LikenessInput,
  type LikenessResult,
  type PreferenceChips,
} from "./list-guide";
import { affordabilityFor, countLine, dreamAtHighReach, shapeFor, shapeGaps, type ShapeGapKind } from "./list-shape";
import { MOVE_TEXT } from "./moves-catalog";
import type { PlanView } from "./plan-view";
import type { PlanContext, PlanItem } from "./types";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** The gaps that offer cards, and the level each searches. The rest are informational (over_max, total_off). */
export const GAP_LEVEL: Partial<Record<ShapeGapKind, StandingLevel>> = { likely_min: "likely", affordable: "likely", target_min: "target", reach_min: "reach" };

/** What one page of cards needs (the route's query and the page's own). */
export interface GuidePageQuery {
  gap: ShapeGapKind;
  level: StandingLevel;
  offset: number;
}

/* ------------------------------------------------------------------ */
/* The dataset's slice                                                 */
/* ------------------------------------------------------------------ */

const inputCache = new WeakMap<School, LikenessInput>();

/** The slice of a school the likeness facts read (cached per school object: the dataset is read once per instance). */
export function likenessInputOf(s: School): LikenessInput {
  const hit = inputCache.get(s);
  if (hit) return hit;
  const byFamily = s.academics?.bachelors_by_family ?? null;
  const input: LikenessInput = {
    type: s.type,
    undergrad: s.demographics?.undergrad_enrollment ?? null,
    settingGroup: s.campus?.setting?.group ?? null,
    region: s.location.region || null,
    lat: s.location.lat ?? null,
    lng: s.location.lng ?? null,
    affiliation: s.religion?.affiliation ?? null,
    hbcu: s.campus?.designations?.includes("hbcu") ?? false,
    womens: s.campus?.msi?.includes("women") ?? false,
    majorFamilies: byFamily ? Object.entries(byFamily).filter(([, n]) => n > 0).map(([f]) => f) : [],
  };
  inputCache.set(s, input);
  return input;
}

/** What candidate building needs; injected so tests can run it over the real dataset with the real estimate. */
export interface GuideDeps {
  schools: readonly School[];
  byId: (unitId: string) => School | null;
  /** Quad's estimate for these colleges (the plan's own hooks already applied). */
  estimate: (unitIds: readonly string[]) => Record<string, EstimateResult>;
  home: LatLng | null;
}

export interface GuideStudent {
  /** The student's first intended major family, when set. */
  majorFamily: string | null;
  maxAverageCost: number | null;
}

interface Anchor {
  unitId: string;
  name: string;
  input: LikenessInput;
}

interface Candidate {
  school: School;
  best: LikenessResult;
  anchor: Anchor;
  anchorsAlike: number;
  distanceMiles: number | null;
}

/** Open rows, the Dream first, then the list's own order (list-size.md "Anchors"). */
export function anchorsOf(items: readonly Pick<PlanItem, "unit_id" | "dream" | "position" | "withdrawn_on">[], byId: GuideDeps["byId"]): Anchor[] {
  return items
    .filter((i) => !i.withdrawn_on)
    .sort((a, b) => Number(b.dream === true) - Number(a.dream === true) || a.position - b.position)
    .flatMap((i) => {
      const s = byId(i.unit_id);
      return s ? [{ unitId: s.unit_id, name: s.name, input: likenessInputOf(s) }] : [];
    });
}

const distanceOf = (s: School, home: LatLng | null) => (home ? distanceFromHome(s.location, home) : null);

/**
 * Every college alike to at least one anchor and not on the list, its best anchor (highest score; ties go to the
 * earlier anchor, so the Dream), capped at `GUIDE_CANDIDATE_CAP` by score, then the number of anchors it is alike to,
 * then distance from home, then name.
 */
export function alikeCandidates(deps: GuideDeps, anchors: readonly Anchor[], listed: ReadonlySet<string>, student: GuideStudent): Candidate[] {
  if (anchors.length === 0) return [];
  const majorName = student.majorFamily && isMajorFamily(student.majorFamily) ? MAJOR_FAMILIES[student.majorFamily] : null;
  const out: Candidate[] = [];
  for (const school of deps.schools) {
    if (listed.has(school.unit_id)) continue;
    const input = likenessInputOf(school);
    let best: { r: LikenessResult; anchor: Anchor } | null = null;
    let anchorsAlike = 0;
    for (const anchor of anchors) {
      const r = likeness(anchor.input, input, { majorFamily: student.majorFamily, majorName, anchorName: anchor.name });
      if (!alike(r)) continue;
      anchorsAlike++;
      if (!best || r.score > best.r.score) best = { r, anchor };
    }
    if (best) out.push({ school, best: best.r, anchor: best.anchor, anchorsAlike, distanceMiles: distanceOf(school, deps.home) });
  }
  return out
    .sort(
      (a, b) =>
        b.best.score - a.best.score ||
        b.anchorsAlike - a.anchorsAlike ||
        (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) ||
        a.school.name.localeCompare(b.school.name),
    )
    .slice(0, GUIDE_CANDIDATE_CAP);
}

/** The alike candidates and one estimate over all of them: every gap's level is read from the same pool. */
export interface AlikePool {
  pool: Candidate[];
  estimates: Record<string, EstimateResult>;
}

export function alikePool(deps: GuideDeps, anchors: readonly Anchor[], listed: ReadonlySet<string>, student: GuideStudent): AlikePool {
  const pool = alikeCandidates(deps, anchors, listed, student);
  return { pool, estimates: pool.length > 0 ? deps.estimate(pool.map((c) => c.school.unit_id)) : {} };
}

/** The pool's colleges at one gap's level, ranked (`rankAlike`); the affordability gap also drops anything over the family's limit. */
export function alikeAtLevel({ pool, estimates }: AlikePool, student: GuideStudent, q: { gap: ShapeGapKind; level: StandingLevel }): AlikeCard[] {
  const atLevel = excludeOverLimit(pool.map((c) => ({ ...c, cost: c.school.cost })), q.gap, student.maxAverageCost)
    .filter((c) => estimates[c.school.unit_id]?.group === q.level)
    .map((c) => ({
      unitId: c.school.unit_id,
      name: c.school.name,
      state: c.school.location.state ?? null,
      brand: crestBrand(c.school),
      level: q.level,
      sentence: likenessSentence(c.anchor.name, c.best),
      distanceMiles: c.distanceMiles,
      likeness: c.best.score,
      closeness: estimates[c.school.unit_id]?.closeness ?? null,
    }));
  return rankAlike(atLevel).map(toCard);
}

/** The ranked rows for one gap: alike candidates at the level, else the near-home fallback. */
export function rankedForGap(
  deps: GuideDeps,
  anchors: readonly Anchor[],
  listed: ReadonlySet<string>,
  student: GuideStudent,
  q: { gap: ShapeGapKind; level: StandingLevel },
  pool: AlikePool = alikePool(deps, anchors, listed, student),
): { rows: AlikeCard[]; fallback: boolean } {
  const rows = alikeAtLevel(pool, student, q);
  if (rows.length > 0) return { rows, fallback: false };
  return { rows: nearHome(deps, anchors, listed, student, q), fallback: true };
}

/**
 * The near-home fallback (list-size.md "Nothing alike found at L"): the colleges at the level nearest home, by
 * distance. Without a home, the colleges nearest the list's own colleges (each anchor's own neighbors), so the
 * fallback still reads as "near your list" rather than an arbitrary slice of the dataset.
 */
function nearHome(deps: GuideDeps, anchors: readonly Anchor[], listed: ReadonlySet<string>, student: GuideStudent, q: { gap: ShapeGapKind; level: StandingLevel }): AlikeCard[] {
  const open = excludeOverLimit(deps.schools.filter((s) => !listed.has(s.unit_id)), q.gap, student.maxAverageCost);
  let pool: { school: School; distanceMiles: number | null; order: number }[];
  if (deps.home) {
    pool = open.map((school) => ({ school, distanceMiles: distanceOf(school, deps.home), order: distanceOf(school, deps.home) ?? Infinity }));
  } else {
    const points = anchors.map((a) => a.input).filter((a): a is LikenessInput & { lat: number; lng: number } => typeof a.lat === "number" && typeof a.lng === "number");
    pool = open.map((school) => {
      const d = points.length > 0 ? Math.min(...points.map((p) => distanceFromHome(school.location, p) ?? Infinity)) : Infinity;
      return { school, distanceMiles: null, order: d };
    });
  }
  const nearest = pool.filter((p) => Number.isFinite(p.order)).sort((a, b) => a.order - b.order).slice(0, GUIDE_CANDIDATE_CAP);
  if (nearest.length === 0) return [];
  const estimates = deps.estimate(nearest.map((p) => p.school.unit_id));
  const rows = nearest
    .filter((p) => estimates[p.school.unit_id]?.group === q.level)
    .map((p) => ({
      unitId: p.school.unit_id,
      name: p.school.name,
      state: p.school.location.state ?? null,
      brand: crestBrand(p.school),
      level: q.level,
      sentence: "",
      distanceMiles: p.distanceMiles,
      likeness: 0,
      closeness: estimates[p.school.unit_id]?.closeness ?? null,
      order: p.order,
    }));
  // With a home, rankNearHome orders by the shown distance; without one, by distance from the list (never shown).
  const ranked = deps.home ? rankNearHome(rows) : [...rows].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return ranked.map(toCard);
}

/** The freshman view's cards: colleges that fit every set chip (the built `fitsPreferences`, "in" only), nearest first. */
export function freshmanCards(deps: Pick<GuideDeps, "schools" | "home">, listed: ReadonlySet<string>, profile: StudentProfileData | null, chips: PreferenceChips): AlikeCard[] {
  const asProfile = { ...(profile ?? ({} as StudentProfileData)), preferences: { sizes: chips.sizes, settings: chips.settings, statesOrRegions: chips.places, types: chips.types, maxAverageCost: null } } as StudentProfileData;
  const rows = deps.schools
    .filter((s) => !listed.has(s.unit_id) && fitsPreferences(s, asProfile) === "in")
    .map((s) => ({
      unitId: s.unit_id,
      name: s.name,
      state: s.location.state ?? null,
      brand: crestBrand(s),
      level: null,
      sentence: preferenceSentence(
        { undergrad: s.demographics?.undergrad_enrollment ?? null, settingGroup: s.campus?.setting?.group ?? null, state: s.location.state ?? null, region: s.location.region || null, type: s.type },
        chips,
        stateName,
      ),
      distanceMiles: distanceOf(s, deps.home),
      likeness: 0,
    }));
  return preferenceCards(rows);
}

/* ------------------------------------------------------------------ */
/* Building the deps from a plan                                       */
/* ------------------------------------------------------------------ */

/** The dataset, home, and (unless `withEstimate` is false: the freshman view needs no level) the plan's estimator. */
async function depsFor(ctx: PlanContext, withEstimate = true): Promise<GuideDeps> {
  const data = await getData();
  const base = { schools: data.getAllSchools(), byId: data.getSchoolById, home: ctx.home };
  if (!withEstimate) return { ...base, estimate: () => ({}) };
  const input = estimateInputFromProfile(ctx.profile, "", null).student;
  const estCtx = await estimateContext(input, { coreAtTopLevel: ctx.profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(ctx.gradYear, ctx.today) });
  // Plan v3 U2a adds `ctx.profile` as hooksFromPlan's third argument (connections); until it merges, the list's own hooks.
  const hooks = hooksFromPlan(ctx.items, ctx.visits, ctx.profile);
  const estimate = (ids: readonly string[]): Record<string, EstimateResult> => {
    try {
      return estimateMany(input, ids, estCtx, hooks);
    } catch (err) {
      console.error(`list guide: estimates failed: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  };
  return { ...base, estimate };
}

function studentOf(ctx: PlanContext): GuideStudent {
  return { majorFamily: ctx.profile?.plans.intendedMajors[0] ?? null, maxAverageCost: ctx.profile?.preferences.maxAverageCost ?? null };
}

const listedOf = (ctx: PlanContext) => new Set(ctx.items.map((i) => i.unit_id));
const openItems = (ctx: PlanContext) => ctx.items.filter((i) => !i.withdrawn_on);

/** Counts by level over the open rows, from the plan's own estimates (the generator's `levelCounts`). */
function levelCounts(items: readonly PlanItem[], estimates: Record<string, EstimateResult>) {
  const counts: Record<StandingLevel, number> = { high_reach: 0, reach: 0, target: 0, likely: 0, safe: 0 };
  let unsorted = 0;
  for (const i of items) {
    const g = estimates[i.unit_id]?.group ?? null;
    if (g) counts[g] += 1;
    else unsorted += 1;
  }
  return { counts, unsorted };
}

/** The freshman view applies: no shape this season, or nothing on the list to be alike to. */
export function isFreshmanView(ctx: Pick<PlanContext, "season" | "items">): boolean {
  return shapeFor(ctx.season) === null || ctx.items.every((i) => i.withdrawn_on);
}

function exploreHrefFor(ctx: PlanContext): string {
  // The built "Fits my scores" chip's navigation (components/me/ExploreFitChips.tsx: mySAT/myACT on /explore). The
  // student's own scores never ride a guardian's link (README "Shared rules": no score in a parent's view).
  if (ctx.viewer.relation !== "self" || !ctx.profile) return "/explore";
  const q = new URLSearchParams();
  if (ctx.profile.tests.satTotal !== null) q.set("mySAT", String(ctx.profile.tests.satTotal));
  if (ctx.profile.tests.actComposite !== null) q.set("myACT", String(ctx.profile.tests.actComposite));
  const s = q.toString();
  return s ? `/explore?${s}` : "/explore";
}

function sectionTitle(gap: ShapeGapKind): string {
  return MOVE_TEXT[`shape_gap:${gap}`]?.title ?? "Review the list";
}

/* ------------------------------------------------------------------ */
/* The page and the route                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything the guide page shows (build-plan.md "U3"): the counts, the shape row, the gaps in `shapeGaps`' order
 * (the affordability gap hidden while financial moves are, list-size.md "2."), the open one's first page of cards,
 * and the freshman view instead when there is no shape or no list. `query.level` opens the gap at that level (a
 * `shape_gap` move's link carries it); otherwise the first gap is open.
 */
export async function listGuideFor(ctx: PlanContext, view: PlanView, query: { level: StandingLevel | null }): Promise<ListGuideData> {
  void view; // The counts come from ctx.estimates (the same estimates view.estimates holds), over open rows only.
  const items = openItems(ctx);
  const { counts, unsorted } = levelCounts(items, ctx.estimates);
  const shape = shapeFor(ctx.season);
  const exploreHref = exploreHrefFor(ctx);
  const base = { counts, unsorted, exploreHref, overMax: [] as { unitId: string; name: string }[], overMaxLine: null as string | null };

  if (isFreshmanView(ctx)) {
    const deps = await depsFor(ctx, false).catch(() => null);
    const chips = chipsFromPreferences(ctx.profile?.preferences);
    const all = deps ? freshmanCards(deps, listedOf(ctx), ctx.profile, chips) : [];
    return {
      ...base,
      shape: null,
      row: null,
      sentence: shapeSentence("freshman"),
      countLine: null,
      gaps: [],
      openGap: null,
      sections: [],
      freshman: { chips, places: chips.places.map((p) => ({ key: p, label: placeLabel(p) })), cards: pageOf(all, 0), total: all.length },
    };
  }

  const hasDream = dreamAtHighReach(items, ctx.estimates);
  const affordability = affordabilityFor(items, ctx.schools, ctx.profile, ctx.estimates);
  const gaps = shapeGaps(counts, unsorted, ctx.season, affordability, hasDream).filter((g) => g.kind !== "affordable");
  const open = (query.level ? gaps.find((g) => GAP_LEVEL[g.kind] === query.level || g.level === query.level) : null) ?? gaps[0] ?? null;
  const dreamItem = items.find((i) => i.dream);
  const dreamLevel = dreamItem ? (ctx.estimates[dreamItem.unit_id]?.group ?? null) : null;

  const sections: GuideSection[] = gaps.map((g) => ({ gap: g.kind, level: GAP_LEVEL[g.kind] ?? null, title: sectionTitle(g.kind), cards: [], total: g.kind in GAP_LEVEL ? -1 : 0, fallback: false }));
  await fillSections(ctx, sections, open?.kind ?? null);

  const highReaches = items.filter((i) => ctx.estimates[i.unit_id]?.group === "high_reach");
  const overMaxGap = gaps.some((g) => g.kind === "over_max");
  return {
    ...base,
    shape,
    row: shapeRow(shape, counts, dreamLevel, unsorted),
    sentence: shapeSentence(ctx.season),
    countLine: countLine(counts, hasDream),
    gaps,
    openGap: open?.kind ?? null,
    sections,
    overMax: overMaxGap ? highReaches.map((i) => ({ unitId: i.unit_id, name: ctx.schools[i.unit_id]?.name ?? "A college" })) : [],
    overMaxLine: overMaxGap ? overMaxLine(highReaches.length) : null,
    freshman: null,
  };
}

/**
 * Every level section's total from one estimate over the alike pool, and the open section's first page (or, with
 * nothing alike at its level, the near-home fallback). A folded section with nothing alike keeps `total` -1: its
 * fallback is found when it is opened.
 */
async function fillSections(ctx: PlanContext, sections: GuideSection[], open: ShapeGapKind | null): Promise<void> {
  if (!sections.some((s) => s.level)) return;
  try {
    const deps = await depsFor(ctx);
    const anchors = anchorsOf(ctx.items, deps.byId);
    const listed = listedOf(ctx);
    const student = studentOf(ctx);
    const pool = alikePool(deps, anchors, listed, student);
    for (const s of sections) {
      if (!s.level) continue;
      if (s.gap === open) {
        const { rows, fallback } = rankedForGap(deps, anchors, listed, student, { gap: s.gap, level: s.level }, pool);
        Object.assign(s, { cards: pageOf(rows, 0), total: rows.length, fallback });
      } else {
        const n = alikeAtLevel(pool, student, { gap: s.gap, level: s.level }).length;
        s.total = n > 0 ? n : -1;
      }
    }
  } catch (err) {
    console.error(`list guide: cards failed: ${err instanceof Error ? err.message : String(err)}`);
    // The open section reads as "nothing found" (its links still work) rather than waiting on cards that won't come.
    for (const s of sections) if (s.gap === open && s.cards.length === 0) s.total = 0;
  }
}

/** A place chip's words: a state's name for a USPS code, else the region (or "Outside the U.S."). */
function placeLabel(p: string): string {
  if (p === "OUTSIDE_US") return "Outside the U.S.";
  return /^[A-Z]{2}$/.test(p) ? stateName(p) : p;
}

/** One page of a gap's cards (the open section on the page, "Show more" and a folded section through the route). */
export async function guidePage(ctx: PlanContext, q: GuidePageQuery): Promise<GuidePageResult> {
  try {
    const deps = await depsFor(ctx);
    const anchors = anchorsOf(ctx.items, deps.byId);
    const { rows, fallback } = rankedForGap(deps, anchors, listedOf(ctx), studentOf(ctx), q);
    return { cards: pageOf(rows, q.offset), total: rows.length, fallback };
  } catch (err) {
    console.error(`list guide: cards failed: ${err instanceof Error ? err.message : String(err)}`);
    return { cards: [], total: 0, fallback: false };
  }
}

/** One page of the freshman view's cards for a set of chips (the chips toggled on the page). */
export async function freshmanPage(ctx: PlanContext, chips: PreferenceChips, offset: number): Promise<GuidePageResult> {
  try {
    const deps = await depsFor(ctx, false);
    const all = freshmanCards(deps, listedOf(ctx), ctx.profile, chips);
    return { cards: pageOf(all, offset), total: all.length, fallback: false };
  } catch (err) {
    console.error(`list guide: freshman cards failed: ${err instanceof Error ? err.message : String(err)}`);
    return { cards: [], total: 0, fallback: false };
  }
}

/** The place chips a request may carry: the ones the profile names. */
export function allowedPlaces(ctx: PlanContext): string[] {
  return [...(ctx.profile?.preferences.statesOrRegions ?? [])];
}
