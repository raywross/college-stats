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
import type { REPORTED_MODELS, ReviewItem, ReviewQueueFile, RunSummary } from "../lib/reported.ts";

type ModelJob = keyof typeof REPORTED_MODELS;

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

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/* ------------------------------------------------------------------ */
/* PR body                                                             */
/* ------------------------------------------------------------------ */

/**
 * The PR description: counts and cost from the run summary, the circuit-breaker status, and a table of this run's
 * review-queue items with a note on how to resolve one. See specs/college-reported-data.md#publishing.
 */
export function prBody(summary: RunSummary, queue: ReviewQueueFile): string {
  const runItems = itemsForRun(queue, summary.run);
  // Sites that block us or files that are gone: listed apart from check failures (no model can fix them).
  const isUnreachable = (item: ReviewItem) => item.failures.length > 0 && item.failures.every((f) => f.check === "unreachable");
  const items = runItems.filter((i) => !isUnreachable(i));
  const unreachable = runItems.filter(isUnreachable);
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
  lines.push(`| Published | ${summary.published} |`);
  lines.push(`| Changed from the last publish | ${summary.changed} |`);
  lines.push(`| Failed a check (sent to review) | ${summary.failed} |`);
  lines.push(`| Unreachable (site blocks us or file missing; no model call) | ${summary.unreachable ?? 0} |`);
  lines.push(`| Next CDS edition guessed (no model call) | ${summary.guessed ?? 0} |`);
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
    lines.push("Not tripped. Failure and change shares were within the limits in `CIRCUIT_BREAKER` (lib/reported.ts).");
  }
  lines.push("");

  lines.push("## Review queue", "");
  if (items.length === 0) {
    lines.push(
      unreachable.length
        ? "No value from this run failed a check (the colleges that couldn't be fetched are listed below)."
        : "Nothing from this run needs a person — every attempted value either published or was unchanged.",
    );
  } else {
    lines.push(
      `${items.length} item${items.length === 1 ? "" : "s"} failed a check and did **not** publish. Resolve one by ` +
        `fixing its recipe in \`data/college-sources.json\` (or adding a manual override), then re-running ` +
        `\`npm run sync-college-reported -- --college <unit_id>\`.`,
      "",
      "| College | Term | Failed checks | URL |",
      "|---|---|---|---|",
    );
    for (const item of items) {
      const term = item.entering_term ?? "unknown";
      const checks = item.failures.map((f) => `${f.check} (${f.detail})`).join("; ");
      const url = item.urls[0] ?? "";
      lines.push(`| ${escapeCell(item.name)} (${item.unit_id}) | ${escapeCell(term)} | ${escapeCell(checks)} | ${url} |`);
    }
  }
  lines.push("");

  if (unreachable.length) {
    lines.push(
      "## Unreachable",
      "",
      `${unreachable.length} college${unreachable.length === 1 ? "" : "s"} couldn't be fetched at all (robots.txt, a ` +
        `block, or a missing file). No model was called and the circuit breaker doesn't count them. Fix by finding a ` +
        `URL we may fetch, or leave it to the federal figures.`,
      "",
      "| College | Why | URL |",
      "|---|---|---|",
    );
    for (const item of unreachable) {
      lines.push(`| ${escapeCell(item.name)} (${item.unit_id}) | ${escapeCell(item.failures.map((f) => f.detail).join("; "))} | ${item.urls[0] ?? ""} |`);
    }
    lines.push("");
  }

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

  return lines.join("\n");
}

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
      `college${summary.discovered === 1 ? "" : "s"} discovered, ${summary.guessed ?? 0} found by guessing next year's file name, ${summary.escalated} escalated.`,
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
    console.error("Usage: college-reported-pr-body.mts <body|note> --summary <file> --queue <file> [--pr <n> --date <YYYY-MM-DD> --out <file>]");
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

  if (mode === "body") {
    console.log(prBody(summary, queue));
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
