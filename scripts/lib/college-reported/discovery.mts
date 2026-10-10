/**
 * The discovery ladder (specs/college-reported-round-3.md Decisions 6–8): a college without a working document link
 * climbs the steps cheapest first and stops at the first that finds one.
 *
 *   0 known (free)  →  1 free probes  →  2 Haiku picker  →  3 search only  →  4 full discovery   (5 manual: the owner)
 *
 * Colleges go in order of expected yield (tier, then enrollment); each tier may climb only so far; paid steps draw on a
 * run-wide dollar budget; a college whose candidate hosts all refuse us is listed for the owner and costs nothing; a
 * ladder that finds nothing sets `discovery.next_attempt` (the next 1 February, a year for open admission).
 *
 * Everything outside is injected (`LadderDeps`): steps 0–1 from ./probe.mts `freeSteps`, steps 2–4 from the models
 * track (`pickLinks`, `searchOnly`, `discover`). The ladder itself does no I/O.
 */
import type {
  BlockedHostsFile,
  CdsUrlEntry,
  DiscoveryAttempt,
  DiscoveryPath,
  Recipe,
  RecipeSource,
} from "../../../lib/reported.ts";
import type { School } from "../../../lib/types";
import { onlyBlockedCandidates, recordBlocked } from "./blocked.mts";
import { entryYearOf, linkKind, type FoundLink } from "./documents.mts";
import { tierOf, type Tier } from "./pilot.mts";
import type { Prefetched, ProbePage, StepFind } from "./probe.mts";

/* ------------------------------------------------------------------ */
/* Order, tiers, budgets (Decision 7)                                  */
/* ------------------------------------------------------------------ */

export const TIER_ORDER: readonly Tier[] = ["very selective", "selective", "less selective", "open admission"];

/** Colleges by expected yield: tier (very selective first), then undergraduate enrollment, largest first, then unit id. */
export function orderColleges<T extends School>(schools: readonly T[]): T[] {
  const rank = (s: School) => TIER_ORDER.indexOf(tierOf(s));
  const size = (s: School) => s.demographics?.undergrad_enrollment ?? 0;
  return [...schools].sort((a, b) => rank(a) - rank(b) || size(b) - size(a) || (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0));
}

export type LadderStep = 0 | 1 | 2 | 3 | 4;
export type PaidStep = 2 | 3 | 4;

/**
 * Worst-case dollars a paid step may take, held against the budget before it starts (Decision 6's estimates, upper end;
 * the pilot measures them).
 */
export const STEP_ESTIMATE_USD: Record<PaidStep, number> = { 2: 0.01, 3: 0.08, 4: 0.15 };

/**
 * The steps a tier may run. Very selective and selective: 0–4, step 4 at most once a year. Less selective: 0–3. Open
 * admission: 0–2 in the main pass; step 3 only in the leftover pass, which runs after every other tier while the
 * discovery budget has money left.
 */
export function stepsFor(tier: Tier, o: { pass?: "main" | "leftover"; fullWithinYear?: boolean } = {}): LadderStep[] {
  if (o.pass === "leftover") return tier === "open admission" ? [3] : [];
  if (tier === "open admission") return [0, 1, 2];
  if (tier === "less selective") return [0, 1, 2, 3];
  return o.fullWithinYear ? [0, 1, 2, 3] : [0, 1, 2, 3, 4];
}

/* ------------------------------------------------------------------ */
/* Back-off (Decision 7)                                               */
/* ------------------------------------------------------------------ */

/** When a ladder that found nothing (or failed) may run again: the next 1 February, or a year on for open admission. */
export function nextAttempt(tier: Tier, today: string): string {
  if (tier === "open admission") {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }
  const feb = `${today.slice(0, 4)}-02-01`;
  return today < feb ? feb : `${Number(today.slice(0, 4)) + 1}-02-01`;
}

/**
 * Whether the ladder should run for this college today (Decision 10's "later runs" row): no recipe; an owner's link the
 * recipe doesn't hold yet; else not before `discovery.next_attempt`; else a recipe with no documents, `none_found`,
 * or (from the caller) a broken index page. A working recipe is never rediscovered.
 */
export function shouldRetry(
  recipe: Recipe | undefined,
  today: string,
  o: { unitId?: string; manual?: CdsUrlEntry[]; brokenIndex?: boolean } = {}
): boolean {
  const id = recipe?.unit_id ?? o.unitId;
  const known = new Set(recipe?.sources.map((s) => s.url) ?? []);
  if (o.manual?.some((e) => e.unit_id === id && !known.has(e.url))) return true;
  if (!recipe) return true;
  const next = recipe.discovery?.next_attempt;
  if (next) return today >= next;
  return !!recipe.none_found || recipe.sources.length === 0 || !!o.brokenIndex;
}

/* ------------------------------------------------------------------ */
/* Superseded editions, and what to read after a re-discovery          */
/* ------------------------------------------------------------------ */

/**
 * Sources an index scan made obsolete: same kind, an edition older than the newest new one (UCLA's 2019–20 section H
 * once a 2025–26 link turns up, Rutgers' 2023–24). Sources whose URL names no edition are kept (we can't tell). Retired
 * sources leave the recipe so they aren't requested every run; their documents stay in the manifest and records.
 */
export function retireSuperseded(recipe: Pick<Recipe, "sources">, newSources: RecipeSource[]): { keep: RecipeSource[]; retire: RecipeSource[] } {
  const newest = new Map<string, number>();
  for (const n of newSources) {
    const y = entryYearOf(n.url);
    if (y !== null && y > (newest.get(n.kind) ?? -Infinity)) newest.set(n.kind, y);
  }
  const fresh = new Set(newSources.map((n) => n.url));
  const retire = recipe.sources.filter((s) => {
    if (fresh.has(s.url)) return false;
    const top = newest.get(s.kind);
    const y = entryYearOf(s.url);
    return top !== undefined && y !== null && y < top;
  });
  const gone = new Set(retire.map((s) => s.url));
  return { keep: recipe.sources.filter((s) => !gone.has(s.url)), retire };
}

/**
 * A recipe's CDS links that were never fetched (`fetched` says no) and that its index page doesn't list, replaced by the
 * page's link to the same edition. A model can name a file with a mistyped path (Santa Clara 2025–26: ".../fampf/..."
 * for ".../ff/..."), which answers 404 every run; the index page it found alongside lists the real one. Links the page
 * lists, links fetched before, and links naming no edition are kept.
 */
export function replaceUnlisted(sources: readonly RecipeSource[], links: readonly FoundLink[], fetched: (url: string) => boolean): { sources: RecipeSource[]; replaced: [from: string, to: string][] } {
  const listed = new Set(links.map((l) => l.url));
  const replaced: [string, string][] = [];
  const out = sources.map((s) => {
    if (s.kind !== "cds" || fetched(s.url) || listed.has(s.url)) return s;
    const year = entryYearOf(s.url);
    if (year === null) return s;
    const same = links.find((l) => linkKind(l) === "cds" && entryYearOf(`${l.url} ${l.text}`) === year && !sources.some((x) => x.url === l.url));
    if (!same) return s;
    replaced.push([s.url, same.url]);
    const format = /\.xlsx($|\?)/i.test(same.url) ? "xlsx" : "pdf";
    return { kind: "cds" as const, url: same.url, format, ...(s.anchor ? { anchor: s.anchor } : {}) } satisfies RecipeSource;
  });
  return { sources: out, replaced };
}

/**
 * After a re-discovery mid-run, the documents to (re)read: only sources this run hasn't already fetched. A document
 * read moments ago (successfully or not) is the same bytes; reading it again is the waste `pipeline.mts:527-529`
 * fixed (test 22).
 */
export function documentsToReadAfterRediscovery(fresh: Pick<Recipe, "sources">, fetchedThisRun: ReadonlySet<string>): RecipeSource[] {
  return fresh.sources.filter((s) => !fetchedThisRun.has(s.url));
}

/* ------------------------------------------------------------------ */
/* The ladder                                                          */
/* ------------------------------------------------------------------ */

export interface LadderCollege {
  school: School;
  recipe?: Recipe;
  /**
   * What an earlier free pass (`only: "free"`) already learned, for a paid pass (`only: "paid"`) in the same run: the
   * pages steps 0–1 fetched (the picker reads their links) and the hosts that answered (the blocked-host rule).
   */
  seed?: { pages: ProbePage[]; answered: string[] };
}

/** A paid step's find, with what it cost. */
export interface PaidFind extends StepFind {
  cost_usd: number;
}

export interface LadderDeps {
  /** Step 0 (./probe.mts `knownStep`, with the owner's list). */
  known: (c: LadderCollege) => Promise<StepFind>;
  /** Step 1 (./probe.mts `probeStep`). */
  probe: (c: LadderCollege) => Promise<StepFind>;
  /** Step 2: Haiku reads the link lists of the pages steps 0–1 fetched and picks the CDS index or file. */
  pickLinks?: (c: LadderCollege, pages: ProbePage[]) => Promise<PaidFind>;
  /** Step 3: Sonnet with web search only (no fetch); our code follows the candidate URLs. */
  searchOnly?: (c: LadderCollege) => Promise<PaidFind>;
  /** Step 4: round 2's full links-only discovery. */
  discover?: (c: LadderCollege) => Promise<PaidFind>;
}

export interface LadderState {
  /** ISO date of the run. */
  today: string;
  /** The run's discovery money, shared by every college; paid steps subtract what they cost. */
  budget: { remaining_usd: number };
  /** data/reference/blocked-hosts.json as it stands; the ladder merges this run's refusals into it. */
  blocked: BlockedHostsFile;
  pass?: "main" | "leftover";
  /**
   * Run only part of the ladder (the pipeline's phases, Decision 5): `free` = steps 0–1 (the prepare phase; a miss
   * sets no back-off date, since the paid steps are still to come), `paid` = steps 2–4 (the discover phase, seeded from
   * the free pass). Absent = every step the tier allows.
   */
  only?: "free" | "paid";
}

export interface LadderResult {
  /** The updated recipe, `discovery` filled in. */
  recipe: Recipe;
  path: DiscoveryPath;
  found: boolean;
  spent_usd: number;
  /** Sources an index scan superseded (for the manifest; the archive track owns it). */
  retired: RecipeSource[];
  /** When every candidate host refuses us: those hosts, and the college is listed for the owner. */
  blockedHosts: string[] | null;
  /** Documents already downloaded on the way (url → bytes), for the first read. */
  prefetched: Map<string, Prefetched>;
  /** The pages the free steps fetched and the hosts that answered (a free pass hands them to the paid pass's seed). */
  pages: ProbePage[];
  answered: string[];
}

const KEEP_TRIED = 20;
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/**
 * Runs one college up its ladder. Free steps (0, 1) count as a find only with a CDS; a paid step's find is any
 * source the model returned. Stops at the first find, a refusal by every candidate host (no money spent), a paid
 * step that fails (timeout, refusal: back off rather than climb to a dearer step), or a budget too small for the next
 * step. Mutates `state.budget` and `state.blocked`.
 */
export async function ladder(college: LadderCollege, state: LadderState, deps: LadderDeps): Promise<LadderResult> {
  const { school } = college;
  const today = state.today;
  const tier = tierOf(school);
  const base = college.recipe ? structuredClone(college.recipe) : undefined;
  const tried: DiscoveryAttempt[] = [...(base?.discovery?.tried ?? [])];
  const fullWithinYear = tried.some((t) => t.step === 4 && t.result !== "skipped" && days(t.at, today) < 365);
  const steps = stepsFor(tier, { pass: state.pass, fullWithinYear }).filter((s) => (state.only === "free" ? s <= 1 : state.only === "paid" ? s >= 2 : true));

  let sources = [...(base?.sources ?? [])];
  const index = new Set(base?.index_urls ?? []);
  const retired: RecipeSource[] = [];
  const answered = new Set<string>(college.seed?.answered ?? []);
  const pages: ProbePage[] = [...(college.seed?.pages ?? [])];
  const prefetched = new Map<string, Prefetched>();
  let spent = 0;
  let found: StepFind | null = null;
  // The first paid step that found only a class profile: the result when no later step finds a CDS.
  let profileOnly: PaidFind | null = null;
  let blockedHosts: string[] | null = null;

  const row = (step: LadderStep, result: DiscoveryAttempt["result"], detail?: string, cost = 0, via?: DiscoveryPath) =>
    tried.push({ step, ...(via ? { via } : {}), at: today, result, ...(detail ? { detail } : {}), cost_usd: Math.round(cost * 10000) / 10000 });

  const merge = (find: StepFind) => {
    const { keep, retire } = retireSuperseded({ sources }, find.sources);
    retired.push(...retire);
    const urls = new Set(keep.map((s) => s.url));
    sources = [...find.sources.filter((s) => !urls.has(s.url)), ...keep];
    for (const u of find.index_urls) index.add(u);
    for (const h of find.answered ?? []) answered.add(h);
    pages.push(...(find.pages ?? []));
    for (const [u, p] of find.prefetched ?? []) prefetched.set(u, p);
    if (find.blocked?.length) state.blocked = recordBlocked(state.blocked, find.blocked.map((b) => ({ ...b, unit_id: b.unit_id ?? school.unit_id })), today);
  };

  for (const step of steps) {
    if (step === 0 || step === 1) {
      let find: StepFind;
      try {
        find = await (step === 0 ? deps.known(college) : deps.probe(college));
      } catch (err) {
        row(step, "failed", errText(err));
        continue;
      }
      if (find.attempts?.length) for (const a of find.attempts) row(step, a.result, a.detail, 0, a.via);
      else row(step, find.sources.some((s) => s.kind === "cds") ? "found" : "none", undefined, 0, find.path);
      merge(find);
      if (find.sources.some((s) => s.kind === "cds")) {
        found = find;
        break;
      }
      continue;
    }

    const dep = step === 2 ? deps.pickLinks && ((c: LadderCollege) => deps.pickLinks!(c, pages)) : step === 3 ? deps.searchOnly : deps.discover;
    if (!dep) {
      row(step, "skipped", "step not wired");
      continue;
    }
    const refused = onlyBlockedCandidates({ recipe: { unit_id: school.unit_id, sources, index_urls: [...index], learned: today, model: "" }, answered: [...answered] }, state.blocked, today);
    if (refused) {
      blockedHosts = refused;
      row(step, "blocked", `every candidate host refuses us: ${refused.join(", ")}`);
      break;
    }
    if (state.budget.remaining_usd < STEP_ESTIMATE_USD[step]) {
      row(step, "skipped", `discovery budget spent ($${state.budget.remaining_usd.toFixed(2)} left)`);
      break;
    }
    let find: PaidFind;
    try {
      find = await dep(college);
    } catch (err) {
      row(step, "failed", errText(err));
      break;
    }
    spent += find.cost_usd;
    state.budget.remaining_usd -= find.cost_usd;
    const hit = find.sources.length > 0 && !find.none_found;
    row(step, hit ? "found" : "none", hit ? find.sources.map((s) => s.url).join(" ") : find.notes, find.cost_usd, find.path);
    merge(find);
    // Like the free steps, a paid step that found only a class profile keeps climbing toward a CDS while the tier
    // allows (the first live run stopped at an admissions page for Boston University, UC San Diego, and Arizona).
    if (hit && find.sources.some((s) => s.kind === "cds")) {
      found = find;
      break;
    }
    if (hit) profileOnly ??= find;
  }
  if (!found && profileOnly) found = profileOnly;

  const path: DiscoveryPath = found ? found.path : blockedHosts ? "blocked" : "none";
  // A free pass that missed hands over to the paid steps: no back-off date and no `none_found` yet.
  const deferred = !found && !blockedHosts && state.only === "free";
  const recipe: Recipe = {
    ...(base ?? {}),
    unit_id: school.unit_id,
    sources,
    index_urls: [...index],
    learned: found ? today : (base?.learned ?? today),
    model: found ? (found.model ?? path) : (base?.model ?? "none"),
    discovery: { path, tried: tried.slice(-KEEP_TRIED), ...(found || deferred ? {} : { next_attempt: nextAttempt(tier, today) }) },
  };
  if (found?.notes) recipe.notes = found.notes;
  if (found || sources.length) delete recipe.none_found;
  else if (!deferred) recipe.none_found = true;
  return { recipe, path, found: !!found, spent_usd: spent, retired, blockedHosts, prefetched, pages, answered: [...answered] };
}

/* ------------------------------------------------------------------ */
/* A whole run                                                         */
/* ------------------------------------------------------------------ */

export interface DiscoverAllResult {
  results: Map<string, LadderResult>;
  /** Colleges whose candidates are all blocked: for the PR body, so the owner can add links by hand. */
  listed: { unit_id: string; name: string; hosts: string[] }[];
  spent_usd: number;
}

/**
 * Every college that `shouldRetry` today, in `orderColleges` order, up its tier's steps; then, when
 * `openAdmissionLeftover` (default true, per Decision 7), open-admission colleges still without a document get step 3
 * while the budget lasts. Sequential: steps share `state.budget`, and requests to one host are paced anyway.
 */
export async function discoverAll(
  colleges: LadderCollege[],
  state: LadderState,
  deps: LadderDeps,
  o: { manual?: CdsUrlEntry[]; openAdmissionLeftover?: boolean } = {}
): Promise<DiscoverAllResult> {
  const results = new Map<string, LadderResult>();
  const byId = new Map(colleges.map((c) => [c.school.unit_id, c]));
  const ordered = orderColleges(colleges.map((c) => c.school));
  let spent = 0;
  for (const school of ordered) {
    const c = byId.get(school.unit_id)!;
    if (!shouldRetry(c.recipe, state.today, { unitId: school.unit_id, manual: o.manual })) continue;
    // The same state object throughout: the ladder updates its budget and blocked hosts in place.
    state.pass = "main";
    const r = await ladder(c, state, deps);
    spent += r.spent_usd;
    results.set(school.unit_id, r);
  }
  if (o.openAdmissionLeftover ?? true) {
    for (const school of ordered) {
      if (tierOf(school) !== "open admission") continue;
      const prev = results.get(school.unit_id);
      if (!prev || prev.found || prev.blockedHosts) continue;
      if (state.budget.remaining_usd < STEP_ESTIMATE_USD[3]) break;
      state.pass = "leftover";
      const r = await ladder({ school, recipe: prev.recipe }, state, deps);
      spent += r.spent_usd;
      results.set(school.unit_id, { ...r, retired: [...prev.retired, ...r.retired], prefetched: new Map([...prev.prefetched, ...r.prefetched]) });
    }
  }
  const listed = [...results.entries()]
    .filter(([, r]) => r.blockedHosts)
    .map(([id, r]) => ({ unit_id: id, name: byId.get(id)!.school.name, hosts: r.blockedHosts! }));
  return { results, listed, spent_usd: spent };
}
