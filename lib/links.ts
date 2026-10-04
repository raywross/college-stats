/**
 * Official links (specs/school-identity/links.md): the website, admissions, application, financial aid, net price,
 * veterans', and disability-services pages each college reports in the IPEDS directory (HD{Y}), with Scorecard's
 * homepage and net price calculator as the fallback. Pure; applied by lib/identity.ts.
 */
import type { LineageRecord, School, SchoolLinks } from "./types";

const emptyLinks = (): SchoolLinks => ({ website: null, price_calculator: null });

/**
 * A URL with a scheme, or null for an empty value. Handles the messy ways colleges report these to NCES: no scheme
 * ("www.uah.edu/admissions"), a bare domain ("uah.edu"), spaces in the path ("tcc.ruffalonl.com/Alabama State
 * University/Freshman-Students"), and trailing punctuation left over from pasting a sentence ("…/admissions."). Pure:
 * never reformats an already-usable URL (no added trailing slash, no case changes), just makes a messy one usable.
 */
export function normalizeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let url = v.trim();
  // IPEDS codes a missing value as -1, -2, or -3 even in a column that's otherwise free text.
  if (!url || url === "-1" || url === "-2" || url === "-3") return null;
  // A sentence's trailing punctuation, pasted in along with the link.
  url = url.replace(/[.,;]+$/, "");
  if (!url) return null;
  // A literal space in the path (seen in a vendor's admissions-portal URLs), not a separate field.
  url = url.replace(/ /g, "%20");
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    // Validates without reformatting: a stray non-URL value ("N/A") still throws and becomes null.
    new URL(withScheme);
    return withScheme;
  } catch {
    return null;
  }
}

/** The link's host for display ("uga.edu" from "https://www.uga.edu/apply"), without a leading "www.". */
export function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** True when two URLs point to different places once scheme, a leading "www.", and a trailing slash are ignored. */
export function urlsDiffer(a: string | null, b: string | null): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  const strip = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  return strip(a) !== strip(b);
}

/**
 * A readable warning line when the IPEDS directory's homepage disagrees with Scorecard's by more than scheme,
 * "www.", or a trailing slash (links.md, Ingest). Null when there's nothing to warn about, including when HD has no
 * homepage at all (then Scorecard's value is kept outright, not "disagreed with"). Pure, so sync-data can collect
 * these the same way it collects `directoryIssues`' warnings and print the count and the first 20.
 */
export function websiteMismatch(school: Pick<School, "unit_id" | "name">, hdUrl: string | null, scorecardUrl: string | null): string | null {
  if (!hdUrl || !urlsDiffer(hdUrl, scorecardUrl)) return null;
  return `${school.name} (${school.unit_id}): HD ${hdUrl}, Scorecard ${scorecardUrl ?? "(none)"}`;
}

function setOwnLineage(school: School, path: "links.website" | "links.price_calculator", record: LineageRecord): void {
  school.lineage = { ...(school.lineage ?? {}), [path]: record };
}

/**
 * Sets the HD links from a fresh IPEDS HD row (WEBADDR, ADMINURL, APPLURL, FAIDURL, NPRICURL, VETURL, DISAURL).
 * Without a row (`npm run merge-identity` on the committed data), the links already on the school stay untouched.
 *
 *   - website: HD's WEBADDR when present (now the field's default source, lib/fields.ts), else whatever Scorecard
 *     already set on `school.links.website`, with a `{ source: "scorecard" }` lineage record noting the fallback.
 *   - price_calculator: Scorecard stays the default; HD's NPRICURL only fills a gap Scorecard left, with a
 *     `{ source: "ipeds-hd" }` record.
 *   - admissions, apply, financial_aid, veterans, disability_services: HD only, null when the college left the
 *     column blank. No lineage record: HD is their registered default source.
 *
 * Idempotent: re-applying with the same row reproduces the same links and lineage, even though by then
 * `school.links.price_calculator` may already be the HD-filled value rather than Scorecard's original one — the
 * lineage this applier set on an earlier pass is read before it's cleared, so a re-apply can still tell "Scorecard
 * truly has none" from "I filled this in last time."
 */
export function applyLinks(school: School, hdRow?: Record<string, string>): void {
  if (!hdRow) return;

  const priceAlreadyFromHd = school.lineage?.["links.price_calculator"]?.source === "ipeds-hd";
  if (school.lineage) {
    delete school.lineage["links.website"];
    delete school.lineage["links.price_calculator"];
  }

  const links: SchoolLinks = school.links ?? emptyLinks();

  const hdWebsite = normalizeUrl(hdRow.WEBADDR);
  if (hdWebsite) {
    links.website = hdWebsite;
  } else if (links.website) {
    setOwnLineage(school, "links.website", { source: "scorecard" });
  }

  const npric = normalizeUrl(hdRow.NPRICURL);
  const scorecardHasPrice = links.price_calculator !== null && !priceAlreadyFromHd;
  if (npric && !scorecardHasPrice) {
    links.price_calculator = npric;
    setOwnLineage(school, "links.price_calculator", { source: "ipeds-hd" });
  }

  links.admissions = normalizeUrl(hdRow.ADMINURL);
  links.apply = normalizeUrl(hdRow.APPLURL);
  links.financial_aid = normalizeUrl(hdRow.FAIDURL);
  links.veterans = normalizeUrl(hdRow.VETURL);
  links.disability_services = normalizeUrl(hdRow.DISAURL);

  school.links = links;
}
