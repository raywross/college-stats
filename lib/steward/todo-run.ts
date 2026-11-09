/**
 * How a To do row marked Found reaches the college-reported run, and how the run closes it (specs/product/
 * todo-browser-agent.md "Step 2", item 1). Pure, shared by scripts/lib/college-reported/state.mts (the run) and its
 * tests:
 *
 * - `withFound` adds each found row's address to the owner's list (`cds-urls`, discovery step 0), so the next run of
 *   that college starts from it exactly as from a link the owner typed; a row whose kind the run doesn't fetch (a campus
 *   page, a high school profile) stays a note to a person.
 * - `settleFound` marks a found row done once the run has the document at that address (or where the address led),
 *   with the archive's hash as the attempt's result.
 */
import type { CdsUrlEntry } from "../reported.ts";
import type { TodoDoc } from "./types.ts";

/** The To do kinds the run fetches, as recipe source kinds. */
const RUN_KINDS: Readonly<Record<string, CdsUrlEntry["kind"]>> = { cds: "cds", "class-profile": "class-profile" };

const normal = (url: string): string | null => {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
};

/** Whether the run can act on this row: found, a college's, a kind it fetches, with an http(s) address. */
export function isRunnableFound(row: TodoDoc): row is TodoDoc & { unit_id: string; document_url: string } {
  return row.status === "found" && !!row.unit_id && !!row.document_url && !!RUN_KINDS[row.kind] && normal(row.document_url) !== null;
}

/** The found rows as owner's-list entries (one per row), with the row's key in the note. */
export function foundEntries(rows: Iterable<TodoDoc>): CdsUrlEntry[] {
  const out: CdsUrlEntry[] = [];
  for (const r of rows) {
    if (!isRunnableFound(r)) continue;
    out.push({ unit_id: r.unit_id, url: normal(r.document_url)!, kind: RUN_KINDS[r.kind], note: `To do ${r.key}: found in a browser`, added: r.updated.slice(0, 10) });
  }
  return out;
}

/** The owner's list plus the found rows' addresses it doesn't hold yet (same college, same address). */
export function withFound(manual: readonly CdsUrlEntry[], rows: Iterable<TodoDoc>): CdsUrlEntry[] {
  const seen = new Set(manual.map((e) => `${e.unit_id} ${normal(e.url) ?? e.url}`));
  const out = [...manual];
  for (const e of foundEntries(rows)) {
    const id = `${e.unit_id} ${e.url}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/**
 * The rows after the run archived (or confirmed it holds) a document for `unit_id` fetched from any of `urls` (the
 * source's address, its direct-download form, where it redirected): each found row at one of them becomes done, with
 * an attempt by the run. `settled` lists the rows that changed.
 */
export function settleFound(rows: readonly TodoDoc[], got: { unit_id: string; urls: readonly string[]; sha256: string; at: string }): { rows: TodoDoc[]; settled: TodoDoc[] } {
  const at = new Set(got.urls.map((u) => normal(u)).filter((u): u is string => !!u));
  const settled: TodoDoc[] = [];
  const next = rows.map((r) => {
    if (!isRunnableFound(r) || r.unit_id !== got.unit_id || !at.has(normal(r.document_url)!)) return r;
    const done: TodoDoc = { ...r, status: "done", attempts: [...r.attempts, { at: got.at, route: "run", result: `archived ${got.sha256.slice(0, 12)}` }], updated: got.at };
    settled.push(done);
    return done;
  });
  return { rows: next, settled };
}
