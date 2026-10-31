/**
 * Scores a campus-life pilot run against the hand-checked answer key (scripts/lib/campus-pilot/score.mts).
 *
 *   npm run score-campus-pilot -- --key <answer-key.json> [--report <file>] [--store …] [--change-set <id>] [--dry-run]
 *
 * Default report: the newest campus-pilot-<run>.json in `reported.reports`; `--report` reads a file instead. The
 * answer key is reported.reports' `campus-pilot-answer-key.json` when `--key` names that file and it isn't on disk.
 * Prints markdown tables (precision and recall per fact type, discovery hit rate per source type, second-check
 * agreement, cost per college and the full-run projection) and writes them beside the report in `reported.reports`
 * as campus-pilot-score-<run>.json / .md (source `campus-pilot`; into the workflow's change set with --change-set).
 * No network, no model calls.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { score, scoreMarkdown, rates, type KeyFile } from "./lib/campus-pilot/score.mts";
import { latestCampusReport, readSourcesDoc } from "./lib/campus-pilot/store.mts";
import { flagValue, storeFromFlag } from "./lib/data-platform/store.mts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { changeSetFlag, withRunSet } from "./lib/data-platform/change-set.mts";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name: string) => flagValue(args, `--${name}`);

async function main() {
  const keyPath = arg("key");
  if (!keyPath) throw new Error("--key <answer-key.json> is required");
  const store = storeFromFlag(arg("store"));

  const reportPath = arg("report");
  const found = reportPath ? { key: basename(reportPath), body: JSON.parse(readFileSync(reportPath, "utf8")) as unknown } : await latestCampusReport(store);
  if (!found) throw new Error("no campus-pilot report in reported.reports (run npm run campus-pilot first, or pass --report)");
  const report = found.body as { results: Parameters<typeof score>[0]["results"]; calls: Parameters<typeof score>[0]["calls"] };

  const keyFile = join(ROOT, keyPath);
  const key = (existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")) : await store.readOne<KeyFile>(COLLECTIONS.reported.reports, basename(keyPath))) as KeyFile | null;
  if (!key) throw new Error(`${keyPath}: no answer key on disk or in reported.reports`);
  const sources = await readSourcesDoc(store, new Date().toISOString().slice(0, 10));

  const s = score({ results: report.results, recipes: sources.recipes, calls: report.calls, key });
  const md = scoreMarkdown(s);
  console.log(md);
  if (args.includes("--dry-run")) return;
  const base = found.key.replace("campus-pilot-", "campus-pilot-score-").replace(/\.json$/, "");
  const body = { report: found.key, ...s, rates: Object.fromEntries(Object.entries(s.facts).map(([k, T]) => [k, rates(T)])) };
  await withRunSet(store, { source: "campus-pilot", changeSet: changeSetFlag(args) }, (handle) =>
    handle.write(COLLECTIONS.reported.reports, [
      { key: `${base}.json`, body },
      { key: `${base}.md`, body: { text: `${md}\n` } },
    ])
  );
  console.log(`wrote ${base}.json and ${base}.md to reported.reports`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
