/**
 * Biggest movers (specs/trends/top-10-lists.md): every list in lib/movers.ts over every college with a history shard,
 * for each window (10 and 5 years), into data/history/trends/movers.json. The reviewed exclusion files live in
 * data/trends/ (online-first.json, excluded-campuses.json) and are read here, so the build stays offline.
 *
 * Conference and state builders call `moversFor(ctx, theirMembers)` for per-group lists with the same rules.
 *
 * The build prints a candidate report for review: ranked colleges (top 25) whose undergraduate count moved more than
 * 3× over the window and aren't on either exclusion list yet: usually a merger, a split, or an online program.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { valueAt } from "../../lib/history.ts";
import {
  JUMP_FACTOR,
  MOVER_LISTS,
  MOVER_WINDOWS,
  MOVERS_KEPT,
  MOVERS_SHOWN,
  STILL_OPEN_MIN_UNDERGRADS,
  computeMovers,
  exclusionSets,
  type CampusExclusionEntry,
  type ExclusionEntry,
  type MoverContext,
  type MoverListDef,
  type MoverMember,
  type MoverWindow,
} from "../../lib/movers.ts";
import type { MoversFile, MoversWindow } from "../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "./context.mts";

const NAME = "movers";

export const ONLINE_FIRST_FILE = join("data", "trends", "online-first.json");
export const EXCLUDED_CAMPUSES_FILE = join("data", "trends", "excluded-campuses.json");

/** The two reviewed exclusion files. */
export function loadMoverExclusions(root: string): { onlineFirst: ExclusionEntry[]; campuses: CampusExclusionEntry[] } {
  const read = <T,>(p: string) => JSON.parse(readFileSync(join(root, p), "utf8")) as T;
  return { onlineFirst: read<ExclusionEntry[]>(ONLINE_FIRST_FILE), campuses: read<CampusExclusionEntry[]>(EXCLUDED_CAMPUSES_FILE) };
}

/** The ranking context for a trend build: inflation, newest years, and the reviewed exclusions. */
export function moverContext(ctx: TrendContext): MoverContext {
  const ex = loadMoverExclusions(ctx.root);
  return { cpi: ctx.cpi, latest: ctx.hmeta.latest, exclusions: exclusionSets(ex.onlineFirst, ex.campuses) };
}

/**
 * Every list (or the ones given) for every window over `members`: what conference and state pages call with their
 * group's members, e.g. `moversFor(ctx, members, ["applications-surged", "grew-most", "pay-less"], [10], 10)`.
 */
export function moversFor(
  ctx: TrendContext,
  members: readonly MoverMember[],
  lists: readonly MoverListDef["key"][] = MOVER_LISTS.map((l) => l.key),
  windows: readonly MoverWindow[] = MOVER_WINDOWS,
  keep = MOVERS_KEPT,
  mctx: MoverContext = moverContext(ctx)
): MoversWindow[] {
  const defs = lists.map((k) => MOVER_LISTS.find((l) => l.key === k)! as MoverListDef);
  return windows.map((years) => ({ years, lists: defs.map((def) => computeMovers(members, def, years, mctx, keep)) }));
}

/** Ranked colleges whose undergraduates moved more than 3× between the change's two years and aren't reviewed yet. */
export function moverCandidates(ctx: TrendContext, windows: readonly MoversWindow[], mctx: MoverContext): string[] {
  const out = new Set<string>();
  const byId = new Map(ctx.members.map((m) => [m.school.unit_id, m]));
  for (const w of windows) {
    for (const list of w.lists) {
      for (const e of list.entries) {
        if (mctx.exclusions.campuses.has(e.unit_id)) continue;
        const m = byId.get(e.unit_id)!;
        const a = valueAt(m.h.series.undergrads, e.since);
        const b = valueAt(m.h.series.undergrads, list.to);
        if (a && b && (b / a > JUMP_FACTOR || a / b > JUMP_FACTOR)) out.add(`${e.unit_id} ${e.name}: undergraduates ${a} → ${b} (${list.key}, ${w.years} years, rank ${e.rank})`);
      }
    }
  }
  return [...out].sort();
}

export function buildMovers(ctx: TrendContext): TrendOutput {
  const mctx = moverContext(ctx);
  const windows = moversFor(ctx, ctx.members, undefined, undefined, MOVERS_KEPT, mctx);
  const [from, to] = [ctx.hmeta.latest.fall - 10, ctx.hmeta.latest.fall];
  const file: MoversFile = {
    name: NAME,
    built: ctx.hmeta.built,
    yearKind: "fall",
    from,
    to,
    n: ctx.members.length,
    shown: MOVERS_SHOWN,
    kept: MOVERS_KEPT,
    rules: { stillOpenMinUndergrads: STILL_OPEN_MIN_UNDERGRADS, jumpFactor: JUMP_FACTOR, onlineFirst: mctx.exclusions.onlineFirst.size, excludedCampuses: mctx.exclusions.campuses.size },
    windows,
  };
  // Printed by `npm run build-trends` for review; quiet under `node --test`.
  if (!process.env.NODE_TEST_CONTEXT) {
    const candidates = moverCandidates(ctx, windows, mctx);
    console.log(`  movers: ${candidates.length} ranked college(s) whose undergraduates moved more than ${JUMP_FACTOR}× and aren't reviewed yet${candidates.length ? ":" : "."}`);
    for (const c of candidates) console.log(`    ${c}`);
  }
  return { name: NAME, file };
}

export const movers: TrendBuilder = { name: NAME, build: buildMovers };
