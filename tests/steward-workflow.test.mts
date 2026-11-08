/**
 * .github/workflows/steward.yml (specs/product/data-steward.md "Where it runs"; the build brief's "Workflow"): its
 * triggers and inputs, its permissions (no contents: write anywhere; the apply job alone may start the publisher),
 * the secrets it reads and passes, the skip when one is missing, the gate after a college-reported run, and the
 * Jobs registry's row. Read as text, as the repo's other workflow tests do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOBS, jobById, jobByWorkflow } from "../lib/jobs/registry.ts";

const ROOT = join(import.meta.dirname, "..");
const yml = readFileSync(join(ROOT, ".github/workflows/steward.yml"), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

/** A job's block (from `  <name>:` to the next job or the end). */
function job(name: string): string {
  const m = yml.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`));
  assert.ok(m, `job ${name}`);
  return m[1];
}

/** The workflow_dispatch inputs and their defaults. */
function inputs(): Map<string, string> {
  const block = yml.match(/\n  workflow_dispatch:\n    inputs:\n((?: {6,}.*\n|\s*\n)+)/)![1];
  const out = new Map<string, string>();
  for (const m of block.matchAll(/^ {6}([a-z_]+):\n((?: {8,}.*\n)*)/gm)) out.set(m[1], /default: (.*)/.exec(m[2])?.[1] ?? "");
  return out;
}

/** The scheduled GitHub jobs other than the Steward itself: every one is reviewed after it completes. */
const reviewed = JOBS.filter((j) => j.runner === "github" && j.schedules.length > 0 && j.workflow !== "steward.yml");
const workflowName = (file: string) => /^name: (.+)$/m.exec(readFileSync(join(ROOT, ".github/workflows", file), "utf8"))![1].trim();

test("triggers: after every scheduled workflow, by hand with the contract's inputs, and the weekly audit", () => {
  const m = yml.match(/\n  workflow_run:\n    workflows: \[(.*)\]\n    types: \[completed\]\n/);
  assert.ok(m, "workflow_run with a workflows list");
  const listed = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(listed.sort(), reviewed.map((j) => workflowName(j.workflow!)).sort(), "workflow_run lists every scheduled workflow by its name");
  assert.ok(listed.includes("College-reported data"));
  assert.ok(!listed.includes(workflowName("steward.yml")), "the Steward never triggers itself");
  assert.deepEqual([...yml.matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm)].map((m) => m[1]), ["0 9 * * 0"]);
  const ins = inputs();
  assert.deepEqual([...ins.keys()], ["mode", "budget", "cause", "unit", "proposal", "request_id", "job", "run"]);
  assert.equal(ins.get("budget"), '"20"');
  assert.equal(ins.get("request_id"), '""');
  assert.equal(ins.get("job"), '""');
  assert.equal(ins.get("run"), '""');
  assert.match(yml, /options: \[run, audit, apply, answer, review\]/);
  assert.match(yml, /^run-name: .*inputs\.request_id.*$/m);
  // The budgets by trigger: $5 after a pipeline run, $10 for the audit, the input's on dispatch.
  assert.match(job("steward"), /workflow_run\) mode=run; budget=5 ;;/);
  assert.match(job("steward"), /schedule\) mode=audit; budget=10 ;;/);
});

test("permissions: contents: read everywhere, no write to the repository, actions: write only where apply starts the publisher", () => {
  assert.match(yml, /\npermissions:\n  contents: read\n/);
  assert.doesNotMatch(yml, /contents: write/);
  assert.doesNotMatch(yml, /pull-requests: write|issues: write|repository_dispatch|git push|gh pr /);
  assert.doesNotMatch(job("steward"), /actions: write/);
  assert.match(job("steward"), /permissions:\n      contents: read\n      actions: read\n/);
  assert.match(job("apply"), /permissions:\n      contents: read\n      actions: write\n/);
  // The review job may start a job's workflow again or the publisher; the script holds the allowlist.
  assert.match(job("review"), /permissions:\n      contents: read\n      actions: write\n/);
  assert.doesNotMatch(job("review"), /gh workflow run/);
  // The Steward job dispatches nothing; apply starts only the publisher, and only when a record changed.
  assert.doesNotMatch(job("steward"), /gh workflow run|dispatches/);
  assert.match(job("apply"), /if: steps\.apply\.outputs\.publish == 'true'\n[\s\S]*gh workflow run publish-snapshot\.yml/);
  assert.equal((yml.match(/gh workflow run/g) ?? []).length, 1);
});

test("secrets: only the ones it reads, the data project's with the PROD_ fallback, and a notice when one is missing", () => {
  const secrets = [...new Set([...yml.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(secrets, ["ANTHROPIC_API_KEY", "COLLEGE_REPORTED_TOKEN", "CRON_SECRET", "DATA_SUPABASE_SECRET_KEY", "DATA_SUPABASE_URL", "PROD_SUPABASE_SECRET_KEY", "PROD_SUPABASE_URL"]);
  // CRON_SECRET reaches only the review's step (restarting a Vercel job); nothing else.
  assert.equal((yml.match(/secrets\.CRON_SECRET/g) ?? []).length, 1);
  assert.match(job("review"), /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
  assert.match(yml, /DATA_SUPABASE_URL: \$\{\{ secrets\.DATA_SUPABASE_URL \|\| secrets\.PROD_SUPABASE_URL \}\}/);
  assert.match(yml, /DATA_SUPABASE_SECRET_KEY: \$\{\{ secrets\.DATA_SUPABASE_SECRET_KEY \|\| secrets\.PROD_SUPABASE_SECRET_KEY \}\}/);
  // The API key reaches only the check, the Steward's own step, and the review's step; apply never gets it.
  assert.equal((yml.match(/ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/g) ?? []).length, 3);
  assert.doesNotMatch(job("apply"), /ANTHROPIC_API_KEY/);
  const s = job("steward");
  assert.match(s, /::notice::ANTHROPIC_API_KEY is not set; no Steward run\./);
  assert.match(s, /::notice::DATA_SUPABASE_URL or DATA_SUPABASE_SECRET_KEY is not set/);
  assert.match(s, /echo "ready=false" >> "\$GITHUB_OUTPUT"/);
  // Every step after the check runs only when ready.
  const after = s.slice(s.indexOf("- uses: actions/checkout@v4"));
  for (const step of after.split(/\n      - /).slice(1)) assert.match(step, /if: steps\.secrets\.outputs\.ready == 'true'/, step.slice(0, 60));
  assert.match(job("apply"), /::notice::DATA_SUPABASE_URL or DATA_SUPABASE_SECRET_KEY is not set; nothing applied\./);
  // Inputs reach the shell through env, never pasted into a script.
  assert.doesNotMatch(yml, /run: .*\$\{\{ inputs\./);
  assert.doesNotMatch(yml, /^\s+(npm|gh|if|echo|case).*\$\{\{ inputs\./m);
});

test("steps: the snapshot, pdftotext, the document cache restored only, the gate after college-reported, exit 2 not a failure", () => {
  const s = job("steward");
  assert.match(s, /npm run fetch-snapshot/);
  assert.match(s, /poppler-utils/);
  assert.match(s, /uses: actions\/cache\/restore@v4/);
  assert.doesNotMatch(yml, /uses: actions\/cache@/);
  assert.match(s, /\.name == "Run the ingestion pipeline" or \.name == "Collect the open batches"/);
  assert.match(s, /if: steps\.gate\.outputs\.go == 'true'/);
  assert.match(s, /npm run steward -- --store supabase --mode "\$MODE" --budget "\$BUDGET"/);
  assert.match(s, /if \[ "\$code" -eq 2 \]; then[\s\S]*exit 0/);
  assert.match(job("apply"), /npm run steward -- --store supabase --mode apply --proposal "\$PROPOSAL"/);
  // One Steward run at a time, on the steward job only: a review never waits behind a 90-minute run.
  assert.match(s, /concurrency:\n      group: steward\n      cancel-in-progress: false\n/);
  assert.doesNotMatch(job("review"), /concurrency:/);
  assert.match(pkg.scripts.steward, /scripts\/steward\.mts$/);
});

test("the Jobs registry lists the Steward with the workflow's schedule and its spec", () => {
  const j = jobById("data-steward")!;
  assert.equal(j.runner, "github");
  assert.equal(j.workflow, "steward.yml");
  assert.equal(jobByWorkflow("steward.yml")?.id, "data-steward");
  assert.deepEqual(j.schedules.map((s) => s.cron), ["0 9 * * 0"]);
  assert.equal(j.spec, "specs/product/data-steward.md");
});

test("review: every scheduled workflow maps to its job id; dispatch inputs reach the script through env; the half-hourly idle collect is skipped", () => {
  const r = job("review");
  assert.match(yml, /\n  steward:\n    if: \(github\.event_name == 'workflow_run' && github\.event\.workflow_run\.name == 'College-reported data'\)/, "the run path stays college-reported's alone");
  assert.match(r, /if: github\.event_name == 'workflow_run' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.mode == 'review'\)/);
  const cases = new Map([...r.matchAll(/^\s+([a-z0-9-]+\.yml)\) job=([a-z0-9-]+) ;;$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual([...cases.keys()].sort(), reviewed.map((j) => j.workflow!).sort(), "the gate maps every reviewed workflow");
  for (const [file, id] of cases) assert.equal(jobByWorkflow(file)?.id, id, `${file} maps to its registry job`);
  assert.match(r, /\*\) echo "::notice::No job for/);
  assert.match(r, /IN_JOB: \$\{\{ inputs\.job \}\}/);
  assert.match(r, /IN_RUN: \$\{\{ inputs\.run \}\}/);
  assert.match(r, /\[\[ "\$job" =~ \^\[a-z\]\[a-z0-9-\]\{0,40\}\$ \]\]/);
  assert.match(r, /\[\[ "\$run" =~ \^\[0-9\]\{1,20\}\$ \]\]/);
  assert.match(r, /if \[ "\$job" = "college-reported" \] && \[ "\$WF_CONCLUSION" = "success" \]/);
  assert.match(r, /npm run steward -- --store supabase --mode review --job "\$JOB" --run "\$RUN"/);
  // No ANTHROPIC_API_KEY check gates the review: without it the review is written with no note.
  assert.doesNotMatch(r, /ANTHROPIC_API_KEY is not set/);
});
