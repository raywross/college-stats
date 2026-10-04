/**
 * School identity on disk (specs/school-identity/README.md): loads the committed files `applyIdentity` reads
 * (lib/identity-files.ts) and re-applies identity to the committed data/schools.json (`mergeIdentity`), which
 * `npm run merge-identity`, `npm run sync-wikidata`, the site probe, and the brand step all call after writing their
 * files. `npm run sync-data` loads the same inputs and applies them to its fresh build.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../../lib/types";
import type { BrandColorEntry, BrandLogoEntry, LinkIssue, SiteProbeEntry, WikidataEntry } from "../../lib/identity-files";
import { addIdentityMeta, applyIdentity, type IdentityInputs } from "../../lib/identity.ts";
import { validateLineage } from "../../lib/lineage.ts";
import { writeAliasTable } from "./aliases-sync.mts";

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

const byId = <T extends { unit_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.unit_id, r]));

/** Every identity input under `root`/data; a file that doesn't exist yet reads as empty. */
export function loadIdentityInputs(root: string): IdentityInputs {
  const data = (name: string) => join(root, "data", name);
  const issues = new Map<string, LinkIssue[]>();
  for (const i of readJson<LinkIssue[]>(data("link-issues.json"), [])) issues.set(i.unit_id, [...(issues.get(i.unit_id) ?? []), i]);
  return {
    wikidata: byId(readJson<WikidataEntry[]>(data("wikidata.json"), [])),
    probe: byId(readJson<SiteProbeEntry[]>(data("site-probe.json"), [])),
    linkIssues: issues,
    brandColors: byId(readJson<BrandColorEntry[]>(data("brand-colors.json"), [])),
    brandLogos: byId(readJson<BrandLogoEntry[]>(data("brand-logos.json"), [])),
    brandOverrides: readJson(data("brand-overrides.json"), {}),
    overrides: readJson(data("overrides.json"), {}),
  };
}

/** One school per line, the format sync-data and merge-reported write, so diffs stay readable. */
export function formatSchools(schools: readonly School[]): string {
  return `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`;
}

export interface MergeIdentitySummary {
  schools: number;
  withVisit: number;
  withSocial: number;
  withColors: number;
  withLogo: number;
}

/**
 * Re-applies identity to every school in `root`/data/schools.json (no HD row, so the HD links on each school stay),
 * refreshes the identity sources in meta.json, and rebuilds data/aliases.json. Throws, writing nothing, when the
 * result fails the lineage check.
 */
export function mergeIdentity(root: string, opts: { dryRun?: boolean } = {}): MergeIdentitySummary {
  const schoolsPath = join(root, "data", "schools.json");
  const metaPath = join(root, "data", "meta.json");
  const schools: School[] = JSON.parse(readFileSync(schoolsPath, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(metaPath, "utf8"));
  const inputs = loadIdentityInputs(root);
  for (const s of schools) applyIdentity(s, inputs);
  addIdentityMeta(meta, inputs);
  const problems = validateLineage(schools, meta);
  if (problems.length) {
    const more = problems.length > 30 ? `\n  …and ${problems.length - 30} more` : "";
    throw new Error(`merge-identity: lineage check failed (${problems.length}); nothing written:\n  ${problems.slice(0, 30).join("\n  ")}${more}`);
  }
  if (!opts.dryRun) {
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    writeFileSync(schoolsPath, formatSchools(schools));
    writeAliasTable(root, { schools, hdRows: null, wikidata: inputs.wikidata });
  }
  return {
    schools: schools.length,
    withVisit: schools.filter((s) => s.links?.visit).length,
    withSocial: schools.filter((s) => s.social && Object.keys(s.social).length).length,
    withColors: schools.filter((s) => s.brand?.colors?.length).length,
    withLogo: schools.filter((s) => s.brand?.logo).length,
  };
}
