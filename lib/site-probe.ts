/**
 * What the site probe found (specs/school-identity/links.md, "As built: the probe"; data/site-probe.json,
 * data/link-issues.json): the visit and virtual tour pages, and the liveness rule for every stored link. Pure; applied
 * by lib/identity.ts after the HD links (lib/links.ts). The probe itself is scripts/lib/site-probe.mts.
 *
 * Redirects: a stored link keeps the URL its source published (IPEDS HD, College Scorecard), even when it redirects.
 * The probe follows redirects only to judge liveness (`LinkCheck.final_url`), so a link that redirects to a 404 still
 * counts as broken, and a stored value is never something its cited source didn't publish.
 */
import type { LineageRecord, School, SchoolLinks } from "./types";
import type { FoundLink, LinkCheck, LinkIssue, SiteProbeEntry } from "./identity-files";

/** Every links.* field the liveness check covers, in the order the probe checks them. */
export const PROBE_LINK_FIELDS = [
  "website",
  "admissions",
  "apply",
  "financial_aid",
  "price_calculator",
  "veterans",
  "disability_services",
  "visit",
  "virtual_tour",
] as const satisfies readonly (keyof SchoolLinks)[];
export type ProbeLinkField = (typeof PROBE_LINK_FIELDS)[number];

/** Failed runs in a row (404, 410, or no such host) after which a link becomes null. */
export const FAILURES_TO_NULL = 2;

/**
 * What one liveness result says about a link:
 * - "ok": it answered (2xx, after following redirects); resets the failure count
 * - "failed": 404, 410, or a host that doesn't exist (DNS); adds one failure
 * - "unknown": everything else, which never counts and leaves the count as it was: 401, 403, 429 and other refusals
 *   (many college sites block bots but work in browsers), 405, other 4xx, 5xx, a bot-protection page, timeouts, TLS
 *   and connection errors, and robots.txt refusals
 */
export function liveness(check: Pick<LinkCheck, "status" | "error">): "ok" | "failed" | "unknown" {
  if (check.error === "challenge") return "unknown";
  if (check.status !== null) {
    if (check.status === 404 || check.status === 410) return "failed";
    return check.status >= 200 && check.status < 300 ? "ok" : "unknown";
  }
  return check.error === "dns" ? "failed" : "unknown";
}

/**
 * data/link-issues.json after a probe run. For each college probed (an entry with `checked`), its issues are rebuilt
 * from this run's results: an answer removes the field's issue; a failure adds one to it (or starts at 1 when the field
 * now holds a different URL); a result that never counts keeps the issue as it was; a field no longer checked (no link)
 * drops its issue. At most one failure a day counts, so running the probe twice in a day can't null a link. Colleges
 * not in `entries` keep theirs. Sorted by unit id, then field.
 */
export function nextLinkIssues(previous: readonly LinkIssue[], entries: readonly SiteProbeEntry[], today: string): LinkIssue[] {
  const probed = new Map(entries.filter((e) => e.checked).map((e) => [e.unit_id, e.checked!]));
  const out = previous.filter((i) => !probed.has(i.unit_id)).map((i) => ({ ...i }));
  const before = new Map(previous.map((i) => [`${i.unit_id} ${i.field}`, i]));
  for (const [unit_id, checked] of probed) {
    for (const [field, check] of Object.entries(checked)) {
      const old = before.get(`${unit_id} ${field}`);
      const same = old && old.url === check.url ? old : undefined;
      const state = liveness(check);
      if (state === "ok") continue;
      if (state === "unknown" || same?.last_failed === today) {
        if (same) out.push({ ...same });
        continue;
      }
      out.push({
        unit_id,
        field,
        url: check.url,
        failures: (same?.failures ?? 0) + 1,
        last_status: check.status,
        ...(check.error ? { last_error: check.error } : {}),
        first_failed: same?.first_failed ?? today,
        last_failed: today,
      });
    }
  }
  return out.sort((a, b) => (a.unit_id === b.unit_id ? fieldOrder(a.field) - fieldOrder(b.field) : a.unit_id < b.unit_id ? -1 : 1));
}

const fieldOrder = (f: string) => {
  const i = (PROBE_LINK_FIELDS as readonly string[]).indexOf(f);
  return i < 0 ? PROBE_LINK_FIELDS.length : i;
};

/** Whether an issue makes its link null: it failed FAILURES_TO_NULL runs in a row. */
export const isDeadLink = (issue: Pick<LinkIssue, "failures">) => issue.failures >= FAILURES_TO_NULL;

/** The lineage record of a link found on the college's site: the page it was on, the retrieval date, the link text. */
export function foundLinkLineage(found: FoundLink, retrieved: string): LineageRecord {
  return {
    source: "college-site",
    method: "extracted",
    url: found.found_on,
    retrieved,
    year: retrieved.slice(0, 4),
    quote: (found.text.replace(/\s+/g, " ").trim() || found.url).slice(0, 200),
  };
}

/**
 * Sets links.visit and links.virtual_tour from the probe entry (lineage source college-site: the page each was found
 * on, the retrieval date and year, the link text as the quote), then nulls any links.* value whose issue has failed
 * FAILURES_TO_NULL runs in a row for that same URL (the old value stays in data/link-issues.json). Idempotent: the
 * visit pages and their lineage are replaced, never added to, so `npm run merge-identity` over a dataset that already
 * holds the previous run's values gives the same school. Without an entry the visit pages are removed.
 */
export function applyProbeLinks(school: School, entry: SiteProbeEntry | undefined, issues: readonly LinkIssue[]): void {
  const links = school.links;
  const lineage = school.lineage;
  if (lineage) {
    delete lineage["links.visit"];
    delete lineage["links.virtual_tour"];
  }
  if (links) {
    if (entry) {
      // Assigned in place, so a key the links step already placed keeps its position (stable bytes on every run).
      links.visit = entry.visit?.url ?? null;
      links.virtual_tour = entry.virtual_tour?.url ?? null;
      if (entry.visit) (school.lineage ??= {})["links.visit"] = foundLinkLineage(entry.visit, entry.retrieved);
      if (entry.virtual_tour) (school.lineage ??= {})["links.virtual_tour"] = foundLinkLineage(entry.virtual_tour, entry.retrieved);
    } else {
      delete links.visit;
      delete links.virtual_tour;
    }
    for (const issue of issues) {
      const field = issue.field as ProbeLinkField;
      if (!(PROBE_LINK_FIELDS as readonly string[]).includes(field) || !isDeadLink(issue)) continue;
      if (links[field] !== issue.url) continue;
      links[field] = null;
      if (school.lineage) delete school.lineage[`links.${field}`];
    }
  }
  if (school.lineage && !Object.keys(school.lineage).length) delete school.lineage;
}
