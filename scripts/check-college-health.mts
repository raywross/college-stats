/**
 * Checks the `health.colleges` document, the compact input of the admin console's data health page
 * (specs/product/admin.md; lib/admin/health-files.ts): it exists, is the compact format this code reads, is in its
 * canonical form, and has one line for each college of the bundled copy (`.data/snapshot/colleges.json`). When the
 * store also holds its sources (`reported.docs` and the rest; the mini fixture leaves them out as pipeline bookkeeping),
 * the document must equal a fresh build from them (a stale document fails, like the old file check).
 *
 *   npm run check:college-health                                # the mini fixture's layers (tests/fixtures/snapshot-mini/layers)
 *   npm run check:college-health -- --store supabase            # the data project (after `npm run fetch-snapshot`)
 *   npm run check:college-health -- --store file:/tmp/layers
 *
 * Part of `npm run verify`. Fix: `npm run college-health -- --store …`, which rewrites the document in a change set.
 */
import { join } from "node:path";
import { COMPACT_VERSION, formatCompact, parseCompact, type CompactHealth } from "../lib/admin/health-files.ts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { fileStore, flagValue, storeFromFlag, type DataStore } from "./lib/data-platform/store.mts";
import { REPO_ROOT, readBundledColleges } from "./lib/data-platform/bundled.mts";
import { HEALTH_KEY, deriveHealth, readFailureRows, readLinkIssueRows } from "./lib/college-reported/derived.mts";
import { loadReportedState, readMeta } from "./lib/college-reported/state.mts";
import { emptySummaryV3 } from "./lib/college-reported/models.mts";
import { differingColleges } from "./lib/college-health.mts";

const MINI_LAYERS = join(REPO_ROOT, "tests", "fixtures", "snapshot-mini", "layers");

const fail = (lines: string[]): never => {
  for (const l of lines) console.error(l);
  process.exit(1);
};

async function main(): Promise<void> {
  const flag = flagValue(process.argv.slice(2), "--store");
  const store: DataStore = flag ? storeFromFlag(flag) : fileStore(MINI_LAYERS);
  const where = flag ?? "the mini fixture's layers";
  const body = await store.readOne<CompactHealth>(COLLECTIONS.health.colleges, HEALTH_KEY);
  if (!body) fail([`health.colleges: ${where} has no health document. Run \`npm run college-health -- --store …\`.`]);
  let doc: CompactHealth;
  try {
    doc = parseCompact(JSON.stringify(body));
  } catch {
    return fail([`health.colleges: not version ${COMPACT_VERSION} of the compact health document. Run \`npm run college-health -- --store …\`.`]);
  }
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}/.test(doc.generated)) problems.push(`generated "${doc.generated}" isn't an ISO date`);
  const canonical = formatCompact(doc);
  if (formatCompact(parseCompact(canonical)) !== canonical || JSON.stringify(JSON.parse(canonical)) !== JSON.stringify(body)) problems.push("the document isn't in its canonical form (formatCompact)");
  const colleges = new Set(readBundledColleges().map((s) => s.unit_id));
  const lines = new Set(Object.keys(doc.colleges));
  const absent = [...colleges].filter((id) => !lines.has(id));
  const extra = [...lines].filter((id) => !colleges.has(id));
  if (absent.length) problems.push(`${absent.length} college(s) of the bundled copy have no line, e.g. ${absent.slice(0, 5).join(", ")}`);
  if (extra.length) problems.push(`${extra.length} line(s) name a college the bundled copy lacks, e.g. ${extra.slice(0, 5).join(", ")}`);

  // Stale: rebuilt from the store's own sources, when it holds them.
  let rebuilt = false;
  if ((await store.read(COLLECTIONS.reported.docs)).size) {
    const state = await loadReportedState(store, emptySummaryV3("check-college-health", new Date().toISOString()));
    const rows = await readFailureRows(store);
    const meta = await readMeta(store);
    const { text } = deriveHealth({
      state,
      failures: { generated: rows.reduce((acc, r) => (r.last_seen > acc ? r.last_seen : acc), ""), counts: {}, rows },
      linkIssues: await readLinkIssueRows(store),
      schools: readBundledColleges(),
      metaRetrieved: meta?.retrieved ?? null,
    });
    rebuilt = true;
    if (text !== canonical) {
      const differing = differingColleges(canonical, text);
      problems.push(`stale: the sources it is built from have changed (${differing.length ? `${differing.length} college(s) differ, e.g. ${differing.slice(0, 5).join(", ")}` : "the header differs"})`);
    }
  }
  if (problems.length) fail([`health.colleges (${where}): ${problems.length} problem(s)`, ...problems.map((p) => `  ${p}`), "Run `npm run college-health -- --store …`."]);
  console.log(`health.colleges (${where}): ok (${lines.size} colleges, generated ${doc.generated}${rebuilt ? ", a fresh build of its sources" : ""})`);
}

main().catch((err) => fail([`check:college-health: ${err instanceof Error ? err.message : String(err)}`]));
