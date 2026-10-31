/**
 * The identity-refresh workflow's due check (.github/workflows/identity-refresh.yml; specs/school-identity/follow-ups.md,
 * "The monthly refresh"). A pure function, unit-tested without a real run (tests/identity-refresh.test.mts), and a small
 * CLI for the workflow.
 *
 *   node scripts/identity-refresh.mts due [--store supabase|file:<dir>] [--probe <file>] [--today <YYYY-MM-DD>]
 *
 * "due" prints "true" or "false" to stdout and nothing else, so the workflow can capture it with
 * `due=$(node ... due)`. It reads the site probe's layer (`identity.probe`) from the store, or a site-probe.json-shaped
 * file with `--probe`. The run's results are a change set the console shows (no pull request, no release note: the
 * publisher puts them live; specs/data-platform/pipelines.md).
 */
import { existsSync, readFileSync } from "node:fs";
import type { SiteProbeEntry } from "../lib/identity-files";
import { flagValue, storeFromFlag } from "./lib/data-platform/store.mts";
import { readProbe } from "./lib/identity-store.mts";

/** A refresh is due once the newest site probe is at least this many days old (specs/school-identity/follow-ups.md). */
export const MIN_REFRESH_DAYS = 28;

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
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const todayIso = () => new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] !== "due") {
    console.error("Usage: identity-refresh.mts due [--store …] [--probe <file>] [--today <YYYY-MM-DD>]");
    process.exit(1);
  }
  const probePath = flagValue(argv, "--probe");
  const entries: SiteProbeEntry[] = probePath
    ? existsSync(probePath)
      ? JSON.parse(readFileSync(probePath, "utf8"))
      : []
    : await readProbe(storeFromFlag(flagValue(argv, "--store")));
  const today = flagValue(argv, "--today") ?? todayIso();
  const due = refreshDue(entries, today);
  console.error(`site probe: ${entries.length} entries, newest retrieved ${newestRetrieved(entries) ?? "none"}; today ${today}; due=${due}`);
  console.log(due ? "true" : "false");
}

// Only run the CLI when this file is the entry point (so tests can import the functions above without side effects).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
