/**
 * What a trend builder gets (specs/national-trends.md#shared-computation-and-tests): the colleges, the shared history
 * (meta, cpi, national, facts), every college's history, and its detail on request — from the publisher's compose
 * (`trendContextFrom`), the bundled copy (`loadBundledTrendContext`), or a folder in the old data/ layout
 * (`loadTrendContext`). No network, so the output is reproducible.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../lib/types.ts";
import type { CpiTable, HistoryMeta, NationalHistory, SchoolHistory, TrendFacts } from "../../lib/history.ts";
import type { SchoolDetail } from "../../lib/detail.ts";
import type { Member } from "../../lib/trend-panel.ts";
import type { CampusExclusionEntry } from "../../lib/movers.ts";
import type { TrendCard, TrendEnvelope } from "../../lib/trends.ts";
import { bundledHistoryUnits, readBundledColleges, readBundledJson, readBundledReference, requireBundled } from "../lib/data-platform/bundled.mts";

export interface TrendContext {
  root: string;
  /** The colleges, in dataset order. */
  schools: School[];
  byId: ReadonlyMap<string, School>;
  /** Every college with a history shard, by unit ID (string order), paired with today's snapshot. */
  members: Member[];
  hmeta: HistoryMeta;
  cpi: CpiTable;
  national: NationalHistory;
  facts: TrendFacts;
  /** A college's detail file (home states, …), or null. Read on demand and cached. */
  detail: (unitId: string) => SchoolDetail | null;
  /** The reviewed campus exclusions (the reference document `excluded-campuses`); absent: read from `root` (an old-layout folder) when needed. */
  excludedCampuses?: CampusExclusionEntry[];
}

/** One unit's output: a trend file (`trends/{name}.json` in a snapshot) and, for a study, its /trends card. */
export interface TrendOutput {
  name: string;
  file: TrendEnvelope;
  card?: TrendCard;
}

/** A unit's builder, registered in scripts/trends/index.mts. */
export interface TrendBuilder {
  /** The output file's name (a study's slug, "movers", …). */
  name: string;
  build: (ctx: TrendContext) => TrendOutput;
}

const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** The context from a folder in the old data/ layout a caller names (`dataDir`: schools.json, history/, detail/schools/, trends/). */
export function loadTrendContext(dataDir: string): TrendContext {
  const data = dataDir;
  const history = join(data, "history");
  if (!existsSync(join(history, "meta.json"))) throw new Error(`No history/meta.json under ${dataDir}`);
  const schools = readJson<School[]>(join(data, "schools.json"));
  const ids = new Set(schools.map((s) => s.unit_id));
  const histories = new Map(
    readdirSync(join(history, "schools"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .filter((id) => ids.has(id))
      .map((id) => [id, readJson<SchoolHistory>(join(history, "schools", `${id}.json`))] as const)
  );
  return trendContextFrom({
    root: dataDir,
    schools,
    histories,
    hmeta: readJson(join(history, "meta.json")),
    cpi: readJson(join(history, "cpi.json")),
    national: readJson(join(history, "national.json")),
    facts: readJson(join(history, "facts.json")),
    detail: (id) => {
      const p = join(data, "detail", "schools", `${id}.json`);
      return existsSync(p) ? readJson<SchoolDetail>(p) : null;
    },
  });
}

/**
 * The context from a snapshot folder in the bundled layout (default the bundled copy, `.data/snapshot/`): its colleges,
 * `history/<unit>.json` and `history/shared.json`, `detail/<unit>.json`, and the reference document
 * `excluded-campuses`. What `npm run build-trends` reads for a local look at the trend files.
 */
export function loadBundledTrendContext(dir?: string): TrendContext {
  const snapshot = requireBundled(dir);
  const schools = readBundledColleges(dir);
  const shared = readBundledJson<{ meta: HistoryMeta; national: NationalHistory; facts: TrendFacts; cpi: CpiTable }>(join("history", "shared.json"), dir);
  const ids = new Set(schools.map((s) => s.unit_id));
  const histories = new Map(bundledHistoryUnits(dir).filter((id) => ids.has(id)).map((id) => [id, readJson<SchoolHistory>(join(snapshot, "history", `${id}.json`))] as const));
  return trendContextFrom({
    root: snapshot,
    schools,
    histories,
    hmeta: shared.meta,
    cpi: shared.cpi,
    national: shared.national,
    facts: shared.facts,
    detail: (id) => {
      const p = join(snapshot, "detail", `${id}.json`);
      return existsSync(p) ? readJson<SchoolDetail>(p) : null;
    },
    excludedCampuses: readBundledReference<CampusExclusionEntry[]>("excluded-campuses", dir),
  });
}

/**
 * The same context from values in memory (the publisher composes the colleges and reads the history layer;
 * scripts/lib/data-platform/compose.mts): members are the colleges with a history, by unit ID (string order).
 * `detail` is called at most once per college.
 */
export function trendContextFrom(inputs: {
  root: string;
  schools: School[];
  histories: ReadonlyMap<string, SchoolHistory>;
  hmeta: HistoryMeta;
  cpi: CpiTable;
  national: NationalHistory;
  facts: TrendFacts;
  detail: (unitId: string) => SchoolDetail | null;
  excludedCampuses?: CampusExclusionEntry[];
}): TrendContext {
  const byId = new Map(inputs.schools.map((s) => [s.unit_id, s]));
  const members: Member[] = [...inputs.histories.keys()]
    .filter((id) => byId.has(id))
    .sort()
    .map((id) => ({ school: byId.get(id)!, h: inputs.histories.get(id)! }));
  const details = new Map<string, SchoolDetail | null>();
  return {
    root: inputs.root,
    schools: inputs.schools,
    byId,
    members,
    hmeta: inputs.hmeta,
    cpi: inputs.cpi,
    national: inputs.national,
    facts: inputs.facts,
    detail: (id) => {
      if (!details.has(id)) details.set(id, inputs.detail(id));
      return details.get(id)!;
    },
    ...(inputs.excludedCampuses ? { excludedCampuses: inputs.excludedCampuses } : {}),
  };
}
