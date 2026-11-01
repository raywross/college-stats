/**
 * School identity in the old file layout (specs/school-identity/README.md): `formatSchools`, the one-college-per-line
 * text of `colleges.json` the publisher renders (scripts/lib/data-platform/render.mts), and `loadIdentityInputs`, the
 * identity files of a folder in the old `data/` layout a caller names (an export, a test's scratch folder). The
 * pipelines read the data store's identity layers instead (scripts/lib/data-platform/layers.mts `loadIdentity`),
 * written by the identity producers (./identity-store.mts); the publisher applies them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../../lib/types";
import type { BrandColorEntry, BrandLogoEntry, LinkIssue, SiteProbeEntry, WikidataEntry } from "../../lib/identity-files";
import type { IdentityInputs } from "../../lib/identity.ts";

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

const byId = <T extends { unit_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.unit_id, r]));

/** Every identity input of the folder `dir` (the old data/ layout); a file that doesn't exist reads as empty. */
export function loadIdentityInputs(dir: string): IdentityInputs {
  const file = (name: string) => join(dir, name);
  const issues = new Map<string, LinkIssue[]>();
  for (const i of readJson<LinkIssue[]>(file("link-issues.json"), [])) issues.set(i.unit_id, [...(issues.get(i.unit_id) ?? []), i]);
  return {
    wikidata: byId(readJson<WikidataEntry[]>(file("wikidata.json"), [])),
    probe: byId(readJson<SiteProbeEntry[]>(file("site-probe.json"), [])),
    linkIssues: issues,
    brandColors: byId(readJson<BrandColorEntry[]>(file("brand-colors.json"), [])),
    brandLogos: byId(readJson<BrandLogoEntry[]>(file("brand-logos.json"), [])),
    brandOverrides: readJson(file("brand-overrides.json"), {}),
    overrides: readJson(file("overrides.json"), {}),
  };
}

/** One school per line, the format the publisher renders `colleges.json` in, so diffs stay readable. */
export function formatSchools(schools: readonly School[]): string {
  return `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`;
}
