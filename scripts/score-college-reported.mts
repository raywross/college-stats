/**
 * Score the latest pilot run against the hand-checked answer key and print an accuracy report.
 *
 *   npm run score-college-reported -- --store supabase                 → prints the table
 *   npm run score-college-reported -- --store supabase --out <file.md> → also writes the report to a file
 *
 * Reads `reported.entries` and `reported.review_queue` (what the pipeline wrote) from the store, and the reference
 * documents `college-reported-pilot` and `college-reported-answer-key` from the store's `reference.files` (else the
 * bundled copy). See specs/college-reported-data.md "Pilot".
 */
import { writeFileSync } from "node:fs";
import type { ReportedEntry, ReviewItem } from "../lib/reported.ts";
import { scorePilot, summarize, type AnswerKeyEntry, type PilotCollege } from "../lib/reported-score.ts";
import { COLLECTIONS, readLayer } from "./lib/data-platform/layers.mts";
import { flagValue } from "./lib/data-platform/store.mts";
import { storeFromArgv } from "./lib/data-platform/producer.mts";
import { readReferenceDocument } from "./lib/data-platform/bundled.mts";

async function main() {
  const argv = process.argv.slice(2);
  const store = storeFromArgv(argv);
  const pilot = (await readReferenceDocument<{ colleges: PilotCollege[] }>(store, "college-reported-pilot")).colleges;
  const key = await readReferenceDocument<AnswerKeyEntry[]>(store, "college-reported-answer-key");
  const header = (await store.readOne<{ updated?: string | null }>(COLLECTIONS.import.headers, "college-reported.json")) ?? {};
  const entries = [...(await readLayer<ReportedEntry>(store, COLLECTIONS.reported.entries)).values()];
  const items = [...(await readLayer<ReviewItem>(store, COLLECTIONS.reported.reviewQueue)).values()];

  const scores = scorePilot(pilot, key, entries, items);
  const tiers = summarize(scores);

  const lines: string[] = [];
  lines.push(`# College-reported pilot: accuracy against the answer key`, ``, `Scored ${new Date().toISOString().slice(0, 10)} · entries updated ${header.updated ?? "never"} · ${items.length} in the review queue`, ``);
  lines.push(`| Tier | Colleges | Had a newer figure | Found | Correct | Published where key found none |`, `|---|---|---|---|---|---|`);
  for (const [tier, t] of Object.entries(tiers)) lines.push(`| ${tier} | ${t.colleges} | ${t.findable} | ${t.found} | ${t.correct} | ${t.unexpected} |`);
  const all = Object.values(tiers).reduce((a, t) => ({ colleges: a.colleges + t.colleges, findable: a.findable + t.findable, found: a.found + t.found, correct: a.correct + t.correct, unexpected: a.unexpected + t.unexpected }), { colleges: 0, findable: 0, found: 0, correct: 0, unexpected: 0 });
  lines.push(`| **all** | ${all.colleges} | ${all.findable} | ${all.found} | ${all.correct} | ${all.unexpected} |`, ``);
  lines.push(`## Colleges`, ``, `| College | Tier | Outcome | Detail |`, `|---|---|---|---|`);
  for (const s of scores) lines.push(`| ${s.name} | ${s.tier} | ${s.outcome}${s.queued ? " (queued)" : ""} | ${s.detail.replace(/\|/g, "/")} |`);
  lines.push(``, `Outcomes: correct = same term and numbers within 0.5% (rates 0.1 pt); wrong = same term, a number differs; other-term = a different class published; missed = the key has a figure the pipeline didn't publish; unexpected = published where the key found nothing newer (a real find or a false positive: check it); quiet = nothing to find, nothing published; unchecked = not in the key.`, ``);

  const text = lines.join("\n");
  console.log(text);
  const out = flagValue(argv, "--out");
  if (out) {
    writeFileSync(out, text);
    console.log(`\nWrote ${out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
