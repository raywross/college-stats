/**
 * The identity-refresh workflow's due check, pull-request body, and release note
 * (.github/workflows/identity-refresh.yml; specs/school-identity/follow-ups.md, "The monthly refresh"). Pure
 * functions so they're unit-tested without a real run (tests/identity-refresh.test.mts); a small CLI wraps them for
 * the workflow. Modeled on scripts/college-reported-pr-body.mts.
 *
 *   node scripts/identity-refresh.mts due          [--probe <file>] [--today <YYYY-MM-DD>]
 *   node scripts/identity-refresh.mts pr-body       --before <file> --after <file> --issues <file> [--today <YYYY-MM-DD>]
 *   node scripts/identity-refresh.mts release-note  --before <file> --after <file> --issues <file> --pr <n> --date <YYYY-MM-DD> --out <file> [--today <YYYY-MM-DD>]
 *
 * "due" prints "true" or "false" to stdout and nothing else, so the workflow can capture it with
 * `due=$(node ... due)`. "pr-body" prints the PR body to stdout. "release-note" writes the release note to --out
 * (release-notes/<slug>.md).
 *
 * "before" is the committed data/schools.json (`git show HEAD:data/schools.json` in the workflow, before this run's
 * sync steps); "after" is the working tree's data/schools.json once sync-wikidata, probe-sites, and sync-brand
 * (each ending in mergeIdentity) have run. "issues" is the working tree's data/link-issues.json (probe-sites writes
 * it; absent reads as empty, e.g. before the probe has ever run).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LinkIssue, SiteProbeEntry } from "../lib/identity-files";
import type { School, SchoolLinks } from "../lib/types";
import { FAILURES_TO_NULL, PROBE_LINK_FIELDS } from "../lib/site-probe.ts";

/** A refresh is due once the newest site probe is at least this many days old (specs/school-identity/follow-ups.md). */
export const MIN_REFRESH_DAYS = 28;

/** GitHub's limit on a pull request body, in characters (scripts/college-reported-pr-body.mts hit this on a live run). */
const PR_BODY_LIMIT = 65_536;
/** Rows shown per table before "…and N more." */
const MAX_ROWS = 40;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The newest `retrieved` date among `entries`, or null when there are none. */
export function newestRetrieved(entries: readonly Pick<SiteProbeEntry, "retrieved">[]): string | null {
  return entries.length ? entries.reduce((max, e) => (e.retrieved > max ? e.retrieved : max), entries[0].retrieved) : null;
}

/** True once `entries`' newest `retrieved` date is at least MIN_REFRESH_DAYS old, or there are no entries yet. */
export function refreshDue(entries: readonly Pick<SiteProbeEntry, "retrieved">[], today: string): boolean {
  const newest = newestRetrieved(entries);
  return newest === null || daysBetween(newest, today) >= MIN_REFRESH_DAYS;
}

/* ------------------------------------------------------------------ */
/* Diffing: the committed "before" against the working tree's "after" */
/* ------------------------------------------------------------------ */

export interface NamedId {
  unit_id: string;
  name: string;
}

export interface GainLoss {
  before: number;
  after: number;
  gained: NamedId[];
  lost: NamedId[];
}

export interface LinkBecameNull extends NamedId {
  field: keyof SchoolLinks;
  was: string;
}

export interface LinkFailedThisRun extends NamedId {
  field: string;
  url: string;
  failures: number;
  last_status: number | null;
  last_error?: string;
}

export interface MarkChange extends NamedId {
  source_url: string | null;
}

export interface IdentityDiff {
  visit: GainLoss;
  social: GainLoss;
  colors: GainLoss;
  marks: GainLoss;
  becameNull: LinkBecameNull[];
  failedThisRun: LinkFailedThisRun[];
  marksAdded: MarkChange[];
  marksRemoved: MarkChange[];
}

const hasVisit = (s: School): boolean => !!s.links?.visit;
const hasSocial = (s: School): boolean => !!(s.social && Object.keys(s.social).length);
const hasColors = (s: School): boolean => !!(s.brand?.colors && s.brand.colors.length);
const hasMark = (s: School): boolean => !!s.brand?.logo;

function gainLoss(before: Map<string, School>, after: readonly School[], has: (s: School) => boolean): GainLoss {
  const gained: NamedId[] = [];
  const lost: NamedId[] = [];
  let beforeCount = 0;
  for (const b of before.values()) if (has(b)) beforeCount++;
  for (const a of after) {
    const b = before.get(a.unit_id);
    const hadBefore = b ? has(b) : false;
    const hasAfter = has(a);
    if (hasAfter && !hadBefore) gained.push({ unit_id: a.unit_id, name: a.name });
    else if (!hasAfter && hadBefore) lost.push({ unit_id: a.unit_id, name: a.name });
  }
  return { before: beforeCount, after: after.filter(has).length, gained, lost };
}

/** Every links.* field the probe's liveness rule can null out (lib/site-probe.ts), checked for a working → null drop. */
function linksBecameNull(before: Map<string, School>, after: readonly School[]): LinkBecameNull[] {
  const out: LinkBecameNull[] = [];
  for (const a of after) {
    const b = before.get(a.unit_id);
    if (!b) continue;
    for (const field of PROBE_LINK_FIELDS) {
      const was = b.links?.[field];
      const now = a.links?.[field];
      if (was != null && now == null) out.push({ unit_id: a.unit_id, name: a.name, field, was });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name) || x.field.localeCompare(y.field));
}

function markChanges(before: Map<string, School>, after: readonly School[]): { added: MarkChange[]; removed: MarkChange[] } {
  const added: MarkChange[] = [];
  const removed: MarkChange[] = [];
  for (const a of after) {
    const b = before.get(a.unit_id);
    const hadBefore = !!b?.brand?.logo;
    const hasAfter = !!a.brand?.logo;
    if (hasAfter && !hadBefore) added.push({ unit_id: a.unit_id, name: a.name, source_url: a.brand?.logo?.source_url ?? null });
    else if (!hasAfter && hadBefore) removed.push({ unit_id: a.unit_id, name: a.name, source_url: b?.brand?.logo?.source_url ?? null });
  }
  return { added, removed };
}

/** `issues` entries this exact run touched (`last_failed === today`); an older, not-yet-resolved failure is left out. */
function failedThisRun(issues: readonly LinkIssue[], today: string, names: Map<string, string>): LinkFailedThisRun[] {
  return issues
    .filter((i) => i.last_failed === today)
    .map((i) => ({ unit_id: i.unit_id, name: names.get(i.unit_id) ?? i.unit_id, field: i.field, url: i.url, failures: i.failures, last_status: i.last_status, last_error: i.last_error }))
    .sort((x, y) => x.name.localeCompare(y.name) || x.field.localeCompare(y.field));
}

/** Compares the committed `before` dataset with the working tree's `after`, plus this run's link issues. */
export function diffIdentity(before: readonly School[], after: readonly School[], issues: readonly LinkIssue[], today: string): IdentityDiff {
  const beforeById = new Map(before.map((s) => [s.unit_id, s]));
  const names = new Map(after.map((s) => [s.unit_id, s.name]));
  const { added, removed } = markChanges(beforeById, after);
  return {
    visit: gainLoss(beforeById, after, hasVisit),
    social: gainLoss(beforeById, after, hasSocial),
    colors: gainLoss(beforeById, after, hasColors),
    marks: gainLoss(beforeById, after, hasMark),
    becameNull: linksBecameNull(beforeById, after),
    failedThisRun: failedThisRun(issues, today, names),
    marksAdded: added,
    marksRemoved: removed,
  };
}

/* ------------------------------------------------------------------ */
/* PR body                                                            */
/* ------------------------------------------------------------------ */

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function namesList(items: readonly NamedId[]): string {
  if (!items.length) return "none";
  const shown = items.slice(0, MAX_ROWS).map((n) => `${escapeCell(n.name)} (${n.unit_id})`).join(", ");
  return items.length > MAX_ROWS ? `${shown}, and ${items.length - MAX_ROWS} more` : shown;
}

function gainsLossesLines(label: string, g: GainLoss): string[] {
  if (!g.gained.length && !g.lost.length) return [];
  const out = [`**${label}:**`];
  if (g.gained.length) out.push(`- Gained: ${namesList(g.gained)}`);
  if (g.lost.length) out.push(`- Lost: ${namesList(g.lost)}`);
  out.push("");
  return out;
}

/**
 * The PR description: a before/after/gained/lost table for visit pages, social accounts, colors, and marks; this
 * run's failed and newly-null links; and marks added or removed. See specs/school-identity/follow-ups.md, "The
 * monthly refresh".
 */
export function prBody(diff: IdentityDiff): string {
  const lines: string[] = [];
  lines.push(
    "Monthly identity refresh: `npm run sync-wikidata`, `npm run probe-sites`, `npm run sync-brand` " +
      '(specs/school-identity/follow-ups.md, "The monthly refresh").',
    "",
  );

  lines.push("## Summary", "");
  lines.push("| | Before | After | Gained | Lost |", "|---|---|---|---|---|");
  const row = (label: string, g: GainLoss) => `| ${label} | ${g.before} | ${g.after} | ${g.gained.length} | ${g.lost.length} |`;
  lines.push(row("Visit page", diff.visit), row("Social accounts", diff.social), row("Colors", diff.colors), row("Marks", diff.marks));
  lines.push("");

  const changeLines = [...gainsLossesLines("Visit page", diff.visit), ...gainsLossesLines("Social accounts", diff.social), ...gainsLossesLines("Colors", diff.colors)];
  if (changeLines.length) lines.push("## What changed", "", ...changeLines);

  lines.push("## Links that failed this run", "");
  if (!diff.failedThisRun.length) {
    lines.push("No stored link failed a liveness check this run.");
  } else {
    lines.push(
      `${diff.failedThisRun.length} link${diff.failedThisRun.length === 1 ? "" : "s"} failed this run's check (a link only goes null after ${FAILURES_TO_NULL} failed runs a day or more apart).`,
      "",
      "| College | Field | Failures | Last status | URL |",
      "|---|---|---|---|---|",
    );
    for (const f of diff.failedThisRun.slice(0, MAX_ROWS)) lines.push(`| ${escapeCell(f.name)} (${f.unit_id}) | ${f.field} | ${f.failures} | ${f.last_status ?? f.last_error ?? "—"} | ${f.url} |`);
    if (diff.failedThisRun.length > MAX_ROWS) lines.push("", `…and ${diff.failedThisRun.length - MAX_ROWS} more.`);
  }
  lines.push("");

  lines.push("## Links that became null", "");
  if (!diff.becameNull.length) {
    lines.push("No stored link went from a working value to null this run.");
  } else {
    lines.push(`${diff.becameNull.length} link${diff.becameNull.length === 1 ? "" : "s"} went null after a second failed check.`, "", "| College | Field | Was |", "|---|---|---|");
    for (const n of diff.becameNull.slice(0, MAX_ROWS)) lines.push(`| ${escapeCell(n.name)} (${n.unit_id}) | ${n.field} | ${n.was} |`);
    if (diff.becameNull.length > MAX_ROWS) lines.push("", `…and ${diff.becameNull.length - MAX_ROWS} more.`);
  }
  lines.push("");

  lines.push("## Marks added and removed", "");
  if (!diff.marksAdded.length && !diff.marksRemoved.length) {
    lines.push("No college's mark was added or removed this run.");
  } else {
    if (diff.marksAdded.length) {
      lines.push(`${diff.marksAdded.length} mark${diff.marksAdded.length === 1 ? "" : "s"} added:`, "", "| College | Source |", "|---|---|");
      for (const m of diff.marksAdded.slice(0, MAX_ROWS)) lines.push(`| ${escapeCell(m.name)} (${m.unit_id}) | ${m.source_url ?? "—"} |`);
      if (diff.marksAdded.length > MAX_ROWS) lines.push("", `…and ${diff.marksAdded.length - MAX_ROWS} more.`);
      lines.push("");
    }
    if (diff.marksRemoved.length) {
      lines.push(`${diff.marksRemoved.length} mark${diff.marksRemoved.length === 1 ? "" : "s"} removed:`, "", "| College | Was |", "|---|---|");
      for (const m of diff.marksRemoved.slice(0, MAX_ROWS)) lines.push(`| ${escapeCell(m.name)} (${m.unit_id}) | ${m.source_url ?? "—"} |`);
      if (diff.marksRemoved.length > MAX_ROWS) lines.push("", `…and ${diff.marksRemoved.length - MAX_ROWS} more.`);
    }
  }
  lines.push("");

  lines.push(
    "---",
    "",
    "This PR changes `data/**` (and `public/brand/**` when a mark changed). It auto-merges once CI passes when this " +
      "run was started with auto-merge on; otherwise a comment below explains why it is waiting for a person.",
  );

  const body = lines.join("\n");
  const note = "\n\n…(cut to fit GitHub's limit on a PR description; the full lists are in this branch's data files)";
  return body.length <= PR_BODY_LIMIT ? body : body.slice(0, PR_BODY_LIMIT - note.length - 100) + note;
}

/* ------------------------------------------------------------------ */
/* Release note                                                       */
/* ------------------------------------------------------------------ */

/** The release note's slug, matching the branch `data/identity-refresh-<YYYYMMDD>` (specs/release-notes.md). */
export function releaseNoteSlug(date: string): string {
  return `identity-refresh-${date.replace(/-/g, "")}`;
}

function plural(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? "" : "s"}`;
}

/** The release note content (frontmatter + body) for one run's PR, written once the PR number is known. */
export function releaseNote(diff: IdentityDiff, pr: number, date: string): string {
  const net = (g: GainLoss) => g.gained.length - g.lost.length;
  const fmtNet = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
  const anyGainOrLoss = [diff.visit, diff.social, diff.colors, diff.marks].some((g) => g.gained.length || g.lost.length);

  const title = "Monthly refresh: links, social accounts, colors, and marks";
  const summaryBits: string[] = [];
  if (diff.visit.gained.length) summaryBits.push(`${plural(diff.visit.gained.length, "more campus visit page")}`);
  if (diff.social.gained.length) summaryBits.push(`${plural(diff.social.gained.length, "more social account")}`);
  if (diff.marksAdded.length) summaryBits.push(`${plural(diff.marksAdded.length, "new mark")}`);
  const summaryLine = summaryBits.length
    ? `This month's automatic refresh found ${summaryBits.join(", ")}.`
    : "This month's automatic refresh re-checked every college's site; nothing new to show this time.";

  const body = [
    "## What's new",
    "",
    anyGainOrLoss
      ? "- A regular monthly check of every college's own site refreshed campus visit pages, social accounts, colors, " +
        "and site marks. Most stay the same; a few gained one, and a few lost one when their site changed."
      : "- A regular monthly check of every college's own site found nothing new this time; see Behind the scenes for what it checked.",
    diff.becameNull.length ? `- ${plural(diff.becameNull.length, "stored link")} that stopped working went blank rather than point to a dead end.` : "",
    "",
    "## Behind the scenes",
    "",
    `- Visit pages: ${diff.visit.before} → ${diff.visit.after} (${fmtNet(net(diff.visit))}). Social accounts: ${diff.social.before} → ${diff.social.after} ` +
      `(${fmtNet(net(diff.social))}). Colors: ${diff.colors.before} → ${diff.colors.after} (${fmtNet(net(diff.colors))}). Marks: ${diff.marks.before} → ${diff.marks.after} (${fmtNet(net(diff.marks))}).`,
    diff.failedThisRun.length ? `- ${plural(diff.failedThisRun.length, "link")} failed this run's liveness check; a link only clears to null after ${FAILURES_TO_NULL} failed runs a day or more apart.` : "",
    diff.becameNull.length ? `- ${plural(diff.becameNull.length, "link")} cleared to null after a second failed check.` : "",
    diff.marksAdded.length || diff.marksRemoved.length ? `- Marks: ${diff.marksAdded.length} added, ${diff.marksRemoved.length} removed.` : "",
    "- See [specs/school-identity/follow-ups.md](../specs/school-identity/follow-ups.md) for the refresh's design.",
  ]
    .filter(Boolean)
    .join("\n");

  return ["---", `title: "${title.replace(/"/g, '\\"')}"`, `pr: ${pr}`, `date: ${date}`, "kind: data", `summary: ${summaryLine}`, "---", "", body, ""].join("\n");
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const ROOT = join(import.meta.dirname, "..");
const todayIso = () => new Date().toISOString().slice(0, 10);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

function main(): void {
  const mode = process.argv[2];

  if (mode === "due") {
    const probePath = arg("probe") ?? join(ROOT, "data", "site-probe.json");
    const today = arg("today") ?? todayIso();
    const entries = readJson<SiteProbeEntry[]>(probePath, []);
    const due = refreshDue(entries, today);
    console.error(`site-probe.json: ${entries.length} entries, newest retrieved ${newestRetrieved(entries) ?? "none"}; today ${today}; due=${due}`);
    console.log(due ? "true" : "false");
    return;
  }

  if (mode === "pr-body" || mode === "release-note") {
    const beforePath = arg("before");
    const afterPath = arg("after");
    const issuesPath = arg("issues");
    if (!beforePath || !afterPath || !issuesPath) {
      console.error("--before, --after, and --issues are required.");
      process.exit(1);
    }
    const before = JSON.parse(readFileSync(beforePath, "utf8")) as School[];
    const after = JSON.parse(readFileSync(afterPath, "utf8")) as School[];
    const issues = readJson<LinkIssue[]>(issuesPath, []);
    const today = arg("today") ?? todayIso();
    const diff = diffIdentity(before, after, issues, today);

    if (mode === "pr-body") {
      console.log(prBody(diff));
      return;
    }

    const pr = Number(arg("pr"));
    const date = arg("date");
    const out = arg("out");
    if (!Number.isInteger(pr) || pr <= 0 || !date || !out) {
      console.error("release-note requires --pr <n>, --date <YYYY-MM-DD>, and --out <file>.");
      process.exit(1);
    }
    writeFileSync(out, releaseNote(diff, pr, date));
    console.log(`Wrote ${out}`);
    return;
  }

  console.error("Usage: identity-refresh.mts <due|pr-body|release-note> …");
  process.exit(1);
}

// Only run the CLI when this file is the entry point (so tests can import the functions above without side effects).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
