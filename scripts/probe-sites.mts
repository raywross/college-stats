/**
 * The site probe (specs/school-identity/links.md, "As built: the probe"): visits each college's homepage and admissions
 * page politely (robots.txt, one request a second per host, an honest user agent) and records its campus visit page,
 * its homepage's social links and icon candidates, and whether each stored link still answers. Writes
 * data/site-probe.json and data/link-issues.json, then re-applies identity to data/schools.json (merge-identity).
 * Free: HTTP only. The Haiku picker for colleges the scorer misses runs only with --picker (paid, capped).
 *
 *   npm run probe-sites                            # every college in data/schools.json (10–30 minutes)
 *   npm run probe-sites -- --ids 139959,221999     # these colleges only; the file keeps everyone else's entries
 *   npm run probe-sites -- --sample 50             # a spread sample (the same 50 every run)
 *   npm run probe-sites -- --concurrency 48        # colleges at a time (default 32)
 *   npm run probe-sites -- --missing               # only colleges without a visit page yet
 *   npm run probe-sites -- --picker --picker-cap 2 # Haiku picks the visit page where the scorer found none; stops at $2
 *
 * The links probed are the ones data/schools.json stores plus the IPEDS directory's (the cached HD file under
 * .cache/ipeds, if any), so a run before the next full sync still checks every HD link. `npm run sync-data -- --links`
 * runs the same probe right after a sync.
 */
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { VisitPicker, runSiteProbe, type ProbeSummary } from "./lib/site-probe.mts";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const number = (flag: string): number | undefined => {
  const v = value(flag);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive number, not "${v}"`);
  return n;
};

function report(s: ProbeSummary): void {
  const pct = (n: number) => `${n} (${s.colleges ? Math.round((n / s.colleges) * 100) : 0}%)`;
  const list = (o: Record<string, number>) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(", ") || "none";
  console.log(`\nSite probe: ${s.colleges} colleges in ${Math.round(s.seconds / 60)} min`);
  console.log(`  homepages read:        ${pct(s.homepages)}`);
  console.log(`  admissions pages read: ${pct(s.admissionsPages)}`);
  console.log(`  visit pages:           ${pct(s.visit)}${s.visitByPicker ? ` (${s.visitByPicker} by the picker)` : ""}`);
  console.log(`  virtual tour only:     ${s.virtualOnly}`);
  console.log(`  social links:          ${pct(s.anySocial)} with any; ${list(s.social)}`);
  console.log(`  best icon candidate:   touch icon ${s.icons["apple-touch-icon"]}, icon ${s.icons.icon}, fallback only ${s.icons.fallback}, none ${s.icons.none}`);
  console.log(`  links checked:         ${s.checks.total}; answered ${s.checks.ok}`);
  console.log(`    failed (counts):     ${list(s.checks.failed)}`);
  console.log(`    never counts:        ${list(s.checks.unknown)}`);
  console.log(`  robots.txt refusals:   ${s.robots.homepages} homepages, ${s.robots.admissions} admissions pages, ${s.robots.links} link checks`);
  console.log(`  hosts refusing a GET:  ${s.blockedHosts}`);
  console.log(`  link issues:           ${s.issues.total} (${s.issues.dead} links now null)`);
  if (s.picker) console.log(`  picker:                ${s.picker.calls} calls, $${s.picker.spent.toFixed(4)}; ${s.picker.skipped} skipped at the cap, ${s.picker.errors} errors`);
}

async function main() {
  const ids = value("--ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  let picker: VisitPicker | null = null;
  if (args.includes("--picker")) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("--picker needs ANTHROPIC_API_KEY (in .env.local)");
    const cap = number("--picker-cap") ?? 2;
    picker = new VisitPicker(new Anthropic(), { capUsd: cap, log: (m) => console.warn(m) });
    console.log(`  picker on: ${picker.model}, capped at $${cap}`);
  }
  const summary = await runSiteProbe(ROOT, {
    ids,
    sample: number("--sample"),
    missing: args.includes("--missing"),
    concurrency: number("--concurrency"),
    picker,
  });
  report(summary);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
