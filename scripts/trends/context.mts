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
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  const members: Member[] = readdirSync(join(history, "schools"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .filter((id) => byId.has(id))
    .sort()
    .map((id) => ({ school: byId.get(id)!, h: readJson<SchoolHistory>(join(history, "schools", `${id}.json`)) }));
  const details = new Map<string, SchoolDetail | null>();
  return {
    root,
    schools,
    byId,
    members,
    hmeta: readJson(join(history, "meta.json")),
    cpi: readJson(join(history, "cpi.json")),
    national: readJson(join(history, "national.json")),
    facts: readJson(join(history, "facts.json")),
    detail: (id) => {
      if (!details.has(id)) {
        const p = join(data, "detail", "schools", `${id}.json`);
        details.set(id, existsSync(p) ? readJson<SchoolDetail>(p) : null);
      }
      return details.get(id)!;
    },
  };
}
