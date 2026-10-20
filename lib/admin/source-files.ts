/**
 * The Health page's Files view (specs/product/admin-health-views.md "View 2: Files"): every published file the dataset
 * is built from, the year it describes, when its publisher released it, and its health.
 *
 * - Which files: the file names in each `data/meta.json` source's edition ("2023–24 (SFA2324 + COST2_2024)"), and for
 *   College Scorecard, which the sync reads through its API, the Field of Study file from the same release.
 * - When published: `data/source-files.json`, written by `npm run source-files` from each file's `Last-Modified`
 *   date on the publisher's server (the date of its newest revision); `npm run check:source-files` fails when a file
 *   has no entry.
 * - Health: from `data/release-calendar.json`, whether a newer release that replaces the source is out.
 *
 * Pure (type-only imports), so the script, its check, the page, and the tests share one definition.
 */
import type { Release, ReleaseCalendar } from "../releases.ts";
import type { DatasetMeta, SourceKey } from "../types.ts";

/** The NCES bulk-file URL for an IPEDS file name. */
export const ipedsFileUrl = (file: string) => `https://nces.ed.gov/ipeds/complete-data-files/${file}.zip`;

/** One file a source is built from, and where its publisher serves it. */
export interface SourceFileRef {
  source: SourceKey;
  file: string;
  url: string;
}

/** data/source-files.json */
export interface SourceFilesRecord {
  /** ISO date of the last dating run. */
  checked: string;
  files: Record<string, { source: SourceKey; url: string; published: string | null; status: number }>;
}

const FILE_NAME = /^[A-Z][A-Z0-9_]+$/;

/** The file names in an edition's parentheses: "2023–24 (SFA2324 + COST2_2024)" → ["SFA2324", "COST2_2024"]. */
export function filesInEdition(edition: string | undefined): string[] {
  const inner = edition?.match(/\(([^)]*)\)\s*$/)?.[1];
  if (!inner) return [];
  return inner
    .split("+")
    .map((s) => s.trim())
    .filter((s) => FILE_NAME.test(s));
}

/** The Scorecard download's file name from its URL ("…/Most-Recent-Cohorts-Field-of-Study_06102026.zip"). */
function scorecardFile(url: string | undefined): string | null {
  const base = url?.split("/").pop()?.replace(/\.zip$/i, "");
  return base && /^Most-Recent-Cohorts/.test(base) ? base : null;
}

/** Every file the dataset's sources name, each once, in meta.json's order. */
export function sourceFileRefs(meta: Pick<DatasetMeta, "sources">): SourceFileRef[] {
  const out: SourceFileRef[] = [];
  const seen = new Set<string>();
  const fos = meta.sources["scorecard-fos"]?.url;
  for (const [key, info] of Object.entries(meta.sources) as [SourceKey, NonNullable<DatasetMeta["sources"][SourceKey]>][]) {
    if (key === "scorecard" || key === "scorecard-fos") {
      // The API has no file; the Field of Study download is from the same release.
      const file = scorecardFile(fos);
      if (file && fos && !seen.has(`${key}|${file}`)) {
        seen.add(`${key}|${file}`);
        out.push({ source: key, file, url: fos });
      }
      continue;
    }
    for (const file of filesInEdition(info.edition)) {
      if (seen.has(`${key}|${file}`)) continue;
      seen.add(`${key}|${file}`);
      out.push({ source: key, file, url: ipedsFileUrl(file) });
    }
  }
  return out;
}

/** "Thu, 11 Dec 2025 16:17:12 GMT" → "2025-12-11"; null when it isn't a date. */
export function lastModifiedDate(header: string | null | undefined): string | null {
  if (!header) return null;
  const t = Date.parse(header);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Files the record has no entry for (the check's failure list). */
export function undatedFiles(refs: readonly SourceFileRef[], record: Pick<SourceFilesRecord, "files">): SourceFileRef[] {
  return refs.filter((r) => !record.files[r.file]);
}

/* ------------------------------------------------------------------ */
/* Health of a file                                                    */
/* ------------------------------------------------------------------ */

export type FileHealthStatus = "fresh" | "watch" | "stale" | "failing";

/** Whether a calendar release replaces this source with a newer year. Scorecard's vintages are `scorecard-*`. */
export function releaseUpdates(release: Pick<Release, "updates">, source: SourceKey): boolean {
  const keys = release.updates as readonly string[];
  return keys.includes(source) || (source.startsWith("scorecard") && keys.some((k) => k.startsWith("scorecard")));
}

export interface SourceFileRow {
  source: SourceKey;
  /** "IPEDS Admissions survey" */
  label: string;
  files: { file: string; url: string; published: string | null; status: number | null }[];
  /** The year the data describes: the vintage, else the edition's words before its file list. */
  describes: string | null;
  /** The newest published date among its files. */
  published: string | null;
  /** When the sync last read it (meta.json `retrieved`). */
  collected: string;
  /** The next release that replaces this source, if the calendar lists one. */
  next: { label: string; expected: string | null; status: Release["status"]; published?: string } | null;
  status: FileHealthStatus;
  reason: string;
}

/** The year words of an edition: "Fall 2024 (ADM2024)" → "Fall 2024". */
function editionYear(edition: string | undefined): string | null {
  const s = edition?.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return s ? s : null;
}

/** "YYYY-MM" of a date or month. */
const monthOf = (iso: string) => iso.slice(0, 7);

/**
 * One row per source that names a file, with its health:
 * - Failing: the publisher no longer serves a file (the last dating run got a 4xx).
 * - Stale: a calendar release that replaces the source is published, so a newer file is out and the site doesn't use it.
 * - Watch: the next release's expected month has passed and it isn't out yet, or a file has no published date.
 * - Fresh: otherwise.
 */
export function sourceFileRows(
  meta: Pick<DatasetMeta, "sources" | "vintages" | "retrieved">,
  record: Pick<SourceFilesRecord, "files"> | null,
  calendar: Pick<ReleaseCalendar, "releases"> | null,
  today: string,
): SourceFileRow[] {
  const bySource = new Map<SourceKey, SourceFileRef[]>();
  for (const ref of sourceFileRefs(meta)) bySource.set(ref.source, [...(bySource.get(ref.source) ?? []), ref]);
  const rows: SourceFileRow[] = [];
  for (const [source, refs] of bySource) {
    const info = meta.sources[source]!;
    const files = refs.map((r) => {
      const rec = record?.files[r.file];
      return { file: r.file, url: rec?.url ?? r.url, published: rec?.published ?? null, status: rec?.status ?? null };
    });
    const published = files.reduce<string | null>((acc, f) => (f.published && (!acc || f.published > acc) ? f.published : acc), null);
    const vintage = (meta.vintages as Record<string, string | null | undefined>)[source];
    const describes = vintage ?? editionYear(info.edition);
    const upcoming = (calendar?.releases ?? []).filter((r) => releaseUpdates(r, source));
    const out = upcoming.find((r) => r.status === "published");
    const next = out ?? upcoming.filter((r) => r.expected).sort((a, b) => (a.expected! < b.expected! ? -1 : 1))[0] ?? upcoming[0] ?? null;
    const gone = files.filter((f) => f.status !== null && f.status >= 400);
    const undated = files.filter((f) => !f.published);

    let status: FileHealthStatus;
    let reason: string;
    if (gone.length) {
      status = "failing";
      reason = `The publisher no longer serves ${gone.map((f) => `${f.file} (${f.status})`).join(", ")}.`;
    } else if (out) {
      status = "stale";
      reason = `${out.label} is out${out.published ? ` (found ${out.published})` : ""}; the site still uses ${files.map((f) => f.file).join(", ")}. Run npm run sync-data.`;
    } else if (next?.expected && monthOf(next.expected) < monthOf(today)) {
      status = "watch";
      reason = `${next.label} was expected ${next.expected} and isn't out yet.`;
    } else if (undated.length) {
      status = "watch";
      reason = `No published date on record for ${undated.map((f) => f.file).join(", ")}: run npm run source-files.`;
    } else {
      status = "fresh";
      reason = next?.expected ? `The newest release; the next is expected ${next.expected}.` : "The newest release.";
    }
    rows.push({
      source,
      label: info.label,
      files,
      describes,
      published,
      collected: meta.retrieved,
      next: next ? { label: next.label, expected: next.expected, status: next.status, ...(next.published ? { published: next.published } : {}) } : null,
      status,
      reason,
    });
  }
  return rows;
}
