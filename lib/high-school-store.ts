/**
 * High school files on disk (data/high-schools/, or the directory in HIGH_SCHOOLS_DIR): readers shared by the app's
 * json mode (lib/high-schools.ts), check:lineage, publish-high-schools, the syncs, and tests. Plain Node module (node:fs, no
 * Next.js or server-only imports) so scripts and tests load it directly.
 *
 *   const store = createJsonHighSchoolStore(highSchoolsDir());
 *   const view = store.getHighSchool("060000000001");
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
  HighSchool,
  HighSchoolDetail,
  HighSchoolHit,
  HighSchoolMeta,
  HighSchoolShard,
  HighSchoolStateFile,
  HighSchoolView,
  StateMedians,
} from "./high-school-types";
import { buildHighSchoolView, isHighSchoolId, mergeStateReport, searchRows, stateOfHighSchoolId } from "./high-school-core.ts";

/** data/high-schools under the working directory, or HIGH_SCHOOLS_DIR (absolute, or relative to the working directory). */
export function highSchoolsDir(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  const dir = env.HIGH_SCHOOLS_DIR?.trim();
  if (!dir) return join(cwd, "data", "high-schools");
  return isAbsolute(dir) ? dir : join(cwd, dir);
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []);

export function readHsMeta(dir: string): HighSchoolMeta | null {
  return readJson(join(dir, "meta.json"));
}

export function readHsMedians(dir: string): StateMedians | null {
  return readJson(join(dir, "medians.json"));
}

/** One state's shard (uppercase USPS), or null. */
export function readShard(dir: string, usps: string): HighSchoolShard | null {
  if (!/^[A-Z]{2}$/.test(usps)) return null;
  return readJson(join(dir, "schools", `${usps}.json`));
}

/** Every shard with its file name, sorted by file name. */
export function readAllShards(dir: string): { file: string; shard: HighSchoolShard }[] {
  return jsonFiles(join(dir, "schools")).map((file) => ({ file, shard: readJson<HighSchoolShard>(join(dir, "schools", file))! }));
}

/** Every state report file with its file name. */
export function readStateFiles(dir: string): { file: string; data: HighSchoolStateFile }[] {
  return jsonFiles(join(dir, "state")).map((file) => ({ file, data: readJson<HighSchoolStateFile>(join(dir, "state", file))! }));
}

export function readHsDetail(dir: string, id: string): HighSchoolDetail | null {
  if (!isHighSchoolId(id)) return null;
  return readJson(join(dir, "detail", `${id}.json`));
}

/** Every detail file with its file name. */
export function readAllHsDetails(dir: string): { file: string; data: HighSchoolDetail }[] {
  return jsonFiles(join(dir, "detail")).map((file) => ({ file, data: readJson<HighSchoolDetail>(join(dir, "detail", file))! }));
}

export interface HighSchoolStore {
  getHighSchool(id: string): HighSchoolView | null;
  searchHighSchools(opts: { q: string; state?: string | null; kind?: HighSchool["kind"] | null; limit?: number }): HighSchoolHit[];
  getHighSchoolMeta(): HighSchoolMeta | null;
  getStateMedians(state: string): StateMedians[string] | null;
}

/**
 * A store over one directory. Shards load lazily, one state at a time, and stay in memory (fine for dev and tests; in
 * production the app reads Supabase). A private school's id doesn't name its state, so looking one up loads every shard.
 */
export function createJsonHighSchoolStore(dir: string): HighSchoolStore {
  const shards = new Map<string, Map<string, HighSchool>>();
  let all: Map<string, HighSchool> | null = null;
  let stateFiles: HighSchoolStateFile[] | null = null;
  let meta: HighSchoolMeta | null | undefined;
  let medians: StateMedians | null | undefined;

  const shard = (usps: string) => {
    let m = shards.get(usps);
    if (!m) shards.set(usps, (m = new Map((readShard(dir, usps)?.schools ?? []).map((r) => [r.id, r]))));
    return m;
  };
  const everyRow = () => {
    if (!all) {
      all = new Map();
      for (const { shard: s } of readAllShards(dir)) {
        const m = new Map(s.schools.map((r) => [r.id, r]));
        shards.set(s.state, m);
        for (const [id, r] of m) all.set(id, r);
      }
    }
    return all;
  };
  const getMeta = () => (meta === undefined ? (meta = readHsMeta(dir)) : meta);
  const getMedians = () => (medians === undefined ? (medians = readHsMedians(dir)) : medians);
  const getStateFiles = () => (stateFiles ??= readStateFiles(dir).map((f) => f.data));

  return {
    getHighSchool(id) {
      if (!isHighSchoolId(id)) return null;
      const m = getMeta();
      if (!m) return null;
      const state = stateOfHighSchoolId(id);
      const row = state ? shard(state).get(id) : everyRow().get(id);
      if (!row) return null;
      return buildHighSchoolView(row, { stateReport: mergeStateReport(row, getStateFiles()), detail: readHsDetail(dir, id), medians: getMedians(), meta: m });
    },
    searchHighSchools(opts) {
      const st = opts.state?.toUpperCase();
      const rows = st && /^[A-Z]{2}$/.test(st) ? shard(st).values() : everyRow().values();
      return searchRows(rows, opts);
    },
    getHighSchoolMeta: getMeta,
    getStateMedians(state) {
      return getMedians()?.[state.toUpperCase()] ?? null;
    },
  };
}
