/**
 * Score the latest pilot run against the hand-checked answer key and write an accuracy report.
 *
 *   npm run score-college-reported            → prints the table, writes data/reports/college-reported-pilot-<date>.md
 *   npm run score-college-reported -- --quiet → table only, no report file
 *
 * Reads data/college-reported.json and data/review-queue.json (what the pipeline wrote), the pilot set and the key
 * in data/reference/. See specs/college-reported-data.md "Pilot".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scorePilot, summarize, type AnswerKeyEntry, type PilotCollege } from "../lib/reported-score.ts";
import { dataPaths, readQueue, readReported } from "./lib/college-reported/files.mts";

const ROOT = join(import.meta.dirname, "..");
const paths = dataPaths(ROOT);
const pilot = (JSON.parse(readFileSync(join(ROOT, "data", "reference", "college-reported-pilot.json"), "utf8")) as { colleges: PilotCollege[] }).colleges;
const key = JSON.parse(readFileSync(join(ROOT, "data", "reference", "college-reported-answer-key.json"), "utf8")) as AnswerKeyEntry[];
const reported = readReported(paths.reported);
const queue = readQueue(paths.queue);

const scores = scorePilot(pilot, key, reported.entries, queue.items);
const tiers = summarize(scores);

const lines: string[] = [];
lines.push(`# College-reported pilot: accuracy against the answer key`, ``, `Scored ${new Date().toISOString().slice(0, 10)} · published file updated ${reported.updated ?? "never"} · ${queue.items.length} in the review queue`, ``);
lines.push(`| Tier | Colleges | Had a newer figure | Found | Correct | Published where key found none |`, `|---|---|---|---|---|---|`);
for (const [tier, t] of Object.entries(tiers)) lines.push(`| ${tier} | ${t.colleges} | ${t.findable} | ${t.found} | ${t.correct} | ${t.unexpected} |`);
const all = Object.values(tiers).reduce((a, t) => ({ colleges: a.colleges + t.colleges, findable: a.findable + t.findable, found: a.found + t.found, correct: a.correct + t.correct, unexpected: a.unexpected + t.unexpected }), { colleges: 0, findable: 0, found: 0, correct: 0, unexpected: 0 });
lines.push(`| **all** | ${all.colleges} | ${all.findable} | ${all.found} | ${all.correct} | ${all.unexpected} |`, ``);
lines.push(`## Colleges`, ``, `| College | Tier | Outcome | Detail |`, `|---|---|---|---|`);
for (const s of scores) lines.push(`| ${s.name} | ${s.tier} | ${s.outcome}${s.queued ? " (queued)" : ""} | ${s.detail.replace(/\|/g, "/")} |`);
lines.push(``, `Outcomes: correct = same term and numbers within 0.5% (rates 0.1 pt); wrong = same term, a number differs; other-term = a different class published; missed = the key has a figure the pipeline didn't publish; unexpected = published where the key found nothing newer (a real find or a false positive: check it); quiet = nothing to find, nothing published; unchecked = not in the key.`, ``);

const text = lines.join("\n");
console.log(text);
if (!process.argv.includes("--quiet")) {
  const file = join(paths.reports, `college-reported-pilot-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, text);
  console.log(`\nWrote ${file}`);
}
