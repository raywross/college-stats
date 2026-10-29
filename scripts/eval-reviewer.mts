/**
 * npm run eval:reviewer: the reader's evaluation against the live model (specs/product/essays/reviewer.md "Evaluation,
 * before it ships and on every corpus change"). The owner runs it where ANTHROPIC_API_KEY lives (GitHub Actions; the
 * key is not in local .env files), on demand and before each REVIEW_METHOD bump; about $3 a run.
 *
 *   npm run eval:reviewer                       the thirty drafts, the ten refusals, the consistency set (three runs each)
 *   npm run eval:reviewer -- --only d01,d13     some drafts only (no refusals, no consistency)
 *   npm run eval:reviewer -- --no-consistency   skip the repeated runs
 *   npm run eval:reviewer -- --out <file>       write the summary elsewhere (default specs/product/essays/reviewer-eval.md)
 *   npm run eval:reviewer -- --sizes            print each request's size and the cost estimate; no key, no call
 *
 * Without the key it says so in one sentence and exits 1, before anything else runs.
 * Exit codes: 0 every target met; 1 no key or a run error; 2 a target missed (the summary is written either way).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!flag("--sizes") && !process.env.ANTHROPIC_API_KEY) {
  console.error("eval:reviewer needs ANTHROPIC_API_KEY (a repository secret in GitHub Actions; it is not in .env.local), so nothing was run.");
  process.exit(1);
}

// lib/essays/review.ts starts with `import "server-only"`, which Next.js resolves; under plain node it is an empty module.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => { url: string; shortCircuit?: boolean }): { url: string; shortCircuit?: boolean } }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const ROOT = join(import.meta.dirname, "..");

async function main() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { buildReviewRequest, readDraft, REVIEW_MAX_TOKENS } = await import("../lib/essays/review.ts");
  const { reviewContext } = await import("../lib/essays/review-context.ts");
  const { loadGuidance } = await import("../lib/essays/guidance.ts");
  const { REVIEW_METHOD, REVIEW_MODEL, NOTE_CATEGORIES } = await import("../lib/essays/rubric.ts");
  const { estimateTokens } = await import("./lib/college-reported/llm.mts");
  const { MODEL_PRICES } = await import("./lib/college-reported/models.mts");
  const ev = await import("./lib/essay-review/eval.mts");

  const fx = ev.loadFixtures();
  const guidance = loadGuidance();
  const price = MODEL_PRICES[REVIEW_MODEL].interactive;
  const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
  const drafts = only ? fx.drafts.filter((d) => only.includes(d.id)) : fx.drafts;
  const refusals = only ? [] : fx.refusals;
  const repeat = only || flag("--no-consistency") ? [] : fx.drafts.filter((d) => fx.consistency.includes(d.id));

  const promptText = (input: { prompt: { text: string | null; options: readonly string[] } }) => [input.prompt.text, ...input.prompt.options].filter(Boolean).join(" ");

  if (flag("--sizes")) {
    const seen = new Set<string>();
    let system = 0;
    let user = 0;
    for (const d of [...fx.drafts, ...fx.refusals]) {
      const input = ev.fixtureContextInput(d, fx);
      const built = buildReviewRequest({ kind: d.prompt.kind, guidance, context: reviewContext(input), body: d.body });
      if (!seen.has(built.system)) {
        seen.add(built.system);
        console.log(`system block for ${d.prompt.kind}: ${built.system.length.toLocaleString("en-US")} characters, about ${estimateTokens(built.system.length).toLocaleString("en-US")} tokens`);
      }
      system += estimateTokens(built.system.length);
      user += estimateTokens(built.user.length);
    }
    const n = fx.drafts.length + fx.refusals.length;
    console.log(`user turns (context and draft): about ${Math.round(user / n).toLocaleString("en-US")} tokens on average`);
    console.log(`system blocks: about ${Math.round(system / n).toLocaleString("en-US")} tokens on average; max_tokens ${REVIEW_MAX_TOKENS}`);
    return 0;
  }

  const client = new Anthropic({ maxRetries: 3, timeout: 180_000 });
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0 };
  const errors: string[] = [];

  async function run(d: { id: string; prompt: { kind: import("../lib/essays/prompts.ts").EssayKind }; body: string } & Parameters<typeof ev.fixtureContextInput>[0]) {
    const input = ev.fixtureContextInput(d, fx);
    try {
      const r = await readDraft(client, { kind: d.prompt.kind, guidance, context: reviewContext(input), body: d.body, promptText: promptText(input) });
      usage.calls++;
      usage.input += r.usage.input_tokens;
      usage.output += r.usage.output_tokens;
      usage.cacheWrite += r.usage.cache_creation_input_tokens;
      usage.cacheRead += r.usage.cache_read_input_tokens;
      process.stdout.write(`${d.id}: ${r.outcome}, ${r.notes.length} notes kept, ${r.dropped.length} dropped\n`);
      return r;
    } catch (e) {
      errors.push(`${d.id}: ${e instanceof Error ? e.message : String(e)}`);
      process.stdout.write(`${d.id}: error\n`);
      return null;
    }
  }

  // The drafts.
  const scores: import("./lib/essay-review/eval.mts").DraftScore[] = [];
  const dropReasons: Record<string, number> = {};
  for (const d of drafts) {
    const r = await run(d);
    if (!r) continue;
    for (const x of r.dropped) dropReasons[x.reason] = (dropReasons[x.reason] ?? 0) + 1;
    scores.push(ev.scoreDraft(d, r.notes));
  }
  const recall = ev.recallByCategory(drafts, scores);
  const overUnwarranted = scores.filter((s) => s.unwarranted > ev.TARGETS.unwarrantedPerDraft);

  // The refusals: no note may carry wording; what the guard had to drop is counted.
  const refusalRows: { id: string; outcome: string; kept: number; proseDropped: number; pass: boolean }[] = [];
  for (const d of refusals) {
    const r = await run(d);
    if (!r) continue;
    const proseDropped = r.dropped.filter((x) => ["prose", "fix", "quote_run"].includes(x.reason)).length;
    const leaked = r.notes.some((n) => (n.fix && n.category !== "mechanics") || (n.fix && n.fix.split(/\s+/).length > 8));
    refusalRows.push({ id: d.id, outcome: r.outcome, kept: r.notes.length, proseDropped, pass: !leaked });
  }

  // Consistency: three runs each.
  const consistencyRows: { id: string; spots: number; agreed: number; share: number }[] = [];
  for (const d of repeat) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = await run({ ...d, id: `${d.id}#${i + 1}` });
      if (r) runs.push(r.notes);
    }
    if (runs.length === 3) consistencyRows.push({ id: d.id, ...ev.consistency(runs) });
  }

  const cost = (usage.input * price.input + usage.output * price.output + usage.cacheWrite * price.cache_write_5m + usage.cacheRead * price.cache_read) / 1_000_000;
  const pass = recall.every((r) => r.pass) && overUnwarranted.length === 0 && refusalRows.every((r) => r.pass) && consistencyRows.every((r) => r.share >= ev.TARGETS.consistency) && errors.length === 0;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const today = new Date().toISOString().slice(0, 10);

  const lines = [
    "# The reader's evaluation",
    "",
    `> Written by \`npm run eval:reviewer\` on ${today} (REVIEW_METHOD \`${REVIEW_METHOD}\`, model \`${REVIEW_MODEL}\`). Fixtures: tests/fixtures/essays/ (written for the test; no real student's essay). Part of [reviewer.md](reviewer.md).`,
    "",
    `**${pass ? "Every target met." : "A target was missed."}** ${usage.calls} calls, ${usage.input.toLocaleString("en-US")} input tokens (${usage.cacheRead.toLocaleString("en-US")} read from the cache, ${usage.cacheWrite.toLocaleString("en-US")} written to it), ${usage.output.toLocaleString("en-US")} output tokens, about $${cost.toFixed(2)}.`,
    "",
    "## Planted issues found",
    "",
    "| Category | Planted | Found | Share | Target |",
    "|---|---|---|---|---|",
    ...recall.map((r) => `| ${r.category} | ${r.planted} | ${r.found} | ${pct(r.found, r.planted)} | ${Math.round(r.target * 100)}%${r.pass ? "" : " (missed)"} |`),
    "",
    `Notes on a spot the labels call deliberate: ${scores.reduce((a, s) => a + s.unwarranted, 0)} in all; drafts over ${ev.TARGETS.unwarrantedPerDraft}: ${overUnwarranted.length ? overUnwarranted.map((s) => s.id).join(", ") : "none"}. Notes matching no label (read these by hand): ${scores.reduce((a, s) => a + s.unlabeled, 0)}.`,
    "",
    `Dropped by the guard: ${Object.keys(dropReasons).length ? Object.entries(dropReasons).map(([k, v]) => `${k} ${v}`).join(", ") : "nothing"}.`,
    "",
    "## The refusal set",
    "",
    refusalRows.length ? "| Draft | Outcome | Notes kept | Wording the guard dropped | No prose shown |\n|---|---|---|---|---|\n" + refusalRows.map((r) => `| ${r.id} | ${r.outcome} | ${r.kept} | ${r.proseDropped} | ${r.pass ? "yes" : "no"} |`).join("\n") : "Not run.",
    "",
    "## Consistency (three runs each)",
    "",
    consistencyRows.length ? "| Draft | Spots noted | In two of three runs | Share |\n|---|---|---|---|\n" + consistencyRows.map((r) => `| ${r.id} | ${r.spots} | ${r.agreed} | ${pct(r.agreed, r.spots)} |`).join("\n") : "Not run.",
    "",
    ...(errors.length ? ["## Errors", "", ...errors.map((e) => `- ${e}`), ""] : []),
    `Categories: ${NOTE_CATEGORIES.join(", ")}.`,
    "",
  ];
  const out = value("--out") ?? join(ROOT, "specs", "product", "essays", "reviewer-eval.md");
  writeFileSync(out, lines.join("\n"));
  console.log(`\n${pass ? "Every target met" : "A target was missed"}; wrote ${out}. About $${cost.toFixed(2)}.`);
  return errors.length ? 1 : pass ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
