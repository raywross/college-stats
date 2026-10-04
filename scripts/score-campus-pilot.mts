/**
 * Scores a campus-life pilot run against the hand-checked answer key (scripts/lib/campus-pilot/score.mts).
 *
 *   npm run score-campus-pilot -- --key <answer-key.json> [--report data/reports/campus-pilot-<run>.json]
 *
 * Default report: the newest data/reports/campus-pilot-*.json. Prints markdown tables (precision and recall per fact
 * type, discovery hit rate per source type, second-check agreement, cost per college and the full-run projection) and
 * writes them beside the report as campus-pilot-score-<run>.json / .md. No network, no model calls.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { score, scoreMarkdown, rates, type KeyFile } from "./lib/campus-pilot/score.mts";

const ROOT = join(import.meta.dirname, "..");
const REPORTS = join(ROOT, "data", "reports");
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const keyPath = arg("key");
if (!keyPath) throw new Error("--key <answer-key.json> is required");
const reportPath =
  arg("report") ??
  join(
    REPORTS,
    readdirSync(REPORTS)
      .filter((f) => /^campus-pilot-\d.*\.json$/.test(f))
      .sort()
      .at(-1) ?? ""
  );
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const key = JSON.parse(readFileSync(keyPath, "utf8")) as KeyFile;
const sources = JSON.parse(readFileSync(join(ROOT, "data", "campus-sources.json"), "utf8"));

const s = score({ results: report.results, recipes: sources.recipes, calls: report.calls, key });
const md = scoreMarkdown(s);
console.log(md);
const base = join(REPORTS, basename(reportPath).replace("campus-pilot-", "campus-pilot-score-").replace(/\.json$/, ""));
writeFileSync(`${base}.json`, `${JSON.stringify({ report: basename(reportPath), ...s, rates: Object.fromEntries(Object.entries(s.facts).map(([k, T]) => [k, rates(T)])) }, null, 1)}\n`);
writeFileSync(`${base}.md`, `${md}\n`);
