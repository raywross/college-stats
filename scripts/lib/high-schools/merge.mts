/**
 * How adapter results become rows (pure; tested in tests/high-schools-sync.test.mts):
 *
 * 1. Start from the rows in the current shards.
 * 2. Directory adapters (CCD public, PSS private), in registry order: each returned row replaces the adapter's `owns`
 *    fields of the existing row with that id (or starts a new row); every other field keeps its current value, so a
 *    CCD rerun keeps EDFacts' and CRDC's fields. Rows of the adapter's kind it didn't return are removed.
 * 3. Enrichment adapters (EDFacts, CRDC): on every existing row of their kind, their `owns` fields come from the
 *    school's patch, or reset to null when the source didn't report the school. Patches for unknown ids are counted
 *    as unmatched and dropped; enrichment never creates rows.
 * 4. `suppressed` and `lineage` entries follow their field: entries under an adapter's owned fields are replaced by
 *    the adapter's; the rest stay.
 * 5. An adapter whose result has no `rows` / `patches` (a stub, or nothing downloaded) changes nothing.
 * Every row comes out normalized (canonical key order).
 */
import type { HighSchool, HighSchoolMeta, HsLineage, HsVintageKey } from "../../../lib/high-school-types.ts";
import { HS_VINTAGE_KEYS, blankHighSchool, normalizeHighSchool } from "../../../lib/high-school-core.ts";
import type { AdapterInfo, AdapterResult, HsOwnedKey } from "./types.mts";

export interface AdapterRun {
  info: AdapterInfo;
  result: AdapterResult;
}

export interface MergeReport {
  key: string;
  added: number;
  updated: number;
  removed: number;
  /** Enrichment: patches whose id has no row. */
  unmatched: number;
  /** Suppressed/lineage entries the adapter sent for fields it doesn't own (dropped). */
  stray: number;
  skipped: boolean;
}

const top = (path: string) => path.split(".")[0];

function splitByOwner<T>(entries: readonly [string, T][] | undefined, owns: ReadonlySet<string>) {
  const mine: [string, T][] = [];
  const rest: [string, T][] = [];
  for (const e of entries ?? []) (owns.has(top(e[0])) ? mine : rest).push(e);
  return { mine, rest };
}

/** Write an adapter's owned fields (and their suppressed/lineage entries) onto a row. */
function applyOwned(
  base: HighSchool,
  owns: readonly HsOwnedKey[],
  values: Partial<Pick<HighSchool, HsOwnedKey>>,
  suppressed: readonly string[] | undefined,
  lineage: Record<string, HsLineage> | undefined,
): { row: HighSchool; stray: number } {
  const ownSet = new Set<string>(owns);
  const next = { ...base } as Record<string, unknown>;
  for (const k of owns) next[k] = values[k] ?? null;
  const keptSup = (base.suppressed ?? []).filter((p) => !ownSet.has(top(p)));
  const newSup = splitByOwner((suppressed ?? []).map((p) => [p, true] as [string, true]), ownSet);
  const keptLin = Object.entries(base.lineage ?? {}).filter(([p]) => !ownSet.has(top(p)));
  const newLin = splitByOwner(Object.entries(lineage ?? {}), ownSet);
  const sup = [...keptSup, ...newSup.mine.map(([p]) => p)];
  const lin = [...keptLin, ...newLin.mine];
  delete next.suppressed;
  delete next.lineage;
  if (sup.length) next.suppressed = sup;
  if (lin.length) next.lineage = Object.fromEntries(lin);
  return { row: normalizeHighSchool(next as unknown as HighSchool), stray: newSup.rest.length + newLin.rest.length };
}

export function applyAdapterResults(existing: readonly HighSchool[], runs: readonly AdapterRun[]): { rows: HighSchool[]; report: MergeReport[] } {
  const rows = new Map(existing.map((r) => [r.id, r]));
  const report: MergeReport[] = [];
  const ordered = [...runs.filter((r) => r.info.role === "directory"), ...runs.filter((r) => r.info.role === "enrichment")];

  for (const { info, result } of ordered) {
    const rep: MergeReport = { key: info.key, added: 0, updated: 0, removed: 0, unmatched: 0, stray: 0, skipped: false };
    report.push(rep);
    if (info.role === "directory") {
      if (!result.rows) {
        rep.skipped = true;
        continue;
      }
      const seen = new Set<string>();
      for (const incoming of result.rows) {
        if (incoming.kind !== info.rowKind) throw new Error(`${info.key}: returned ${incoming.id} as ${incoming.kind}; it creates ${info.rowKind} rows`);
        if (seen.has(incoming.id)) throw new Error(`${info.key}: returned ${incoming.id} twice`);
        seen.add(incoming.id);
        const prev = rows.get(incoming.id);
        const base = prev ?? blankHighSchool(incoming.id, incoming.kind, incoming.name, incoming.state);
        const { row, stray } = applyOwned(base, info.owns, incoming, incoming.suppressed, incoming.lineage);
        rep.stray += stray;
        rows.set(incoming.id, row);
        if (!prev) rep.added++;
        else if (JSON.stringify(prev) !== JSON.stringify(row)) rep.updated++;
      }
      for (const [id, r] of rows) {
        if (r.kind === info.rowKind && !seen.has(id)) {
          rows.delete(id);
          rep.removed++;
        }
      }
    } else {
      if (!result.patches) {
        rep.skipped = true;
        continue;
      }
      const byId = new Map(result.patches.map((p) => [p.id, p]));
      for (const p of result.patches) if (!rows.has(p.id) || rows.get(p.id)!.kind !== info.rowKind) rep.unmatched++;
      for (const [id, prev] of rows) {
        if (prev.kind !== info.rowKind) continue;
        const patch = byId.get(id);
        const { row, stray } = applyOwned(prev, info.owns, patch?.values ?? {}, patch?.suppressed, patch?.lineage);
        rep.stray += stray;
        rows.set(id, row);
        if (JSON.stringify(prev) !== JSON.stringify(row)) rep.updated++;
      }
    }
  }
  return { rows: [...rows.values()].map(normalizeHighSchool).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), report };
}

/**
 * meta.json after a run: sources and vintages from this run's adapters replace theirs; everything else is kept from
 * the previous meta. Counts come from the rows.
 */
export function mergeMeta(prev: HighSchoolMeta | null, runs: readonly AdapterRun[], rows: readonly HighSchool[], today: string): HighSchoolMeta {
  const vintages = Object.fromEntries(HS_VINTAGE_KEYS.map((k) => [k, prev?.vintages?.[k] ?? null])) as Record<HsVintageKey, string | null>;
  const sources: HighSchoolMeta["sources"] = { ...(prev?.sources ?? {}) };
  for (const { result } of runs) {
    Object.assign(sources, result.sources);
    for (const [k, v] of Object.entries(result.vintages)) vintages[k as HsVintageKey] = v ?? null;
  }
  const byState: Record<string, number> = {};
  let pub = 0;
  for (const r of rows) {
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.kind === "public") pub++;
  }
  return {
    generated: today,
    sources: Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k as keyof typeof sources]])),
    vintages,
    counts: { public: pub, private: rows.length - pub, byState: Object.fromEntries(Object.keys(byState).sort().map((k) => [k, byState[k]])) },
  };
}
