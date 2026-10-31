/**
 * How the Data console shows a change set (specs/data-platform/change-sets.md "The console", Change sets row): the
 * status chips, the summary's counts and cost, the run link, which actions a set offers, the before/after line diff
 * of one document, and the release note an admin may copy. Pure (no I/O, no Next.js), so the pages, the components
 * and tests/admin-data.test.mts share it.
 */
import type { ChipTone } from "./console.ts";

export type ChangeSetStatus = "open" | "applied" | "held" | "reverted";
export type ChangeSetKind = "pipeline" | "import" | "edit" | "revert" | "publish-fix";

/** A `data_change_sets` row as the console reads it. */
export interface ChangeSetRow {
  id: number;
  kind: ChangeSetKind | string;
  source: string;
  run_ref: string | null;
  status: ChangeSetStatus | string;
  held_reason: string | null;
  summary: ChangeSetSummary | null;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  snapshot_id: number | null;
  reverted_by: number | null;
}

/** What `data_close_change_set` and the producers put in `summary` (every field optional). */
export interface ChangeSetSummary {
  documents?: number;
  added?: number;
  changed?: number;
  removed?: number;
  collections?: string[];
  cost_usd?: number;
  /** The run's report (today's PR body): markdown text. */
  body?: string;
  text?: string;
  reverts?: number;
  note?: string | null;
  [key: string]: unknown;
}

export const STATUS_LABEL: Record<ChangeSetStatus, string> = { open: "Writing", applied: "Applied", held: "Held", reverted: "Reverted" };
export const STATUS_TONE: Record<ChangeSetStatus, ChipTone> = { open: "info", applied: "good", held: "warn", reverted: "neutral" };

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as ChangeSetStatus] ?? status;
}
export function statusTone(status: string): ChipTone {
  return STATUS_TONE[status as ChangeSetStatus] ?? "neutral";
}

const KIND_LABEL: Record<string, string> = { pipeline: "Pipeline run", import: "Import", edit: "Console edit", revert: "Revert", "publish-fix": "Publish fix" };
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "412 documents: 3 added, 405 changed, 4 removed", or what of it the summary has; "No documents" for an empty set. */
export function countsLabel(summary: ChangeSetSummary | null | undefined): string {
  const docs = num(summary?.documents);
  const parts = (["added", "changed", "removed"] as const).map((k) => [k, num(summary?.[k])] as const).filter(([, v]) => v !== null && v > 0);
  if (docs === null && !parts.length) return "—";
  if (docs === 0) return "No documents";
  const head = docs === null ? "" : `${docs.toLocaleString("en-US")} document${docs === 1 ? "" : "s"}`;
  const tail = parts.map(([k, v]) => `${v!.toLocaleString("en-US")} ${k}`).join(", ");
  return head && tail ? `${head}: ${tail}` : head || tail;
}

/** The run's cost in US dollars ("$12.40"), or null when the summary has none. */
export function costLabel(summary: ChangeSetSummary | null | undefined): string | null {
  const c = num(summary?.cost_usd);
  return c === null ? null : `$${c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The run's report text, when the producer put one in the summary. */
export function summaryText(summary: ChangeSetSummary | null | undefined): string | null {
  const t = typeof summary?.body === "string" ? summary.body : typeof summary?.text === "string" ? summary.text : null;
  return t && t.trim() ? t : null;
}

/** The GitHub Actions run a pipeline's `run_ref` names (a numeric run id), or null for imports, edits, and local stamps. */
export function runHref(runRef: string | null | undefined, repo: string): string | null {
  return runRef && /^\d{1,20}$/.test(runRef) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? `https://github.com/${repo}/actions/runs/${runRef}` : null;
}

/** Which of the change set's actions the console offers (the functions refuse the rest anyway). */
export function changeSetActions(row: Pick<ChangeSetRow, "status" | "snapshot_id">): { hold: boolean; publishAnyway: boolean; revert: boolean; releaseNote: boolean } {
  return {
    hold: row.status === "applied" && row.snapshot_id === null,
    publishAnyway: row.status === "held",
    revert: row.status === "applied" || row.status === "held",
    releaseNote: row.status !== "open",
  };
}

/* ------------------------------------------------------------------ */
/* Documents touched                                                   */
/* ------------------------------------------------------------------ */

export interface TouchedVersion {
  collection: string;
  key: string;
  version: number;
  deleted: boolean;
}

/** The touched documents grouped by collection (in collection order), each key once, with whether its last write deleted it. */
export function groupTouched(rows: readonly TouchedVersion[]): { collection: string; documents: { key: string; deleted: boolean }[] }[] {
  const by = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    const docs = by.get(r.collection) ?? new Map<string, boolean>();
    docs.set(r.key, r.deleted);
    by.set(r.collection, docs);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([collection, docs]) => ({ collection, documents: [...docs.entries()].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })).map(([key, deleted]) => ({ key, deleted })) }));
}

/* ------------------------------------------------------------------ */
/* Before and after: a line diff                                       */
/* ------------------------------------------------------------------ */

export type DiffLine = { op: "same" | "add" | "del"; text: string };
export type DiffHunk = { lines: DiffLine[] } | { skipped: number };

/** A document's body as the diff shows it: two-space JSON, or nothing when it was absent or deleted. */
export function documentLines(body: unknown): string[] {
  if (body === null || body === undefined) return [];
  return JSON.stringify(body, null, 2).split("\n");
}

/** Past this many cells (lines before × lines after, once the common ends are trimmed), the middle shows as replaced whole. */
export const DIFF_CELL_LIMIT = 4_000_000;

/** A line diff (longest common subsequence after trimming the common head and tail), every line in order. */
export function lineDiff(before: readonly string[], after: readonly string[]): DiffLine[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const out: DiffLine[] = before.slice(0, head).map((text) => ({ op: "same", text }));
  if (a.length * b.length > DIFF_CELL_LIMIT) {
    out.push(...a.map((text) => ({ op: "del" as const, text })), ...b.map((text) => ({ op: "add" as const, text })));
  } else {
    // lcs[i][j]: the common subsequence's length of a[i..] and b[j..].
    const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        out.push({ op: "same", text: a[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: "del", text: a[i++] });
      else out.push({ op: "add", text: b[j++] });
    }
    while (i < a.length) out.push({ op: "del", text: a[i++] });
    while (j < b.length) out.push({ op: "add", text: b[j++] });
  }
  out.push(...before.slice(before.length - tail).map((text) => ({ op: "same" as const, text })));
  return out;
}

/** The changed lines with `context` unchanged lines around each change; longer unchanged runs collapse to a count. */
export function diffHunks(lines: readonly DiffLine[], context = 3): DiffHunk[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.op === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffHunk[] = [];
  let skipped = 0;
  let current: DiffLine[] | null = null;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ skipped });
      skipped = 0;
      if (!current) out.push({ lines: (current = []) });
      current.push(l);
    } else {
      skipped++;
      current = null;
    }
  });
  if (skipped) out.push({ skipped });
  return out;
}

/* ------------------------------------------------------------------ */
/* Write a release note                                                */
/* ------------------------------------------------------------------ */

/** Plain words for a producer's source, as a release note's reader would say it. */
const SOURCE_WORDS: Record<string, string> = {
  "sync-data": "federal college data (IPEDS and the College Scorecard)",
  "college-reported": "figures colleges report in their Common Data Sets",
  "identity-refresh": "college links, social accounts, and colors",
  directories: "college directories",
  "campus-pilot": "campus facts",
  "common-app": "the Common App's college list",
  coalition: "the Coalition application's college list",
  "essay-prompts": "essay questions",
  history: "admissions history",
  "high-schools": "high school data",
  "hold-misread": "Common Data Set corrections",
  console: "values corrected by Quad's editors",
};

/** `release-notes/<slug>.md`'s slug for a change set: `data-<source>-<date>-<id>`, lowercase letters, digits, dashes. */
export function releaseNoteSlug(row: Pick<ChangeSetRow, "id" | "source" | "closed_at" | "created_at">): string {
  const day = (row.closed_at ?? row.created_at).slice(0, 10);
  return `data-${row.source}-${day}-${row.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The release note for a change set, for an admin to copy into `release-notes/<slug>.md` (specs/release-notes.md):
 * frontmatter (`pr` left for the person who commits it to fill in), a plain-language "What's new", and "Behind the
 * scenes" naming the change set. Written for the site's readers; it never names a person.
 */
export function releaseNoteText(row: Pick<ChangeSetRow, "id" | "kind" | "source" | "summary" | "closed_at" | "created_at">): { path: string; content: string } {
  const what = SOURCE_WORDS[row.source] ?? row.source.replace(/[-_]+/g, " ");
  const day = (row.closed_at ?? row.created_at).slice(0, 10);
  const docs = num(row.summary?.documents);
  const collections = Array.isArray(row.summary?.collections) ? (row.summary!.collections as unknown[]).filter((c): c is string => typeof c === "string") : [];
  const title = row.kind === "revert" ? `An update to ${what} was undone` : `Updated ${what}`;
  const summary = row.kind === "revert" ? `We undid an earlier update to ${what}.` : `We refreshed ${what}.`;
  const whatsNew =
    row.kind === "revert"
      ? `An earlier update to ${what} didn't look right, so we put the values back as they were before it.`
      : `College pages now show the newest ${what}${docs ? `, across ${docs.toLocaleString("en-US")} updated record${docs === 1 ? "" : "s"}` : ""}.`;
  const behind = `Change set ${row.id} (${kindLabel(row.kind).toLowerCase()}, ${row.source})${collections.length ? ` wrote ${collections.join(", ")}` : ""}; the next snapshot published it.`;
  const content = ["---", `title: "${title.replace(/"/g, "'")}"`, "pr: <number>", `date: ${day}`, "kind: data", `summary: ${summary}`, "---", "", "## What's new", "", whatsNew, "", "## Behind the scenes", "", behind, ""].join("\n");
  return { path: `release-notes/${releaseNoteSlug(row)}.md`, content };
}
