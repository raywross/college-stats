/**
 * Builds the two documents the college-reported workflow (.github/workflows/college-reported.yml) attaches to a
 * run's pull request: the PR body (counts, cost, circuit-breaker status, a table of this run's review-queue items)
 * and the release note (specs/release-notes.md). Pure functions so they're unit-tested without a real run
 * (tests/college-reported-pr-body.test.mts); a small CLI wraps them for the workflow.
 *
 *   node scripts/college-reported-pr-body.mts body  --summary <run-summary.json> --queue <review-queue.json>
 *   node scripts/college-reported-pr-body.mts note  --summary <run-summary.json> --queue <review-queue.json> --pr <n> --date <YYYY-MM-DD> --out <file>
 *
 * "body" prints the PR body to stdout. "note" writes the release note to --out (release-notes/<slug>.md).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { REPORTED_MODELS, ReportedEntry, ReportedFile, ReviewItem, ReviewQueueFile, RunSummary, RunSummaryV3 } from "../lib/reported.ts";
import type { School } from "../lib/types";
import { CDS_CODE, itemOfCode } from "../lib/cds-sections.ts";

type ModelJob = keyof typeof REPORTED_MODELS;

/**
 * `f.check === "unreachable"` is compared as a plain string, not against `CheckId`: a parallel branch is adding
 * that id to `lib/reported.ts`'s `CheckId` union, and this file must typecheck against either version of it.
 */
const UNREACHABLE_CHECK = "unreachable";
function isUnreachable(item: ReviewItem): boolean {
  return item.failures.some((f) => (f.check as string) === UNREACHABLE_CHECK);
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Total cost across every model job in a run's usage log. */
export function totalCost(summary: RunSummary): number {
  return Object.values(summary.usage).reduce((sum, u) => sum + u.cost_usd, 0);
}

/** This run's items only (`data/review-queue.json` accumulates across runs). */
export function itemsForRun(queue: ReviewQueueFile, run: string): ReviewItem[] {
  return queue.items.filter((item) => item.run === run);
}

/** This run's published entries only (`data/college-reported.json` accumulates across runs). */
export function entriesForRun(reported: ReportedFile, run: string): ReportedEntry[] {
  return reported.entries.filter((entry) => entry.run === run);
}

/** Any URL cited in an entry's lineage, for the "Published this run" table's source column. */
function entryUrl(entry: ReportedEntry): string {
  const rec = Object.values(entry.lineage).find((r) => r?.url);
  return rec?.url ?? "";
}

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

function num(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/* ------------------------------------------------------------------ */
/* PR body                                                             */
/* ------------------------------------------------------------------ */

/**
 * The PR description: counts and cost from the run summary, the circuit-breaker status, a "Published this run"
 * table of the colleges whose figures reached `data/schools.json` through this same PR (Decision 5,
 * specs/college-reported-round-2.md), an "Unreachable" list of review items blocked on a site (no model could have
 * fixed it), and a table of this run's remaining check-failure review-queue items. `reported` and `names` are
 * optional so existing callers (and the fixture-based tests written before Decision 5) keep working; without
 * `reported` the "Published this run" section is omitted, and without `names` a college is shown by its unit id.
 * See specs/college-reported-data.md#publishing.
 */
export function prBody(summary: RunSummary, queue: ReviewQueueFile, reported?: ReportedFile, names?: Map<string, string>): string {
  const items = itemsForRun(queue, summary.run);
  const unreachableItems = items.filter(isUnreachable);
  const checkFailureItems = items.filter((i) => !isUnreachable(i) && !i.code);
  // Round 3: entries keyed by college + edition + template code (specs/college-reported-round-3.md Decision 9).
  const perItem = items.filter((i) => !isUnreachable(i) && i.code);
  const nameFor = (unitId: string) => names?.get(unitId) ?? unitId;
  const lines: string[] = [];

  lines.push(`Run \`${summary.run}\` of the college-reported ingestion agent (specs/college-reported-data.md).`, "");
  if (summary.status === "stopped") {
    lines.push(
      `> **Stopped early** after ${summary.done ?? "?"} of ${summary.total ?? "?"} colleges: ${summary.stopped_reason ?? "no reason recorded"}. ` +
        `Everything below covers the colleges it finished; the rest are picked up by the next run. This PR does not auto-merge.`,
      "",
    );
  }

  lines.push("## Summary", "");
  lines.push(`| | |`, `|---|---|`);
  lines.push(`| Colleges attempted | ${summary.attempted} |`);
  lines.push(`| Documents read | ${summary.documents_read} |`);
  if (summary.guessed !== undefined) lines.push(`| Next-edition URL guessed (no discovery call) | ${summary.guessed} |`);
  if (summary.unreachable !== undefined) lines.push(`| Unreachable (site blocks us or file missing; no model call) | ${summary.unreachable} |`);
  lines.push(`| Published | ${summary.published} |`);
  lines.push(`| Changed from the last publish | ${summary.changed} |`);
  lines.push(`| Failed a check (sent to review) | ${summary.failed} |`);
  lines.push(`| Discovery run | ${summary.discovered} |`);
  lines.push(`| Escalated (one re-discovery or a stronger re-read) | ${summary.escalated} |`);
  lines.push(`| Cost | ${usd(totalCost(summary))} |`);
  lines.push("");

  lines.push("## Circuit breaker", "");
  if (summary.tripped) {
    lines.push(
      `**Tripped:** ${summary.tripped}. This run's output has not auto-merged — it points to a pipeline or model ` +
        `problem, not the data. Review before merging by hand.`,
    );
  } else {
    lines.push(
      isRound3(summary)
        ? "Not tripped. C1 failures, per-item failure shares in model reads, and changed values were within `CIRCUIT_BREAKER_V3` (lib/cds-checks.ts)."
        : "Not tripped. Failure and change shares were within the limits in `CIRCUIT_BREAKER` (lib/reported.ts)."
    );
  }
  lines.push("");
  if (isRound3(summary)) lines.push(...round3Sections(summary));

  if (reported) {
    const entries = entriesForRun(reported, summary.run);
    lines.push("## Published this run", "");
    if (entries.length === 0) {
      lines.push("No college's figures passed every check this run.");
    } else {
      lines.push(
        `${entries.length} college${entries.length === 1 ? "" : "s"}' figures reached \`data/schools.json\` in this ` +
          `same PR (specs/college-reported-round-2.md, Decision 5) — this PR's Vercel preview already shows them.`,
        "",
        "| College | Term | Kind | Applicants | Admitted | Enrolled | Rate | Source |",
        "|---|---|---|---|---|---|---|---|",
      );
      for (const entry of entries) {
        const a = entry.admissions;
        lines.push(
          `| ${escapeCell(nameFor(entry.unit_id))} (${entry.unit_id}) | ${escapeCell(a.entering_term)} | ${a.source_kind} | ` +
            `${num(a.applicants)} | ${num(a.admitted)} | ${num(a.enrolled)} | ${pct(a.acceptance_rate)} | ${entryUrl(entry)} |`,
        );
      }
    }
    lines.push("");
  }

  if (unreachableItems.length > 0) {
    lines.push("## Unreachable", "");
    lines.push(
      `${unreachableItems.length} college${unreachableItems.length === 1 ? "" : "s"} blocked the attempt (site ` +
        `blocked us, or a document 404ed) — no model could have fixed this, so these weren't counted as check ` +
        `failures by the circuit breaker. They're retried on the next run.`,
      "",
      "| College | URL | Why |",
      "|---|---|---|",
    );
    for (const item of unreachableItems) {
      const why = item.failures.find((f) => (f.check as string) === UNREACHABLE_CHECK)?.detail ?? "";
      lines.push(`| ${escapeCell(item.name)} (${item.unit_id}) | ${item.urls[0] ?? ""} | ${escapeCell(why)} |`);
    }
    lines.push("");
  }

  lines.push("## Review queue", "");
  if (checkFailureItems.length === 0 && perItem.length === 0) {
    lines.push("Nothing from this run needs a person — every attempted value either published, was unchanged, or was unreachable (see above).");
  } else if (checkFailureItems.length > 0) {
    lines.push(
      `${checkFailureItems.length} item${checkFailureItems.length === 1 ? "" : "s"} failed a check and did **not** publish. Resolve one by ` +
        `fixing its recipe in \`data/college-sources.json\` (or adding a manual override), then re-running ` +
        `\`npm run sync-college-reported -- --college <unit_id>\`.`,
      "",
      "| College | Term | Failed checks | URL |",
      "|---|---|---|---|",
    );
    for (const item of checkFailureItems) {
      const term = item.entering_term ?? "unknown";
      const checks = item.failures.map((f) => `${f.check} (${f.detail})`).join("; ");
      const url = item.urls[0] ?? "";
      lines.push(`| ${escapeCell(item.name)} (${item.unit_id}) | ${escapeCell(term)} | ${escapeCell(checks)} | ${url} |`);
    }
  }
  if (perItem.length > 0) {
    lines.push(...perItemTable(perItem));
  }
  lines.push("");

  lines.push("## Model usage", "");
  lines.push("| Job | Calls | Input tokens | Output tokens | Cost |", "|---|---|---|---|---|");
  for (const [job, usage] of Object.entries(summary.usage) as [ModelJob, RunSummary["usage"][ModelJob]][]) {
    lines.push(`| ${job} | ${usage.calls} | ${usage.input_tokens} | ${usage.output_tokens} | ${usd(usage.cost_usd)} |`);
  }
  lines.push("");

  lines.push(
    "---",
    "",
    "This PR changes `data/college-reported.json` and `data/college-sources.json`. It auto-merges only when the " +
      "circuit breaker didn't trip and the workflow was run (or scheduled) with auto-merge on; otherwise a comment " +
      "below explains why it is waiting for a person.",
  );

  // A last stop so the PR always opens: the run's data is on the branch either way.
  const body = lines.join("\n");
  const note = "\n\n…(cut to fit GitHub's limit on a PR description; the full lists are in the run summary and review queue on this branch)";
  return body.length <= PR_BODY_LIMIT ? body : body.slice(0, PR_BODY_LIMIT - note.length - 100) + note;
}

/** A round-3 run summary (specs/college-reported-round-3.md Decision 11) has `round: 3`. */
export function isRound3(summary: RunSummary): summary is RunSummaryV3 {
  return (summary as Partial<RunSummaryV3>).round === 3;
}

/**
 * Round 3's own sections: colleges whose every candidate host refuses us (for the owner to add by hand), the batches
 * (open ones keep the PR a draft), and the projection the run checked against its cap.
 */
export function round3Sections(summary: RunSummaryV3): string[] {
  const out: string[] = [];
  const blocked = summary.blocked_colleges ?? [];
  if (blocked.length) {
    out.push(
      "## Blocked colleges (for the owner)",
      "",
      `${blocked.length} college${blocked.length === 1 ? "" : "s"} whose every candidate host refuses our user agent; no money was spent on ` +
        "them. To add one: find the link in a browser, add it to `data/reference/cds-urls.json`, download the file, and run " +
        "`npm run archive-doc -- --college <unit_id> --file <path> --url <url>`.",
      "",
      "| College | Hosts |",
      "|---|---|",
      ...blocked.map((b) => `| ${escapeCell(b.name)} (${b.unit_id}) | ${escapeCell(b.hosts.join(", "))} |`),
      ""
    );
  }
  if (summary.batches.length || summary.open_batches) {
    out.push("## Batches", "");
    if (summary.open_batches) out.push(`${summary.open_batches} batch${summary.open_batches === 1 ? " is" : "es are"} still open (\`data/college-batches.json\`); the collect job finishes ${summary.open_batches === 1 ? "it" : "them"}.`, "");
    out.push("| Batch | Requests | Submitted | Ended | Succeeded | Errored | Expired | Reserved | Cost |", "|---|---|---|---|---|---|---|---|---|");
    for (const b of summary.batches) out.push(`| ${b.id} | ${b.requests} | ${b.submitted} | ${b.ended ?? "open"} | ${b.succeeded} | ${b.errored} | ${b.expired} | ${usd(b.reserved_usd)} | ${usd(b.cost_usd)} |`);
    out.push("");
  }
  if (summary.projection) {
    const p = summary.projection;
    out.push("## Projection", "", `This run: ${usd(p.run_usd ?? p.full_run_usd)}; the full run: ${usd(p.full_run_usd)} (${escapeCell(p.basis)}).`, "");
  }
  const types = Object.entries(summary.documents).filter(([, d]) => d.fetched || d.unchanged || d.model_calls);
  if (types.length) {
    out.push("## Documents by type", "", "| Type | Fetched | Unchanged | Archived | Model calls | No C/D split | Cost |", "|---|---|---|---|---|---|---|");
    for (const [type, d] of types) out.push(`| ${type} | ${d.fetched} | ${d.unchanged} | ${d.archived} | ${d.model_calls} | ${d.split_fallback} | ${usd(d.cost_usd)} |`);
    out.push("");
  }
  return out;
}

/**
 * Round 3's per-item rows: one per college + edition + template code that failed a check and didn't publish. Every
 * other item of the same document published on its own (an H2 failure never holds back C1).
 */
export function perItemTable(items: ReviewItem[]): string[] {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name) || (a.edition ?? "").localeCompare(b.edition ?? "") || (a.code ?? "").localeCompare(b.code ?? ""));
  const out = [
    "",
    `${items.length} item${items.length === 1 ? "" : "s"} from colleges' Common Data Sets failed a check and did **not** publish; ` +
      "every other item of the same document was judged on its own. A failure in a template workbook or fillable form is " +
      "the college's own file (never escalated); fix it with an override or wait for the college's corrected file.",
    "",
    "| College | Edition | Item | Value | Failed checks | URL |",
    "|---|---|---|---|---|---|",
  ];
  for (const item of sorted.slice(0, PER_ITEM_ROWS)) {
    const code = item.code ?? "";
    // A whole extraction call that failed is queued as "C-call" / "rest-call", not a template code.
    const label = CDS_CODE.test(code) ? `${itemOfCode(code)} · ${code}` : code.endsWith("-call") ? `whole ${code.slice(0, -5)} call` : code;
    const value = item.value === undefined || item.value === null ? "—" : String(item.value);
    const checks = item.failures.map((f) => `${f.check} (${f.detail})`).join("; ");
    out.push(`| ${escapeCell(item.name)} (${item.unit_id}) | ${item.edition ?? ""} | ${label} | ${escapeCell(value.slice(0, 40))} | ${escapeCell(checks.slice(0, 200))} | ${item.urls[0] ?? ""} |`);
  }
  if (sorted.length > PER_ITEM_ROWS) out.push("", `…and ${sorted.length - PER_ITEM_ROWS} more; every item is in \`data/review-queue.json\` on this branch.`);
  return out;
}

/**
 * Rows of the per-item table before it stops. GitHub refuses a PR body over 65,536 characters, and the first live run's
 * 330 items (about 400 characters a row) failed the PR step; 80 rows stay far under it with the rest of the body.
 */
export const PER_ITEM_ROWS = 80;
/** GitHub's limit on a pull request body, in characters. */
export const PR_BODY_LIMIT = 65_536;

/* ------------------------------------------------------------------ */
/* Release note                                                        */
/* ------------------------------------------------------------------ */

/** The release note's slug, matching the branch `data/college-reported-<run>` (specs/release-notes.md). */
export function releaseNoteSlug(run: string): string {
  return `college-reported-${run}`;
}

/**
 * The release note content (frontmatter + body) for one run's PR. Written only once the PR number is known
 * (specs/release-notes.md#writing-a-note-every-pr).
 */
export function releaseNote(summary: RunSummary, queue: ReviewQueueFile, pr: number, date: string): string {
  const items = itemsForRun(queue, summary.run);
  const title = `College-reported admissions: ${summary.published} new figure${summary.published === 1 ? "" : "s"} from colleges' own sites`;
  const summaryLine =
    summary.published > 0
      ? `${summary.published} college${summary.published === 1 ? "" : "s"} now show a newer admissions figure taken from their own Common Data Set or class profile.`
      : `This run found no college figures that passed every automated check; ${items.length} went to review.`;

  const body = [
    "## What's new",
    "",
    summary.published > 0
      ? `- ${summary.published} college profile${summary.published === 1 ? "" : "s"} show a newer admit rate or class size reported by the college itself, ` +
        `next to the federal figure, with the exact quote and link a popover away.`
      : "- No new figures published this run; see Behind the scenes.",
    items.length > 0
      ? `- ${items.length} more figure${items.length === 1 ? "" : "s"} didn't pass the automated checks and are waiting for a person to look at, listed in the pull request.`
      : "",
    "",
    "## Behind the scenes",
    "",
    `- Run \`${summary.run}\`: ${summary.attempted} colleges attempted, ${summary.documents_read} documents read, ` +
      `${summary.changed} value${summary.changed === 1 ? "" : "s"} changed from the last publish, ${summary.discovered} ` +
      `college${summary.discovered === 1 ? "" : "s"} re-discovered, ${summary.escalated} escalated (re-discovered once, or re-read by the stronger extractor).`,
    `- Cost: ${usd(totalCost(summary))}.`,
    summary.tripped ? `- Circuit breaker tripped (${summary.tripped}); this run waited for a person before merging.` : "",
    summary.status === "stopped" ? `- Stopped early after ${summary.done ?? "?"} of ${summary.total ?? "?"} colleges (${summary.stopped_reason ?? "no reason recorded"}); the rest follow in the next run.` : "",
    "- See [specs/college-reported-data.md](../specs/college-reported-data.md) for the pipeline and checks.",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `pr: ${pr}`,
    `date: ${date}`,
    "kind: data",
    `summary: ${summaryLine}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "body" && mode !== "note") {
    console.error(
      "Usage: college-reported-pr-body.mts <body|note> --summary <file> --queue <file> [--reported <file>] [--schools <file>] [--pr <n> --date <YYYY-MM-DD> --out <file>]",
    );
    process.exit(1);
  }
  const summaryPath = arg("summary");
  const queuePath = arg("queue");
  if (!summaryPath || !queuePath) {
    console.error("--summary and --queue are required.");
    process.exit(1);
  }
  const summary: RunSummary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const queue: ReviewQueueFile = JSON.parse(readFileSync(queuePath, "utf8"));
  const reportedPath = arg("reported");
  const reported: ReportedFile | undefined = reportedPath ? JSON.parse(readFileSync(reportedPath, "utf8")) : undefined;
  const schoolsPath = arg("schools");
  const names: Map<string, string> | undefined = schoolsPath
    ? new Map((JSON.parse(readFileSync(schoolsPath, "utf8")) as School[]).map((s) => [s.unit_id, s.name]))
    : undefined;

  if (mode === "body") {
    console.log(prBody(summary, queue, reported, names));
    return;
  }

  const pr = Number(arg("pr"));
  const date = arg("date");
  const out = arg("out");
  if (!Number.isInteger(pr) || pr <= 0 || !date || !out) {
    console.error("note mode requires --pr, --date (YYYY-MM-DD), and --out.");
    process.exit(1);
  }
  writeFileSync(out, releaseNote(summary, queue, pr, date));
  console.log(`Wrote ${out}`);
}

// Only run the CLI when this file is the entry point (so tests can import the functions above without side effects).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
