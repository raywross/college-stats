/**
 * Builds data/college-health.json, the compact input of the admin console's data health page
 * (specs/product/admin.md "Files the deploy must carry"): reads the five sources the health rules look at and the
 * dataset's lineage, and reduces them with lib/admin/health-files.ts. Used by `npm run college-health` (writes it),
 * `npm run check:college-health` (fails when the committed file is stale), and the tests.
 *
 * Sources: data/college-docs.json, data/cds-records/*.json, data/college-failures.json, data/review-queue.json,
 * data/link-issues.json, data/schools.json (lineage and core fields), data/meta.json (federal retrieval date).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../lib/types";
import {
  compactHealth,
  formatCompact,
  summarizeRecord,
  newer,
  type CompactHealth,
  type FailureRowLite,
  type HealthFiles,
  type HealthSchool,
  type LinkIssueRowLite,
  type ManifestDocLite,
  type RecordDocLite,
} from "../../lib/admin/health-files.ts";

/** The repository root, or the one named by COLLEGE_HEALTH_ROOT (tests point it at a fixture). */
export const REPO_ROOT = process.env.COLLEGE_HEALTH_ROOT ?? join(import.meta.dirname, "..", "..");

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

/** The five sources under `<root>/data`, each reduced to what health reads; a missing file is null. */
export function readHealthFilesFromDisk(root: string = REPO_ROOT): HealthFiles & { updated: (string | null)[] } {
  const data = join(root, "data");
  const docs = readJson<{ updated?: string | null; documents: ManifestDocLite[] }>(join(data, "college-docs.json"));
  const failures = readJson<{ generated?: string | null; rows: FailureRowLite[] }>(join(data, "college-failures.json"));
  const queue = readJson<{ updated?: string | null; items: { unit_id: string }[] }>(join(data, "review-queue.json"));
  const links = readJson<LinkIssueRowLite[]>(join(data, "link-issues.json"));
  const recordsDir = join(data, "cds-records");
  let records: Map<string, RecordDocLite[]> | null = null;
  if (existsSync(recordsDir)) {
    // One file at a time: the records are 28 MB together and health reads only which calls ran and when.
    records = new Map();
    for (const file of readdirSync(recordsDir).filter((f) => f.endsWith(".json"))) {
      const rec = JSON.parse(readFileSync(join(recordsDir, file), "utf8")) as { unit_id: string };
      records.set(rec.unit_id, summarizeRecord(rec as Parameters<typeof summarizeRecord>[0]));
    }
  }
  const counts = new Map<string, number>();
  for (const item of queue?.items ?? []) counts.set(item.unit_id, (counts.get(item.unit_id) ?? 0) + 1);
  return {
    manifest: docs?.documents ?? null,
    records,
    failures: failures?.rows ?? null,
    queue: queue ? counts : null,
    linkIssues: links,
    updated: [docs?.updated ?? null, failures?.generated ?? null, queue?.updated ?? null],
  };
}

/** The compact file for the sources under `root`, and its text. `generated` is the newest date the sources carry. */
export function buildCollegeHealth(root: string = REPO_ROOT, opts: { generated?: string } = {}): { compact: CompactHealth; text: string; missing: string[] } {
  const files = readHealthFilesFromDisk(root);
  const missing = [
    files.manifest ? null : "data/college-docs.json",
    files.records ? null : "data/cds-records/",
    files.failures ? null : "data/college-failures.json",
    files.queue ? null : "data/review-queue.json",
    files.linkIssues ? null : "data/link-issues.json",
  ].filter((m): m is string => m !== null);
  const schools = readJson<School[]>(join(root, "data", "schools.json"));
  const meta = readJson<{ retrieved?: string }>(join(root, "data", "meta.json"));
  if (!schools) missing.push("data/schools.json");
  if (missing.length) return { compact: null as never, text: "", missing };
  const metaRetrieved = meta?.retrieved ?? null;
  const generated = opts.generated ?? [...files.updated, metaRetrieved].reduce<string | null>((acc, d) => newer(acc, d), null);
  if (!generated) throw new Error("college-health: the sources carry no date; pass --date");
  const compact = compactHealth(files, schools as unknown as HealthSchool[], { metaRetrieved, generated });
  return { compact, text: formatCompact(compact), missing };
}

/** Unit ids whose line differs between two files' text (in either), for the staleness message. */
export function differingColleges(committed: string, built: string): string[] {
  const lines = (text: string) => new Map(text.split("\n").flatMap((l) => (/^"\d+": /.test(l) ? [[l.slice(1, l.indexOf('"', 1)), l.replace(/,$/, "")] as const] : [])));
  const a = lines(committed);
  const b = lines(built);
  return [...new Set([...a.keys(), ...b.keys()])].filter((u) => a.get(u) !== b.get(u)).sort((x, y) => Number(x) - Number(y));
}
