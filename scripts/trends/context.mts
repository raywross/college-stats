/**
 * What a trend builder gets (specs/national-trends.md#shared-computation-and-tests): the committed files only —
 * data/schools.json, data/history/{meta,cpi,national,facts}.json, every shard in data/history/schools/, and
 * data/detail/schools/{id}.json on request. No network, so the output is reproducible from git.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../lib/types.ts";
import type { CpiTable, HistoryMeta, NationalHistory, SchoolHistory, TrendFacts } from "../../lib/history.ts";
import type { SchoolDetail } from "../../lib/detail.ts";
import type { Member } from "../../lib/trend-panel.ts";
import type { CampusExclusionEntry } from "../../lib/movers.ts";
import type { TrendCard, TrendEnvelope } from "../../lib/trends.ts";

export interface TrendContext {
  root: string;
  /** data/schools.json, in file order. */
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
  /** The reviewed campus exclusions (data/trends/excluded-campuses.json); absent: read from `root` when needed. */
  excludedCampuses?: CampusExclusionEntry[];
}

/** One unit's output: a file for data/history/trends/{name}.json and, for a study, its /trends card. */
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

export function loadTrendContext(root: string): TrendContext {
  const data = join(root, "data");
  const history = join(data, "history");
  if (!existsSync(join(history, "meta.json"))) throw new Error("No data/history/meta.json: run npm run sync-history first.");
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
    root,
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
