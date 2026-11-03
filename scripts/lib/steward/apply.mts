/**
 * `--mode apply --proposal <key>` (the build brief's "Apply"; specs/product/data-steward.md "The kinds of resolution"):
 * no model. The console's Approve marks the proposal `approved` with each row's decision, then dispatches this job for
 * the kinds that need the scripts. It applies the rows with `decision: "approved"`, by the proposal's kind:
 * - hold: hold-misread's library (`holdMisread`), one hold per college and edition, the row's `proposed` as what the
 *   document shows;
 * - refile: refile-document's library (`refileDocument`), the row's `sha256` to its `edition`, `proposed` as why;
 * - recipe: the college's `reported.sources` document (`sources.add` a URL at the front, `sources.drop` a URL, or
 *   `rediscover`: the not-found mark and the back-off cleared so the next run looks again);
 * - reject: the queue item (`row.item`) resolved `rejected` with the proposal as its note;
 * all in one change set (kind pipeline, source `steward-apply`), then marks the proposal `applied`. Correct and publish
 * rows are the console's own (`admin_data_edit` + `admin_data_resolve_review`), and re-reads its dispatch: this job
 * refuses them. `publish` is true when a hold or refile changed a record, the only case the workflow asks the publisher
 * for a snapshot.
 */
import type { ProposalDoc, ProposalRow } from "../../../lib/steward/types.ts";
import type { Recipe, RecipeSource, ReviewItem } from "../../../lib/reported.ts";
import { holdMisread, type Hold } from "../../hold-misread.mts";
import { refileDocument } from "../../refile-document.mts";
import { COLLECTIONS } from "../data-platform/layers.mts";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";

export const APPLY_SOURCE = "steward-apply";
/** The kinds this job applies. */
export const APPLIED_KINDS: ReadonlySet<ProposalDoc["kind"]> = new Set(["hold", "refile", "recipe", "reject"]);

export interface ApplyResult {
  key: string;
  kind: ProposalDoc["kind"];
  applied: number;
  skipped: number;
  /** A hold or refile changed a record: the publisher should compose a snapshot. */
  publish: boolean;
  lines: string[];
}

export class ApplyRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyRefused";
  }
}

const formatOf = (url: string): RecipeSource["format"] => (/\.xlsx?($|\?)/i.test(url) ? "xlsx" : /\.pdf($|\?)/i.test(url) ? "pdf" : "html");

/** The recipe with one row's change made, or null when it changes nothing. */
export function recipeAfter(before: Recipe | null, unitId: string, row: Pick<ProposalRow, "field" | "value">, today: string): Recipe | null {
  const recipe: Recipe = before ? structuredClone(before) : { unit_id: unitId, sources: [], index_urls: [], learned: today, model: "manual" };
  const url = typeof row.value === "string" ? row.value : "";
  if (row.field === "sources.add") {
    if (recipe.sources[0]?.url === url) return null;
    recipe.sources = [{ kind: "cds", url, format: formatOf(url) }, ...recipe.sources.filter((s) => s.url !== url)];
    delete recipe.none_found;
  } else if (row.field === "sources.drop") {
    if (!recipe.sources.some((s) => s.url === url)) return null;
    recipe.sources = recipe.sources.filter((s) => s.url !== url);
  } else if (row.field === "rediscover") {
    if (!recipe.none_found && !recipe.discovery?.next_attempt) return null;
    delete recipe.none_found;
    if (recipe.discovery) delete recipe.discovery.next_attempt;
  } else {
    throw new ApplyRefused(`a recipe row's field is sources.add, sources.drop, or rediscover, not ${row.field}`);
  }
  return recipe;
}

/**
 * Applies an approved proposal into `handle` (the caller opens the set with source `steward-apply` and closes it).
 * Refuses a proposal that isn't `approved`, of a kind the console applies itself, or with no approved row.
 */
export async function applyProposal(store: DataStore, handle: ChangeSetHandle, key: string, opts: { today: string; names?: ReadonlyMap<string, string>; log?: (line: string) => void }): Promise<ApplyResult> {
  const log = opts.log ?? (() => {});
  const p = await store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, key);
  if (!p) throw new ApplyRefused(`no proposal ${key}`);
  if (p.status !== "approved") throw new ApplyRefused(`proposal ${key} is ${p.status}; only an approved proposal is applied`);
  if (!APPLIED_KINDS.has(p.kind)) throw new ApplyRefused(`a ${p.kind} proposal is applied by the console, not this job`);
  const rows = p.rows.filter((r) => r.decision === "approved");
  const skipped = p.rows.length - rows.length;
  if (!rows.length) throw new ApplyRefused(`proposal ${key} has no approved row`);
  const lines: string[] = [];
  const say = (l: string) => (lines.push(l), log(l));
  let publish = false;

  if (p.kind === "hold") {
    const holds = new Map<string, Hold>();
    for (const r of rows) {
      if (!r.code || !r.edition) throw new ApplyRefused(`a hold row needs the code and the edition (${r.unit_id})`);
      const k = `${r.unit_id}|${r.edition}`;
      const h = holds.get(k) ?? holds.set(k, { unit: r.unit_id, edition: r.edition, codes: [], detail: r.proposed }).get(k)!;
      h.codes.push(r.code);
      if (!h.detail.includes(r.proposed)) h.detail = `${h.detail}; ${r.proposed}`.slice(0, 500);
    }
    const held = await holdMisread(store, [...holds.values()], { today: opts.today, names: opts.names ?? new Map(), handle, log: say });
    publish = held.some((h) => h.held.length > 0);
  } else if (p.kind === "refile") {
    for (const r of rows) {
      if (!r.sha256 || !r.edition) throw new ApplyRefused(`a refile row needs the document and the edition (${r.unit_id})`);
      const res = await refileDocument(store, { unit: r.unit_id, sha: r.sha256, edition: r.edition, why: r.proposed }, { handle, log: say });
      if (res.from !== res.to || res.moved) publish = true;
    }
  } else if (p.kind === "recipe") {
    for (const r of rows) {
      const before = await store.readOne<Recipe>(COLLECTIONS.reported.sources, r.unit_id);
      const after = recipeAfter(before, r.unit_id, r, opts.today);
      if (!after) {
        say(`${r.unit_id}: recipe already says so (${r.field})`);
        continue;
      }
      await handle.write(COLLECTIONS.reported.sources, [{ key: r.unit_id, body: after }]);
      say(`${r.unit_id}: recipe ${r.field}${typeof r.value === "string" ? ` ${r.value}` : ""}`);
    }
  } else if (p.kind === "reject") {
    for (const r of rows) {
      if (!r.item) throw new ApplyRefused(`a reject row names the queue item (${r.unit_id})`);
      const item = await store.readOne<ReviewItem>(COLLECTIONS.reported.reviewQueue, r.item);
      if (!item) {
        say(`${r.item}: no longer in the queue`);
        continue;
      }
      if (item.resolved) {
        say(`${r.item}: already ${item.resolved}`);
        continue;
      }
      const note = `Rejected through proposal ${p.key}: ${r.proposed}`.slice(0, 500);
      await handle.write(COLLECTIONS.reported.reviewQueue, [{ key: r.item, body: { ...item, resolved: "rejected", resolved_on: opts.today, resolved_note: note } }]);
      say(`${r.item}: rejected`);
    }
  }

  await handle.write(COLLECTIONS.steward.proposals, [{ key: p.key, body: { ...p, status: "applied" } satisfies ProposalDoc }]);
  return { key: p.key, kind: p.kind, applied: rows.length, skipped, publish, lines };
}
