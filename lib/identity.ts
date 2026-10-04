/**
 * School identity (specs/school-identity/README.md): official links, social accounts, colors and marks, applied to
 * each school from committed files under data/ (shapes in lib/identity-files.ts). Pure, no file access:
 * `npm run sync-data` applies it to a fresh build and `npm run merge-identity` to the committed data/schools.json
 * (after `sync-wikidata`, the site probe, or the brand step), the same way, so the two can't disagree. Each part
 * lives in its own module; this file fixes their order. Every step replaces its own values and lineage, so applying
 * twice gives the same school.
 */
import type { DatasetMeta, LineageRecord, School } from "./types";
import type { BrandColorEntry, BrandLogoEntry, BrandOverride, LinkIssue, SiteProbeEntry, WikidataEntry } from "./identity-files";
import { lineageForPatch } from "./lineage.ts";
import { applyLinks } from "./links.ts";
import { applyProbeLinks } from "./site-probe.ts";
import { applySocial } from "./social.ts";
import { applyBrand } from "./brand-colors.ts";

/** Everything `applyIdentity` reads, loaded once per run (scripts/lib/identity-sync.mts). Missing files are empty. */
export interface IdentityInputs {
  /** data/wikidata.json, by unit id. */
  wikidata: Map<string, WikidataEntry>;
  /** data/site-probe.json, by unit id. */
  probe: Map<string, SiteProbeEntry>;
  /** data/link-issues.json, grouped by unit id. */
  linkIssues: Map<string, LinkIssue[]>;
  /** data/brand-colors.json, by unit id. */
  brandColors: Map<string, BrandColorEntry>;
  /** data/brand-logos.json, by unit id. */
  brandLogos: Map<string, BrandLogoEntry>;
  /** data/brand-overrides.json. */
  brandOverrides: Record<string, BrandOverride>;
  /** data/overrides.json; only each patch's links, social, and brand part is applied here. */
  overrides: Record<string, Record<string, unknown>>;
}

export function emptyIdentityInputs(): IdentityInputs {
  return { wikidata: new Map(), probe: new Map(), linkIssues: new Map(), brandColors: new Map(), brandLogos: new Map(), brandOverrides: {}, overrides: {} };
}

/**
 * Applies every identity part to one school, in place, and returns it:
 *   1. links from the IPEDS directory (lib/links.ts) when a fresh HD row is given; without one (merge-identity), the
 *      HD links already on the school stay
 *   2. the site probe's visit pages, liveness results, and redirects (lib/site-probe.ts)
 *   3. social accounts (lib/social.ts)
 *   4. colors and mark (lib/brand-colors.ts)
 *   5. corrections in data/overrides.json for links, social, and brand, last, so they win in both paths
 */
export function applyIdentity(school: School, inputs: IdentityInputs, hdRow?: Record<string, string>): School {
  const id = school.unit_id;
  applyLinks(school, hdRow);
  applyProbeLinks(school, inputs.probe.get(id), inputs.linkIssues.get(id) ?? []);
  applySocial(school, inputs.wikidata.get(id), inputs.probe.get(id));
  applyBrand(school, { colors: inputs.brandColors.get(id), logo: inputs.brandLogos.get(id), override: inputs.brandOverrides[id] });
  applyIdentityOverride(school, inputs.overrides[id]);
  return school;
}

/** Top-level School keys identity owns: their overrides are applied by `applyIdentity`. */
export const IDENTITY_KEYS = ["links", "social", "brand"] as const;

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function merge(cur: unknown, patch: unknown): unknown {
  if (!isPlainObject(cur) || !isPlainObject(patch)) return structuredClone(patch);
  const out: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) if (!k.startsWith("_")) out[k] = merge(out[k], v);
  return out;
}

/**
 * The links, social, and brand part of a data/overrides.json patch, merged into the school with the patch's lineage
 * (`lineageForPatch`, so an override without a source still fails). sync-data applies the whole patch again right
 * after, which sets the same values.
 */
export function applyIdentityOverride(school: School, patch: Record<string, unknown> | undefined): void {
  if (!patch || !IDENTITY_KEYS.some((k) => k in patch)) return;
  const part: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if ((IDENTITY_KEYS as readonly string[]).includes(k) || k.startsWith("_") || k === "cds") part[k] = v;
  }
  const explicit = patch.lineage as Record<string, LineageRecord> | undefined;
  if (explicit) part.lineage = Object.fromEntries(Object.entries(explicit).filter(([p]) => IDENTITY_KEYS.some((k) => p.startsWith(`${k}.`))));
  const lineage = lineageForPatch(school.unit_id, part);
  const target = school as unknown as Record<string, unknown>;
  for (const k of IDENTITY_KEYS) if (k in part) target[k] = merge(target[k], part[k]);
  school.lineage = { ...(school.lineage ?? {}), ...lineage };
}

/** The newest ISO date in `dates`, or null. */
function newest(dates: Iterable<string>): string | null {
  let best: string | null = null;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
}

/**
 * meta.json entries for the identity sources (Wikidata; Wikipedia's college color data), dated by the newest
 * retrieval in their files. Neither has a data year (UNDATED_SOURCES in lib/fields.ts), so neither has a vintage.
 */
export function addIdentityMeta(meta: DatasetMeta, inputs: IdentityInputs): void {
  const wikidata = newest([...inputs.wikidata.values()].map((e) => e.retrieved));
  const wikipedia = newest([...inputs.brandColors.values()].map((e) => e.retrieved));
  meta.sources.wikidata = {
    label: "Wikidata",
    publisher: "Wikimedia Foundation and contributors",
    edition: wikidata ? `Retrieved ${wikidata}` : "Not retrieved yet",
    url: "https://www.wikidata.org/wiki/Property:P1771",
    description:
      "The free, community-edited knowledge base behind Wikipedia, joined to each college by its IPEDS unit ID: the college's social media accounts and the other names it goes by. Released under CC0. Corrections belong on Wikidata itself, which helps everyone who uses it.",
  };
  meta.sources.wikipedia = {
    label: "Wikipedia college color data",
    publisher: "Wikipedia contributors",
    edition: wikipedia ? `Retrieved ${wikipedia}` : "Not retrieved yet",
    url: "https://en.wikipedia.org/wiki/Module:College_color/data",
    description:
      "English Wikipedia's table of college athletic programs' colors (Module:College color/data), each cited to the college's own brand or athletics guide, joined to a college through its Wikipedia article; for a college the table doesn't list, the hex colors in its article's infobox. Used only to give each profile the college's own colors, never as data. CC BY-SA.",
  };
}
