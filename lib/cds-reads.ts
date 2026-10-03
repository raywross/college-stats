/**
 * Round 3's "read once" rules as pure functions (specs/college-reported-round-3.md Decisions 1 and 10): which reads a
 * document is due for after a schema or reader bump, whether a known document needs a fetch at all, what a fetch's
 * answer means, and the manifest (data/college-docs.json) lookups the pipeline and `npm run archive-doc` share.
 *
 * Type-only imports, so Node tests load it directly. The archive itself (bytes by sha256) is
 * scripts/lib/college-reported/archive.mts.
 */
import {
  CALL_KEYS,
  READER_VERSIONS,
  SCHEMA_VERSIONS,
  type CallKey,
  type CdsSection,
  type CollegeDocsFile,
  type DocumentRecord,
  type DocumentType,
  type ManifestEntry,
} from "./cds-sections.ts";

/* ------------------------------------------------------------------ */
/* Schema-version gating                                               */
/* ------------------------------------------------------------------ */

/** A read a document can be due for: one of the two model calls, or the deterministic reader for its type. */
export type ReadKey = CallKey | "deterministic";

/** Types a model reads with the two calls (Decision 3). Class-profile pages stay on round 2's profile extractor. */
const MODEL_TYPES: ReadonlySet<DocumentType> = new Set(["xlsx-classic", "pdf-flat", "pdf-scanned", "html"]);

/**
 * The reads due for an archived document, given the versions stored in `doc.reads` (Decision 1 "Schema versions",
 * Decision 10):
 * - a type with a deterministic reader (`readerVersions` has it: template workbook, form PDF) is never sent to a model;
 *   it is due `deterministic` when it has no deterministic read or one older than the reader;
 * - a model-read type is due each call (`C`, `rest`) it has no read for, or read at an older schema version;
 * - a class-profile page is due nothing here.
 * Nothing is due at the same versions: that is what makes "never redo a model read at the same schema version" and "a
 * schema bump reads only the archive" true. A stored version newer than the current one is the validator's error
 * (validateCdsRecords), not a re-read.
 */
export function callsNeedingRead(
  doc: Pick<DocumentRecord, "type" | "reads">,
  versions: Readonly<Record<CallKey, number>> = SCHEMA_VERSIONS,
  readerVersions: Readonly<Record<string, number>> = READER_VERSIONS
): ReadKey[] {
  const reader = readerVersions[doc.type];
  if (reader !== undefined) {
    const read = doc.reads.deterministic;
    return !read || read.mode !== "deterministic" || read.schema_version < reader ? ["deterministic"] : [];
  }
  if (!MODEL_TYPES.has(doc.type)) return [];
  return CALL_KEYS.filter((call) => {
    const read = doc.reads[call];
    return !read || read.mode === "deterministic" || read.schema_version < versions[call];
  });
}

/* ------------------------------------------------------------------ */
/* Fetch only when new or the server says it changed (Decision 10)     */
/* ------------------------------------------------------------------ */

export interface FetchContext {
  /** Validators from the last fetch of this URL (the recipe keeps them), sent on a conditional GET. */
  etag?: string;
  last_modified?: string;
  /** ISO date this URL was last checked (fetched or answered 304); the manifest's `retrieved` when unknown. */
  lastChecked?: string | null;
  /** ISO date of this run. */
  today: string;
  /** Whether the document's index page changed: its set of document links, not its HTML. */
  indexChanged: boolean;
}

export type FetchDecision =
  | { fetch: false; reason: "checked-this-month" }
  | { fetch: true; reason: "new" | "index-changed" | "monthly"; conditional: { etag?: string; last_modified?: string } };

/** "2026-01-31" + 1 month = "2026-02-28" (the day clamped to the month's length). */
export function addMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Whether to request a document's URL this run. A URL with no manifest entry is new: fetch it. A known document gets a
 * conditional GET only when its index page's links changed or a calendar month has passed since it was last checked;
 * otherwise nothing is requested. The answer is ended by `fetchOutcome`: a 304 or the same sha256 means nothing new.
 */
export function needsFetch(entry: ManifestEntry | undefined, ctx: FetchContext): FetchDecision {
  if (!entry) return { fetch: true, reason: "new", conditional: {} };
  const conditional = {
    ...(ctx.etag ? { etag: ctx.etag } : {}),
    ...(ctx.last_modified ? { last_modified: ctx.last_modified } : {}),
  };
  if (ctx.indexChanged) return { fetch: true, reason: "index-changed", conditional };
  const since = ctx.lastChecked ?? entry.retrieved;
  if (addMonth(since) <= ctx.today) return { fetch: true, reason: "monthly", conditional };
  return { fetch: false, reason: "checked-this-month" };
}

export type FetchOutcome = "unchanged" | "new-document" | "failed";

/**
 * What a fetch's answer means for the archive: a 304, or 200 bytes whose sha256 is already archived (for this URL or
 * any other), is `unchanged` and ends it: no archive write, no read. New bytes are a `new-document` (a new manifest
 * entry; the old one stays, documents are never deleted). Anything else is `failed`.
 */
export function fetchOutcome(manifest: CollegeDocsFile, res: { status: number; sha256?: string }): FetchOutcome {
  if (res.status === 304) return "unchanged";
  if (res.status < 200 || res.status >= 300 || !res.sha256) return "failed";
  return findBySha(manifest, res.sha256) ? "unchanged" : "new-document";
}

/* ------------------------------------------------------------------ */
/* Manifest lookups                                                    */
/* ------------------------------------------------------------------ */

export const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function findBySha(manifest: CollegeDocsFile, sha256: string): ManifestEntry | undefined {
  return manifest.documents.find((d) => d.sha256 === sha256);
}

/** A college's documents, newest edition first (unknown editions last), then newest retrieved. */
export function documentsOf(manifest: CollegeDocsFile, unitId: string): ManifestEntry[] {
  return manifest.documents
    .filter((d) => d.unit_id === unitId)
    .sort((a, b) => (b.edition ?? "").localeCompare(a.edition ?? "") || b.retrieved.localeCompare(a.retrieved));
}

export interface ManifestEntryInput {
  sha256: string;
  unit_id: string;
  url: string;
  final_url?: string | null;
  kind: ManifestEntry["kind"];
  type: DocumentType;
  edition: string | null;
  edition_from?: ManifestEntry["edition_from"];
  retrieved: string;
  bytes: number;
  pages?: number | null;
  body_chars?: number | null;
  definitions_from_page?: number | null;
  sections?: Partial<Record<CdsSection, [number, number]>> | null;
  archive: string | null;
}

/**
 * One manifest entry, built the same way by a fetch and by `npm run archive-doc`: optional fields that are null or
 * absent are left out, `final_url` only when it differs from `url`. Throws on a malformed sha256, unit id, or date.
 */
export function manifestEntryFor(e: ManifestEntryInput): ManifestEntry {
  if (!SHA256.test(e.sha256)) throw new Error(`manifest: "${e.sha256}" isn't a sha256`);
  if (!/^\d+$/.test(e.unit_id)) throw new Error(`manifest: "${e.unit_id}" isn't an IPEDS id`);
  if (!ISO_DATE.test(e.retrieved)) throw new Error(`manifest: retrieved "${e.retrieved}" isn't an ISO date`);
  if (!Number.isInteger(e.bytes) || e.bytes <= 0) throw new Error(`manifest: bytes ${e.bytes} isn't a size`);
  const entry: ManifestEntry = {
    sha256: e.sha256,
    unit_id: e.unit_id,
    url: e.url,
    kind: e.kind,
    type: e.type,
    edition: e.edition,
    retrieved: e.retrieved,
    bytes: e.bytes,
    archive: e.archive,
  };
  if (e.final_url && e.final_url !== e.url) entry.final_url = e.final_url;
  if (e.edition_from) entry.edition_from = e.edition_from;
  if (e.pages != null) entry.pages = e.pages;
  if (e.body_chars != null) entry.body_chars = e.body_chars;
  if (e.definitions_from_page != null) entry.definitions_from_page = e.definitions_from_page;
  if (e.sections && Object.keys(e.sections).length) entry.sections = e.sections;
  return entry;
}
