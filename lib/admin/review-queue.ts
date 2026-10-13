/**
 * The review queue in the admin console (specs/product/admin.md, "Approvals"; specs/college-reported-setup.md section
 * 6): `data/review-queue.json` as rows, and the three fixes as file edits a PR carries. Pure: the console reads the
 * current files from `main` (`readQueue` with lib/github-app.ts `readRepoFile`), builds the change here, and hands it
 * to `commitFileAndOpenPull`.
 *
 * - **Accept** writes an override to `data/overrides.json` with `cds` and the document's citation, the importer's
 *   format (specs/sources-and-citations.md), checked with the lineage check's own `validateOverrides` before it is
 *   offered. Only items that map onto a registered field an override may set can be accepted (`acceptPlan` says why
 *   not otherwise): a C1 total (applicants, admitted, enrolled, accepted together with the derived acceptance rate and
 *   the class year, so the funnel stays one class), the SAT/ACT submission shares (C.901, C.902), and a round-1/2
 *   C1 extraction from a Common Data Set. Everything else lives only in the college's CDS record, which an override
 *   cannot reach (lib/lineage.ts `lineageForPatch`, rule 9). The accepted keys are kept in the patch's `_review`
 *   (ignored by the sync and the lineage check, like `_source`), so the queue shows the item as accepted.
 * - **Reject** marks the item `resolved: "rejected"` in `data/review-queue.json`; `enqueueItems` (lib/reported.ts)
 *   keeps it, so the next run doesn't queue the same document's value again.
 * - **Re-run discovery** dispatches a `college` run with `rediscover: true` (the workflow climbs the discovery ladder
 *   from step 0 and its own PR carries the new recipe). `rediscoverChange` also returns the college's recipe cleared
 *   from `data/college-sources.json`, the setup guide's manual route; dispatching alone does the same work and avoids
 *   two PRs editing that file at once.
 *
 * Every file is re-serialized in its writer's exact format (the queue and sources one entry per line, overrides as
 * the importer writes them), so the PR's diff is just the change.
 */
import type { CommitAndPullOptions } from "../github-app.ts";
import { validateOverrides } from "../lineage.ts";
import { labelYear } from "../newest-groups.ts";
import { reviewKey, type ReviewItem, type ReviewQueueFile, type SourcesFile } from "../reported.ts";
import type { LineageRecord } from "../types";
import { buildDispatch, type BuiltDispatch } from "./workflows.ts";

export const QUEUE_PATH = "data/review-queue.json";
export const OVERRIDES_PATH = "data/overrides.json";
export const SOURCES_PATH = "data/college-sources.json";
export const REVIEW_BRANCH_PREFIX = "review/";

export type QueueStatus = "open" | "accepted" | "rejected";

export interface QueueRow {
  /** Unique per row: the queue key plus the document. */
  id: string;
  item: ReviewItem;
  status: QueueStatus;
  /** Whether Accept is offered, and why not. */
  accept: { ok: true } | { ok: false; reason: AcceptRefusal; message: string };
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/** `{ "updated": …, "<key>": [\n    {one item per line},\n  …\n] }`: scripts/lib/college-reported/files.mts `linesJson`. */
export function linesJson(updated: string | null, key: string, items: unknown[]): string {
  const body = items.map((it) => `    ${JSON.stringify(it)}`).join(",\n");
  return `{\n  "updated": ${JSON.stringify(updated)},\n  "${key}": [${items.length ? `\n${body}\n  ` : ""}]\n}\n`;
}

/** data/overrides.json as scripts/import-cds.mts writes it. */
export function overridesJson(overrides: Record<string, unknown>): string {
  return `${JSON.stringify(overrides, null, 2)}\n`;
}

/** A row's id: the queue key and the document (sha256, else the first URL). */
export function rowId(item: ReviewItem): string {
  return `${reviewKey(item)}|${item.sha256 ?? item.urls[0] ?? ""}`;
}

function parseQueue(text: string): ReviewQueueFile {
  const q = JSON.parse(text) as ReviewQueueFile;
  if (!q || !Array.isArray(q.items)) throw new Error(`${QUEUE_PATH}: no items`);
  return q;
}

/** Ids of rows accepted into data/overrides.json (each patch's `_review.accepted`). */
export function acceptedIds(overrides: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  for (const patch of Object.values(overrides)) {
    const review = (patch as { _review?: { accepted?: { id?: string }[] } } | null)?._review;
    for (const a of review?.accepted ?? []) if (typeof a.id === "string") ids.add(a.id);
  }
  return ids;
}

/** Pure: the queue as rows, with each row's status and whether Accept is offered. Open rows first, then by college. */
export function queueRows(queue: ReviewQueueFile, overrides: Record<string, unknown> = {}): QueueRow[] {
  const accepted = acceptedIds(overrides);
  const rows = queue.items.map((item): QueueRow => {
    const id = rowId(item);
    const status: QueueStatus = item.resolved === "rejected" ? "rejected" : accepted.has(id) ? "accepted" : "open";
    const plan = acceptPlan(item, queue.items);
    return { id, item, status, accept: plan.ok ? { ok: true } : { ok: false, reason: plan.reason, message: plan.message } };
  });
  const order: Record<QueueStatus, number> = { open: 0, accepted: 1, rejected: 2 };
  return rows.sort((a, b) => order[a.status] - order[b.status]);
}

/** How `readQueue` reads a file on `main`: lib/github-app.ts `readRepoFile(path, { knownSha })`. */
export type ReadRepoFile = (
  path: string,
  knownSha?: string,
) => Promise<{ ok: true; content: string; sha: string; unchanged?: boolean } | { ok: false; reason: string }>;

let cache: { queueSha: string; overridesSha: string; queue: ReviewQueueFile; overrides: Record<string, unknown>; rows: QueueRow[] } | null = null;

/**
 * The queue on `main` as rows, with the accepted ones read from data/overrides.json. Both come from GitHub, so the
 * console acts on what's committed now (the deploy can lag a merge), and nothing extra has to ship with the site. The
 * queue is about 12 MB: it is downloaded again only when its blob sha changes (cached per instance).
 */
export async function readQueue(
  read: ReadRepoFile,
): Promise<{ ok: true; updated: string; rows: QueueRow[]; items: ReviewItem[] } | { ok: false; reason: string }> {
  const [q, o] = await Promise.all([read(QUEUE_PATH, cache?.queueSha), read(OVERRIDES_PATH, cache?.overridesSha)]);
  if (!q.ok) return q;
  if (!o.ok) return o;
  if (cache && q.unchanged && o.unchanged) return { ok: true, updated: cache.queue.updated, rows: cache.rows, items: cache.queue.items };
  try {
    const queue = q.unchanged && cache ? cache.queue : parseQueue(q.content);
    const overrides = o.unchanged && cache ? cache.overrides : (JSON.parse(o.content) as Record<string, unknown>);
    const rows = queueRows(queue, overrides);
    cache = { queueSha: q.sha, overridesSha: o.sha, queue, overrides, rows };
    return { ok: true, updated: queue.updated, rows, items: queue.items };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `readQueue` wired to lib/github-app.ts `readRepoFile` at `main`: null when GitHub isn't configured (the page shows
 * the setup notice). The client is imported here, not at the top, so the pure edits above load without it.
 */
export async function readMainQueue(
  deps: import("../github-app.ts").GithubDeps = {},
): Promise<Awaited<ReturnType<typeof readQueue>> | null> {
  const gh = await import("../github-app.ts");
  if (!gh.githubConfigured(deps.env ?? process.env)) return null;
  return readQueue((path, knownSha) => gh.readRepoFile(path, { ...deps, knownSha }));
}

/* ------------------------------------------------------------------ */
/* Accept                                                             */
/* ------------------------------------------------------------------ */

/** C1 totals: accepted together, so applicants, admitted, and enrolled always describe the same class. */
const C1_TOTALS = { "C.116": "applicants", "C.117": "admitted", "C.118": "enrolled" } as const;
/** Single items with a registered override path of their own. Shares are fractions (0.62), as the queue stores them. */
const SINGLE_TARGETS: Record<string, { path: "admissions.test_submission_rate_sat" | "admissions.test_submission_rate_act" }> = {
  "C.901": { path: "admissions.test_submission_rate_sat" },
  "C.902": { path: "admissions.test_submission_rate_act" },
};

export type AcceptRefusal = "not_open" | "no_override_path" | "c1_incomplete" | "not_cds" | "implausible" | "no_document";

export type AcceptPlan =
  | {
      ok: true;
      /** The rows the override settles (the three C1 totals together). */
      items: ReviewItem[];
      edition: string;
      url: string;
      /** Override path (under the patch) → value. */
      values: Record<string, number>;
    }
  | { ok: false; reason: AcceptRefusal; message: string };

const refuse = (reason: AcceptRefusal, message: string): AcceptPlan => ({ ok: false, reason, message });

/** A Common Data Set by its link or name ("cds", "common data set", "common_data_set"). */
export function isCdsDocument(url: string): boolean {
  return /(^|[^a-z])cds([^a-z]|$)|common[\s_-]*data[\s_-]*set/i.test(decodeURIComponentSafe(url));
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "Fall 2025" → "2025-26". */
function editionFromTerm(term: string | null): string | null {
  const y = labelYear(term);
  return y === null ? null : `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

function c1Values(applicants: number, admitted: number, enrolled: number, edition: string): Record<string, number> | null {
  if (applicants < 10 || admitted > applicants || enrolled > admitted) return null;
  return {
    "admissions.year": Number(edition.slice(0, 4)),
    "admissions.applicants": applicants,
    "admissions.admitted": admitted,
    "admissions.enrolled": enrolled,
    "admissions.acceptance_rate": round4(admitted / applicants),
  };
}

/** Whether `item` can be accepted as an override, and what it would write. `queue` supplies a C1 total's siblings. */
export function acceptPlan(item: ReviewItem, queue: readonly ReviewItem[]): AcceptPlan {
  if (item.resolved) return refuse("not_open", "This item was already resolved.");
  const url = item.urls[0];
  if (!url) return refuse("no_document", "The item names no document to cite.");

  // Round-1/2 entries: a whole C1 extraction from one document.
  if (!item.code) {
    const x = item.extraction;
    if (!x) return refuse("no_override_path", "Nothing was read from this document; fix its recipe or re-run discovery.");
    if (!isCdsDocument(url)) return refuse("not_cds", "The document isn't a Common Data Set, so an override can't cite it as one; add one by hand if it should publish.");
    const edition = editionFromTerm(x.entering_term ?? item.entering_term);
    if (!edition) return refuse("no_document", "The document doesn't say which class it describes.");
    if (x.cohort === "transfer") return refuse("implausible", "These figures describe transfer students, not first-years.");
    if (!isCount(x.applicants) || !isCount(x.admitted) || !isCount(x.enrolled)) return refuse("c1_incomplete", "Applicants, admitted, and enrolled weren't all read.");
    const values = c1Values(x.applicants, x.admitted, x.enrolled, edition);
    if (!values) return refuse("implausible", "The counts don't make a funnel (applicants ≥ admitted ≥ enrolled, at least 10 applicants).");
    return { ok: true, items: [item], edition, url, values };
  }

  if (!item.edition) return refuse("no_document", "The item names no edition.");
  const edition = item.edition;

  if (item.code in C1_TOTALS) {
    const siblings = (Object.keys(C1_TOTALS) as (keyof typeof C1_TOTALS)[]).map((code) =>
      queue.find((q) => !q.resolved && q.unit_id === item.unit_id && q.edition === edition && q.sha256 === item.sha256 && q.code === code),
    );
    if (siblings.some((s) => !s || !isCount(s.value))) {
      return refuse("c1_incomplete", "Applicants, admitted, and enrolled (C.116–C.118) must all be in the queue from this document to accept them together.");
    }
    const [applicants, admitted, enrolled] = siblings.map((s) => s!.value as number);
    const values = c1Values(applicants, admitted, enrolled, edition);
    if (!values) return refuse("implausible", "The counts don't make a funnel (applicants ≥ admitted ≥ enrolled, at least 10 applicants).");
    return { ok: true, items: siblings as ReviewItem[], edition, url, values };
  }

  const single = SINGLE_TARGETS[item.code];
  if (single) {
    const v = item.value;
    if (typeof v !== "number" || v < 0 || v > 1) return refuse("implausible", "A submission share must be a fraction between 0 and 1.");
    return { ok: true, items: [item], edition, url, values: { [single.path]: round4(v) } };
  }

  return refuse(
    "no_override_path",
    `${item.code} is published from the college's CDS record, which an override can't set. Re-run discovery, fix the recipe by hand, or leave it queued.`,
  );
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let o = target;
  for (const p of parts.slice(0, -1)) {
    if (!o[p] || typeof o[p] !== "object" || Array.isArray(o[p])) o[p] = {};
    o = o[p] as Record<string, unknown>;
  }
  o[parts[parts.length - 1]] = value;
}

export type EditResult = { ok: true; content: string; items: ReviewItem[]; fields: string[] } | { ok: false; reason: string; message: string };

/**
 * Accept: the new data/overrides.json. A college without a patch gets the importer's header (`_source`, `_imported`,
 * `cds`); every path written also gets a field-level lineage record naming this document (so a patch from an older
 * CDS keeps citing its own document for the rest). Refused when `acceptPlan` refuses or the result fails the lineage
 * check's `validateOverrides`.
 */
export function acceptEdit(item: ReviewItem, overridesText: string, ctx: { queue: readonly ReviewItem[]; today: string }): EditResult {
  const plan = acceptPlan(item, ctx.queue);
  if (!plan.ok) return { ok: false, reason: plan.reason, message: plan.message };
  const overrides = JSON.parse(overridesText) as Record<string, Record<string, unknown>>;
  if (acceptedIds(overrides).has(rowId(item))) return { ok: false, reason: "not_open", message: "This item was already accepted." };
  const unit = item.unit_id;
  const patch: Record<string, unknown> = overrides[unit] ?? {
    _source: `${item.name} Common Data Set ${plan.edition}: ${plan.url}`,
    _imported: ctx.today,
    cds: { edition: plan.edition, url: plan.url },
  };
  const record: LineageRecord = { source: "cds", year: plan.edition, url: plan.url, retrieved: item.queued };
  const lineage = { ...((patch.lineage as Record<string, LineageRecord> | undefined) ?? {}) };
  for (const [path, value] of Object.entries(plan.values)) {
    setPath(patch, path, value);
    lineage[path] = record;
  }
  patch.lineage = lineage;
  const review = (patch._review as { accepted?: unknown[] } | undefined) ?? {};
  patch._review = {
    ...review,
    accepted: [...(review.accepted ?? []), ...plan.items.map((i) => ({ id: rowId(i), run: i.run, on: ctx.today }))],
  };
  overrides[unit] = patch;

  const problems = validateOverrides({ [unit]: patch });
  if (problems.length) return { ok: false, reason: "invalid_override", message: problems.join("; ") };
  return { ok: true, content: overridesJson(overrides), items: plan.items, fields: Object.keys(plan.values) };
}

/* ------------------------------------------------------------------ */
/* Reject                                                              */
/* ------------------------------------------------------------------ */

/** Reject: the new data/review-queue.json with this row marked `resolved: "rejected"`; every other line unchanged. */
export function rejectEdit(item: ReviewItem, queueText: string, ctx: { today: string }): EditResult {
  const queue = parseQueue(queueText);
  const id = rowId(item);
  const index = queue.items.findIndex((q) => rowId(q) === id);
  if (index < 0) return { ok: false, reason: "not_found", message: "The item is no longer in the queue on main." };
  if (queue.items[index].resolved) return { ok: false, reason: "not_open", message: "This item was already resolved." };
  const items = [...queue.items];
  items[index] = { ...items[index], resolved: "rejected", resolved_on: ctx.today };
  return { ok: true, content: linesJson(queue.updated, "items", items), items: [items[index]], fields: [] };
}

/* ------------------------------------------------------------------ */
/* Re-run discovery                                                    */
/* ------------------------------------------------------------------ */

/**
 * Re-run discovery for a college: the dispatch (`college` run, `rediscover: true`), and data/college-sources.json with
 * the college's recipe removed (null when it has none).
 */
export function rediscoverEdit(unitId: string, sourcesText: string): { content: string | null; dispatch: BuiltDispatch } {
  const dispatch = buildDispatch("college", { college: unitId, rediscover: true, auto_merge: true });
  const sources = JSON.parse(sourcesText) as SourcesFile;
  const recipes = sources.recipes.filter((r) => r.unit_id !== unitId);
  return { content: recipes.length === sources.recipes.length ? null : linesJson(sources.updated, "recipes", recipes), dispatch };
}

/* ------------------------------------------------------------------ */
/* The PR: branch, message, body, release note                         */
/* ------------------------------------------------------------------ */

export type ReviewAction = "accept" | "reject" | "rediscover";

/** "C.116" → "c-116"; a round-1/2 entry (no code) is its C1 extraction. */
export function codeSlug(item: Pick<ReviewItem, "code">): string {
  return (item.code ?? "C1").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

/** `review/<unit>-<code>-<date>`. A second change to the same item the same day is refused (`branch_exists`). */
export function reviewBranch(item: Pick<ReviewItem, "unit_id" | "code">, today: string): string {
  return `${REVIEW_BRANCH_PREFIX}${item.unit_id}-${codeSlug(item)}-${today}`;
}

/** The release note's path: the branch name without its prefix (specs/release-notes.md). */
export function releaseNotePath(branch: string): string {
  return `release-notes/${branch.slice(branch.indexOf("/") + 1)}.md`;
}

/** "2025-26" → "2025–26", as the site writes years. */
const dashed = (edition: string) => edition.replace("-", "–");
const md = (s: string) => s.replace(/([\\`*_[\]|<>])/g, "\\$1");
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

const ACTION_VERB: Record<ReviewAction, string> = { accept: "accept", reject: "reject", rediscover: "re-run discovery for" };

export function commitMessage(action: ReviewAction, item: ReviewItem, admin: string): string {
  return `Review queue: ${ACTION_VERB[action]} ${item.code ?? "C1"} for ${oneLine(item.name)} (${item.unit_id})\n\nFrom the admin console, by ${oneLine(admin)}.\n`;
}

export function prTitle(action: ReviewAction, item: ReviewItem): string {
  const what = action === "accept" ? "accept" : action === "reject" ? "reject" : "re-run discovery";
  return `Review queue: ${what} ${item.code ?? "C1"} for ${oneLine(item.name)}`;
}

/** The PR body: what the console changed, the item (value, failed checks, the document), and what happens next. */
export function prBody(action: ReviewAction, items: readonly ReviewItem[], ctx: { admin: string; fields?: readonly string[] }): string {
  const first = items[0];
  const lines: string[] = [];
  const edition = first.edition ?? first.entering_term ?? "unknown edition";
  if (action === "accept") {
    lines.push(
      `**Accepted** from the admin console by ${md(oneLine(ctx.admin))}: ${md(first.name)} (${first.unit_id}), ${md(edition)}.`,
      "",
      `Writes an override to \`${OVERRIDES_PATH}\` citing the document as its Common Data Set (\`source: cds\`), so the site publishes the value the checks held back. Fields: ${(ctx.fields ?? []).map((f) => `\`${f}\``).join(", ") || "none"}.`,
      "",
      "The site shows it after the next `npm run sync-data`, which applies overrides.",
    );
  } else if (action === "reject") {
    lines.push(
      `**Rejected** from the admin console by ${md(oneLine(ctx.admin))}: ${md(first.name)} (${first.unit_id}), ${md(edition)}.`,
      "",
      `Marks the item \`resolved: rejected\` in \`${QUEUE_PATH}\`. Nothing on the site changes; the next run won't queue this document's value again, and a newer document replaces it.`,
    );
  } else {
    lines.push(
      `**Re-run discovery** from the admin console by ${md(oneLine(ctx.admin))}: ${md(first.name)} (${first.unit_id}).`,
      "",
      `Clears the college's recipe in \`${SOURCES_PATH}\`, so the next run finds its documents from scratch.`,
    );
  }
  lines.push("", "| Code | Value | Failed check | Detail |", "|---|---|---|---|");
  for (const i of items) {
    const failures = i.failures.length ? i.failures : [{ check: "—", detail: "" }];
    failures.forEach((f, n) => {
      lines.push(`| ${n === 0 ? md(i.code ?? "C1") : ""} | ${n === 0 ? md(String(i.value ?? "—")) : ""} | ${md(String(f.check))} | ${md(oneLine(f.detail))} |`);
    });
  }
  lines.push("", `Document: ${first.urls.map((u) => `<${u}>`).join(", ") || "none"} (queued ${first.queued}, run ${first.run}).`);
  return `${lines.join("\n")}\n`;
}

/** The release note (kind `data`), with `pr` left as the placeholder `commitFileAndOpenPull` fills in. */
export function releaseNote(action: ReviewAction, items: readonly ReviewItem[], ctx: { today: string; branch: string; placeholder: string }): { path: string; content: string } {
  const first = items[0];
  const name = oneLine(first.name).replace(/"/g, "'");
  const edition = first.edition ? dashed(first.edition) : (first.entering_term ?? "");
  const doc = edition ? `${edition} Common Data Set` : "Common Data Set";
  const title =
    action === "accept" ? `Checked figures for ${name}` : action === "reject" ? `A held-back figure for ${name} stays unpublished` : `Finding ${name}'s documents again`;
  const summary =
    action === "accept"
      ? `A person checked figures from ${name}'s ${doc} that our automatic checks had held back, and accepted them.`
      : action === "reject"
        ? `A person reviewed a figure from ${name}'s ${doc} that our checks held back and confirmed it should not be published.`
        : `We'll look for ${name}'s Common Data Set and class profile from scratch on the next run.`;
  const whatsNew =
    action === "accept"
      ? `${name}'s profile will show figures from its ${doc} that our automatic checks had held for a person to look at. Someone compared them with the college's own document and accepted them.`
      : action === "reject"
        ? `Nothing changes on ${name}'s profile. A figure from its ${doc} failed our automatic checks; a person looked at it and agreed it shouldn't be published, so the profile keeps the figures it shows today.`
        : `${name}'s profile keeps what it shows today. The way we found its documents stopped working, so the next run will look for them again.`;
  const behind =
    action === "accept"
      ? `An override in \`${OVERRIDES_PATH}\` cites the document (${first.urls[0] ?? "no link"}), as the Common Data Set importer does, for template ${items.map((i) => i.code ?? "C1").join(", ")}. It's applied by the next data sync.`
      : action === "reject"
        ? `The review-queue item (template ${first.code ?? "C1"}) is marked rejected in \`${QUEUE_PATH}\`, so the next run doesn't queue the same document's value again.`
        : `The college's recipe is cleared in \`${SOURCES_PATH}\`.`;
  const content = [
    "---",
    `title: "${title}"`,
    `pr: ${ctx.placeholder}`,
    `date: ${ctx.today}`,
    "kind: data",
    `summary: ${summary}`,
    "---",
    "",
    "## What's new",
    "",
    whatsNew,
    "",
    "## Behind the scenes",
    "",
    behind,
    "",
  ].join("\n");
  return { path: releaseNotePath(ctx.branch), content };
}

/** Everything `commitFileAndOpenPull` needs for one review change, given the new file content. */
function change(
  action: ReviewAction,
  primary: ReviewItem,
  items: readonly ReviewItem[],
  path: string,
  content: string,
  ctx: { admin: string; today: string; baseSha?: string; fields?: readonly string[]; placeholder: string },
): CommitAndPullOptions {
  // Named after the item the admin acted on (an accepted C1 total settles its two siblings too).
  const branch = reviewBranch(primary, ctx.today);
  return {
    branch,
    path,
    content,
    message: commitMessage(action, primary, ctx.admin),
    title: prTitle(action, primary),
    body: prBody(action, items, ctx),
    releaseNote: releaseNote(action, items, { today: ctx.today, branch, placeholder: ctx.placeholder }),
    ...(ctx.baseSha ? { baseSha: ctx.baseSha } : {}),
  };
}

export interface ChangeContext {
  /** A display name for the commit and PR (public): never an email address. */
  admin: string;
  /** YYYY-MM-DD (UTC). */
  today: string;
  /** `PR_NUMBER_PLACEHOLDER` from lib/github-app.ts (passed in so this module stays free of the client). */
  placeholder: string;
}

export type ChangeResult = { ok: true; change: CommitAndPullOptions; items: ReviewItem[] } | { ok: false; reason: string; message: string };

/** Accept, as a PR: `file` is data/overrides.json on main (`readRepoFile`), `queue` the queue's items. */
export function acceptChange(item: ReviewItem, file: { content: string; sha: string }, queue: readonly ReviewItem[], ctx: ChangeContext): ChangeResult {
  const r = acceptEdit(item, file.content, { queue, today: ctx.today });
  if (!r.ok) return r;
  return { ok: true, items: r.items, change: change("accept", item, r.items, OVERRIDES_PATH, r.content, { ...ctx, baseSha: file.sha, fields: r.fields }) };
}

/** Reject, as a PR: `file` is data/review-queue.json on main. */
export function rejectChange(item: ReviewItem, file: { content: string; sha: string }, ctx: ChangeContext): ChangeResult {
  const r = rejectEdit(item, file.content, { today: ctx.today });
  if (!r.ok) return r;
  return { ok: true, items: r.items, change: change("reject", item, r.items, QUEUE_PATH, r.content, { ...ctx, baseSha: file.sha }) };
}

/**
 * Re-run discovery: the dispatch to send (the primary action), and, when the college has a recipe, the PR that clears
 * it (`file` is data/college-sources.json on main). See the module comment for why dispatching alone is enough.
 */
export function rediscoverChange(
  item: ReviewItem,
  file: { content: string; sha: string },
  ctx: ChangeContext,
): { dispatch: BuiltDispatch; change: CommitAndPullOptions | null } {
  const r = rediscoverEdit(item.unit_id, file.content);
  return { dispatch: r.dispatch, change: r.content === null ? null : change("rediscover", item, [item], SOURCES_PATH, r.content, { ...ctx, baseSha: file.sha }) };
}
