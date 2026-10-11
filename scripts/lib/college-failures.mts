/**
 * The research list of colleges where the college-reported pipeline failed, one row per college and reason
 * (specs/college-data-failures.md). Pure: everything is derived from the pipeline's committed state, passed in, so
 * the tests build that state by hand. `scripts/college-failures.mts` reads the files and writes
 * data/college-failures.json; `scripts/publish-college-failures.mts` loads it into Supabase.
 *
 * The rule. A college is listed when its recipe shows the pipeline tried it (discovery attempts or a source) and:
 * - it has no `reported` block in data/schools.json: every reason found at every stage is listed (discovery, fetch,
 *   read, checks); or
 * - it has a `reported` block but values for its newest edition are held in the review queue, or a source failed to
 *   fetch: the review queue's reasons only.
 * Review-queue items from an edition older than the college's newest archived CDS are ignored (superseded).
 */
import type { CheckId, DiscoveryAttempt, Recipe, ReviewItem } from "../../lib/reported.ts";

/** The fixed set of reason codes (specs/college-data-failures.md#reason-codes). */
export const REASON_CODES = [
  "no_document_found",
  "class_profile_only",
  "class_profile_no_figures",
  "robots_disallowed",
  "host_blocked",
  "unreachable",
  "edition_too_old",
  "not_newer",
  "edition_unknown",
  "never_read",
  "failed_checks",
  "read_no_values",
  "malformed_url",
  "discovery_error",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type Stage = "discovery" | "fetch" | "read" | "checks";

export const STAGE_OF: Record<ReasonCode, Stage> = {
  no_document_found: "discovery",
  class_profile_only: "discovery",
  class_profile_no_figures: "read",
  robots_disallowed: "fetch",
  host_blocked: "fetch",
  unreachable: "fetch",
  edition_too_old: "checks",
  not_newer: "checks",
  edition_unknown: "read",
  never_read: "read",
  failed_checks: "checks",
  read_no_values: "read",
  malformed_url: "discovery",
  discovery_error: "discovery",
};

export interface FailureRow {
  unit_id: string;
  name: string;
  reason_code: ReasonCode;
  stage: Stage;
  /** Short text: what failed, in the pipeline's own words where it has them. */
  detail: string;
  url: string | null;
  /** CDS edition ("2025-26") or the term a class profile describes ("Fall 2025"), when known. */
  edition: string | null;
  /** failed_checks only: the check ids that held values, most frequent first. Empty otherwise. */
  checks: string[];
  /** ISO date of the newest pipeline evidence for this row (attempt, fetch, archive, or queue date). */
  last_run: string;
  /** The pipeline run id, when the evidence names one (review-queue rows). */
  run: string | null;
  /** ISO dates: the first and the newest generation of the file that listed this row. */
  first_seen: string;
  last_seen: string;
}

export interface FailuresFile {
  /** ISO date this file describes: the newest `updated` of the state files it was built from. */
  generated: string;
  counts: Partial<Record<ReasonCode, number>>;
  rows: FailureRow[];
}

/** The parts of the manifest (data/college-docs.json) used here. */
export interface ManifestDoc {
  sha256: string;
  unit_id: string;
  url: string;
  kind: "cds" | "class-profile";
  type: string;
  edition: string | null;
  retrieved: string;
  pages?: number;
}

export interface BlockedHost {
  host: string;
  status: number | string;
  last_seen: string;
  unit_ids?: string[];
}

export interface CollegeInfo {
  name: string;
  /** Has a `reported` block in data/schools.json. */
  published: boolean;
  /** The federal admissions year college-reported figures must be newer than (null when there is none). */
  federal_year: number | null;
}

export interface FailureState {
  recipes: readonly Recipe[];
  queue: readonly ReviewItem[];
  docs: readonly ManifestDoc[];
  /** sha256 of every CDS-record document with at least one read (data/cds-records/). */
  readShas: ReadonlySet<string>;
  blockedHosts: readonly BlockedHost[];
  colleges: ReadonlyMap<string, CollegeInfo>;
}

type Draft = Omit<FailureRow, "first_seen" | "last_seen" | "name" | "stage"> & { stage?: Stage };

const DETAIL_MAX = 300;
const short = (s: string) => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s);
const maxDate = (a: string, b: string) => (a > b ? a : b);
const URL_RE = /https?:\/\/[^\s;,|"]+[^\s;,|":.]/;
const ROBOTS_RE = /(https?:\/\/[^\s;]+?):? robots\.txt disallows it/g;

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The fall year an edition or term starts in: "2025-26" → 2025, "Fall 2025" → 2025. */
export function editionYear(edition: string | null | undefined): number | null {
  const m = edition?.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

function discoveryDrafts(recipe: Recipe, opts: { sources: boolean }): Draft[] {
  const tried = recipe.discovery?.tried ?? [];
  const out: Draft[] = [];
  const add = (reason_code: ReasonCode, a: DiscoveryAttempt, detail: string, url: string | null = null) =>
    out.push({ unit_id: recipe.unit_id, reason_code, detail, url, edition: null, checks: [], last_run: a.at, run: null });

  for (const a of tried) {
    const detail = a.detail ?? "";
    for (const m of detail.matchAll(ROBOTS_RE)) add("robots_disallowed", a, `discovery found a link that robots.txt disallows`, m[1]);
    if (a.result === "blocked" || a.via === "blocked") add("host_blocked", a, detail || "every candidate host refuses us");
    if (opts.sources) continue;
    if (a.result === "failed") {
      if (/URI malformed|Invalid URL/i.test(detail)) add("malformed_url", a, `discovery: ${detail}`);
      else if (/fetch failed|HTTP \d{3}/.test(detail)) add("unreachable", a, `discovery: ${detail}`, detail.match(URL_RE)?.[0] ?? null);
      else add("discovery_error", a, `discovery: ${detail || "failed"}`);
    }
    for (const m of detail.matchAll(/share link (https?:\/\/\S+?): HTTP (\d{3})/g)) add("unreachable", a, `share link answered HTTP ${m[2]}`, m[1]);
  }

  if (!opts.sources) {
    const blocked = out.some((d) => d.reason_code === "host_blocked" || d.reason_code === "robots_disallowed");
    const searched = tried.filter((a) => a.step >= 1 && a.result === "none");
    if (!blocked && (searched.length || recipe.none_found)) {
      const last = searched.at(-1) ?? tried.at(-1);
      const vias = [...new Set(searched.map((a) => a.via ?? `step ${a.step}`))];
      const said = [...searched].reverse().find((a) => a.detail && !/^\d+ (sitemap|IR host|page|guessed)/.test(a.detail))?.detail;
      const next = recipe.discovery?.next_attempt ? `; next try ${recipe.discovery.next_attempt}` : "";
      out.push({
        unit_id: recipe.unit_id,
        reason_code: "no_document_found",
        detail: `tried ${vias.join(", ") || "discovery"}; nothing found${said ? `: ${said}` : ""}${next}`,
        url: null,
        edition: null,
        checks: [],
        last_run: last?.at ?? recipe.learned,
        run: null,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sources: fetch and read                                             */
/* ------------------------------------------------------------------ */

function sourceDrafts(recipe: Recipe, state: FailureState, docsBySha: Map<string, ManifestDoc>, blocked: Map<string, BlockedHost>, queueUrls: Set<string>): Draft[] {
  const out: Draft[] = [];
  const unit_id = recipe.unit_id;
  const base = { unit_id, checks: [], run: null };
  const cds = recipe.sources.filter((s) => s.kind === "cds");
  const profiles = recipe.sources.filter((s) => s.kind === "class-profile");

  for (const s of cds) {
    const date = s.checked ?? recipe.learned;
    if (!s.sha256) {
      if (queueUrls.has(s.url)) continue; // the review queue says why (unreachable, robots.txt)
      const host = hostOf(s.url);
      const b = host ? blocked.get(host) : undefined;
      if (b) out.push({ ...base, reason_code: "host_blocked", detail: `${host} answers ${b.status === "challenge" ? "with a bot challenge" : `HTTP ${b.status}`}`, url: s.url, edition: null, last_run: maxDate(date, b.last_seen) });
      else if (!host) out.push({ ...base, reason_code: "malformed_url", detail: "the source URL doesn't parse", url: s.url, edition: null, last_run: date });
      else out.push({ ...base, reason_code: "never_read", stage: "fetch", detail: "found by discovery, never fetched", url: s.url, edition: null, last_run: date });
      continue;
    }
    const doc = docsBySha.get(s.sha256);
    if (!doc) {
      out.push({ ...base, reason_code: "never_read", detail: "fetched, not in the archive manifest", url: s.url, edition: null, last_run: date });
      continue;
    }
    if (doc.type === "pdf-scanned") {
      out.push({ ...base, reason_code: "never_read", detail: "scanned PDF (no text layer; nothing reads it yet)", url: s.url, edition: doc.edition, last_run: doc.retrieved });
    } else if (!doc.edition) {
      out.push({ ...base, reason_code: "edition_unknown", detail: `archived as ${doc.type}; no edition year detected`, url: s.url, edition: null, last_run: doc.retrieved });
    } else if (!state.readShas.has(doc.sha256)) {
      out.push({ ...base, reason_code: "never_read", detail: `archived ${doc.type}, never read`, url: s.url, edition: doc.edition, last_run: doc.retrieved });
    }
  }

  // The newest CDS we hold is no newer than the federal figures already shown.
  const college = state.colleges.get(unit_id);
  const editions = state.docs.filter((d) => d.unit_id === unit_id && d.kind === "cds" && editionYear(d.edition) !== null);
  const newest = editions.sort((a, b) => (editionYear(b.edition)! - editionYear(a.edition)!) || (b.retrieved > a.retrieved ? 1 : -1))[0];
  if (newest && college?.federal_year) {
    const y = editionYear(newest.edition)!;
    if (y <= college.federal_year) {
      out.push({
        ...base,
        reason_code: y < college.federal_year ? "edition_too_old" : "not_newer",
        detail: `newest CDS found is ${newest.edition} (fall ${y}); federal figures are fall ${college.federal_year}`,
        url: newest.url,
        edition: newest.edition,
        last_run: newest.retrieved,
      });
    }
  }

  if (!cds.length && profiles.length) {
    const read = profiles.filter((p) => p.extraction !== undefined);
    const figures = read.some((p) => p.extraction && (p.extraction.applicants ?? p.extraction.admitted ?? p.extraction.acceptance_rate) != null);
    const first = profiles[0];
    const last_run = profiles.map((p) => p.checked ?? p.processed ?? recipe.learned).reduce(maxDate);
    if (read.length && !figures) {
      out.push({ ...base, reason_code: "class_profile_no_figures", detail: `only class profile(s) found (${profiles.length}); read, no admissions figures`, url: read[0].url, edition: null, last_run });
    } else {
      out.push({ ...base, reason_code: "class_profile_only", detail: `only class profile(s) found (${profiles.length}), no Common Data Set${read.length ? "" : "; not read yet"}`, url: first.url, edition: read.find((p) => p.extraction?.entering_term)?.extraction?.entering_term ?? null, last_run });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Review queue                                                        */
/* ------------------------------------------------------------------ */

function queueDrafts(unit_id: string, items: readonly ReviewItem[]): Draft[] {
  const out: Draft[] = [];
  const held = new Map<string, number>();
  let heldItems = 0;
  let heldLast: ReviewItem | null = null;
  let heldEdition: string | null = null;
  const from = (i: ReviewItem) => ({ unit_id, checks: [], last_run: i.queued, run: i.run, edition: i.edition ?? i.entering_term ?? null });

  for (const i of items) {
    let counted = false;
    for (const f of i.failures) {
      const check = f.check as CheckId;
      if (check === "unreachable") {
        const robots = f.detail.match(/robots\.txt disallows (\S+)/);
        if (robots) out.push({ ...from(i), reason_code: "robots_disallowed", detail: "robots.txt disallows the document", url: robots[1] });
        else out.push({ ...from(i), reason_code: "unreachable", detail: short(f.detail.replace(URL_RE, "").replace(/\s+at\s*$|:\s*$/, "").trim() || f.detail), url: f.detail.match(URL_RE)?.[0] ?? i.urls[0] ?? null });
      } else if (check === "batch-failed") {
        out.push({ ...from(i), reason_code: "never_read", detail: short(`batch request failed: ${f.detail}`), url: i.urls[0] ?? null });
      } else if (check === "newer-than-federal") {
        const m = f.detail.match(/entering term (\d{4}) isn't newer than the federal admissions year (\d{4})/);
        const code: ReasonCode = !m ? "edition_unknown" : Number(m[1]) < Number(m[2]) ? "edition_too_old" : "not_newer";
        out.push({ ...from(i), reason_code: code, detail: short(f.detail), url: i.urls[0] ?? null });
      } else {
        held.set(check, (held.get(check) ?? 0) + 1);
        if (!counted) {
          counted = true;
          heldItems++;
          if (!heldLast || i.queued > heldLast.queued || (i.queued === heldLast.queued && i.run > heldLast.run)) heldLast = i;
          const e = i.edition ?? i.entering_term ?? null;
          if (e && (!heldEdition || (editionYear(e) ?? 0) > (editionYear(heldEdition) ?? 0))) heldEdition = e;
        }
      }
    }
  }
  if (heldItems && heldLast) {
    const checks = [...held.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    out.push({
      unit_id,
      reason_code: "failed_checks",
      detail: short(`${heldItems} value(s) held; failed checks: ${checks.map(([c, n]) => `${c} ×${n}`).join(", ")}`),
      url: heldLast.urls[0] ?? null,
      edition: heldEdition,
      checks: checks.map(([c]) => c),
      last_run: heldLast.queued,
      run: heldLast.run,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Putting it together                                                 */
/* ------------------------------------------------------------------ */

/** Several drafts with the same reason become one row: the newest evidence, the first URL, details joined. */
function mergeDrafts(drafts: readonly Draft[]): Draft[] {
  const by = new Map<ReasonCode, Draft[]>();
  for (const d of drafts) by.set(d.reason_code, [...(by.get(d.reason_code) ?? []), d]);
  return [...by.values()].map((ds) => {
    if (ds.length === 1) return ds[0];
    const details = [...new Set(ds.map((d) => d.detail))];
    const newest = ds.reduce((a, b) => (b.last_run > a.last_run ? b : a));
    const urls = [...new Set(ds.map((d) => d.url).filter((u): u is string => !!u))];
    return {
      ...newest,
      url: newest.url ?? urls[0] ?? null,
      detail: short(details.join("; ") + (urls.length > 1 ? ` (${urls.length} URLs)` : "")),
      edition: ds.map((d) => d.edition).filter((e): e is string => !!e).sort((a, b) => (editionYear(b) ?? 0) - (editionYear(a) ?? 0))[0] ?? null,
      run: newest.run ?? ds.find((d) => d.run)?.run ?? null,
      checks: [...new Set(ds.flatMap((d) => d.checks))],
    };
  });
}

/** Every failure row (without first_seen/last_seen), sorted by unit id then reason code order. */
export function classifyFailures(state: FailureState): Omit<FailureRow, "first_seen" | "last_seen">[] {
  const docsBySha = new Map(state.docs.map((d) => [d.sha256, d]));
  const blocked = new Map(state.blockedHosts.map((h) => [h.host.toLowerCase(), h]));
  const blockedByCollege = new Map<string, BlockedHost[]>();
  for (const h of state.blockedHosts) for (const id of h.unit_ids ?? []) blockedByCollege.set(id, [...(blockedByCollege.get(id) ?? []), h]);
  const queueBy = new Map<string, ReviewItem[]>();
  for (const i of state.queue) queueBy.set(i.unit_id, [...(queueBy.get(i.unit_id) ?? []), i]);

  const rows: Omit<FailureRow, "first_seen" | "last_seen">[] = [];
  for (const recipe of state.recipes) {
    const college = state.colleges.get(recipe.unit_id);
    if (!college) continue;
    const attempted = recipe.sources.length > 0 || (recipe.discovery?.tried.length ?? 0) > 0;
    if (!attempted) continue;

    // Queue items for an edition older than the newest CDS we archived are superseded.
    const newestYear = Math.max(0, ...state.docs.filter((d) => d.unit_id === recipe.unit_id && d.kind === "cds").map((d) => editionYear(d.edition) ?? 0));
    const items = (queueBy.get(recipe.unit_id) ?? []).filter((i) => !i.edition || (editionYear(i.edition) ?? 0) >= newestYear);
    const queueUrls = new Set(items.filter((i) => i.failures.some((f) => f.check === "unreachable")).flatMap((i) => i.urls));

    let drafts: Draft[] = queueDrafts(recipe.unit_id, items);
    if (!college.published) {
      drafts.push(...discoveryDrafts(recipe, { sources: recipe.sources.length > 0 }));
      drafts.push(...sourceDrafts(recipe, state, docsBySha, blocked, queueUrls));
      const readCds = recipe.sources.some((s) => s.kind === "cds" && s.sha256 && state.readShas.has(s.sha256));
      const hosts = blockedByCollege.get(recipe.unit_id) ?? [];
      if (hosts.length && !readCds && !drafts.some((d) => d.reason_code === "host_blocked")) {
        const last = hosts.map((h) => h.last_seen).reduce(maxDate);
        drafts.push({
          unit_id: recipe.unit_id,
          reason_code: "host_blocked",
          detail: short(`refused by ${hosts.map((h) => `${h.host} (${h.status === "challenge" ? "bot challenge" : `HTTP ${h.status}`})`).join(", ")}`),
          url: null,
          edition: null,
          checks: [],
          last_run: last,
          run: null,
        });
      }
      if (readCds && !drafts.length) {
        const read = recipe.sources.filter((s) => s.kind === "cds" && s.sha256 && state.readShas.has(s.sha256));
        const doc = docsBySha.get(read[0].sha256!);
        drafts.push({
          unit_id: recipe.unit_id,
          reason_code: "read_no_values",
          detail: `read ${read.length} CDS document(s); no value in it could be published${doc?.pages ? ` (${doc.pages} page(s))` : ""}`,
          url: read[0].url,
          edition: doc?.edition ?? null,
          checks: [],
          last_run: doc?.retrieved ?? read[0].checked ?? recipe.learned,
          run: null,
        });
      }
    } else {
      drafts = drafts.filter((d) => d.reason_code === "failed_checks" || d.reason_code === "unreachable" || d.reason_code === "robots_disallowed" || d.reason_code === "never_read");
    }
    for (const d of mergeDrafts(drafts)) {
      rows.push({
        unit_id: d.unit_id,
        name: college.name,
        reason_code: d.reason_code,
        stage: d.stage ?? STAGE_OF[d.reason_code],
        detail: short(d.detail),
        url: d.url,
        edition: d.edition,
        checks: d.checks,
        last_run: d.last_run,
        run: d.run,
      });
    }
  }
  const order = new Map(REASON_CODES.map((c, i) => [c, i]));
  return rows.sort((a, b) => (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : order.get(a.reason_code)! - order.get(b.reason_code)!));
}

export const rowKey = (r: Pick<FailureRow, "unit_id" | "reason_code">) => `${r.unit_id}|${r.reason_code}`;

/** Adds first_seen (kept from the previous file when the same college and reason was listed) and last_seen. */
export function withSeen(rows: readonly Omit<FailureRow, "first_seen" | "last_seen">[], previous: readonly Pick<FailureRow, "unit_id" | "reason_code" | "first_seen">[], date: string): FailureRow[] {
  const before = new Map(previous.map((r) => [rowKey(r), r.first_seen]));
  return rows.map((r) => ({ ...r, first_seen: before.get(rowKey(r)) ?? date, last_seen: date }));
}

export function buildFailuresFile(state: FailureState, previous: FailuresFile | null, date: string): FailuresFile {
  const rows = withSeen(classifyFailures(state), previous?.rows ?? [], date);
  const counts: Partial<Record<ReasonCode, number>> = {};
  for (const c of REASON_CODES) {
    const n = rows.filter((r) => r.reason_code === c).length;
    if (n) counts[c] = n;
  }
  return { generated: date, counts, rows };
}

/** One row per line, so a data PR's diff shows exactly which colleges and reasons changed. */
export function formatFailuresFile(file: FailuresFile): string {
  return `{\n  "generated": ${JSON.stringify(file.generated)},\n  "counts": ${JSON.stringify(file.counts)},\n  "rows": [\n${file.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]\n}\n`;
}
