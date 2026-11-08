/**
 * Two CDS files side by side (specs/product/document-collisions.md): the facts of each file in plain words (when it was
 * pulled, from where, how its edition was decided, who read it), the items whose values differ, and where a college's
 * record has a collision (two files claiming one edition) or a Steward refile would make one.
 *
 * Pure: type imports, lib/cds-sections.ts, and the console's words. The college page's Documents panel, the keep
 * action, the Inbox, the Steward's writer, and its apply job all read it; tests/document-collisions.test.mts runs it
 * over two fixture files shaped like UC Santa Cruz's.
 */
import { compareCodes, parseEdition, type CdsCode, type CollegeRecord, type DocumentRecord, type ItemResult, type ManifestEntry, type TemplateTable } from "../cds-sections.ts";
import type { ProposalDoc } from "../steward/types.ts";
import { codeLabel, editionLabel } from "./words.ts";

/* ------------------------------------------------------------------ */
/* The facts of one file                                               */
/* ------------------------------------------------------------------ */

/** How the file's edition was decided: the file says so, it was assumed, a person set it, or nobody recorded how. */
export type FiledBy = "assumed" | "stated" | "manual" | "unknown";

export interface DocumentFacts {
  sha256: string;
  source: { url: string; host: string; finalUrl?: string };
  /** ISO date the bytes were pulled. */
  retrieved: string;
  /** The edition it is filed under ("2025-26"). */
  filedAs: string;
  filedBy: FiledBy;
  /** What the file says about its own edition ("the cover says 2024-2025", "states no edition"), when an item carries it. */
  coverLine?: string;
  /** The newest read: who (a model's short name or a reader), on what date, and how. */
  reader: { by: string; on: string; mode: string } | null;
  /** Items with a value read (passed or failed). */
  itemsRead: number;
  /** Items with at least one check failure. */
  itemsWithFailures: number;
  /** The template's item count, when the caller gave the template. */
  itemsTotal: number | null;
  pages: number | null;
  bytes: number | null;
}

/** The manifest's `edition_from` as the console says it. */
export function filedByOf(from: ManifestEntry["edition_from"] | null | undefined): FiledBy {
  if (from === "assumed") return "assumed";
  if (from === "manual") return "manual";
  if (from === "cover" || from === "items" || from === "workbook" || from === "url") return "stated";
  return "unknown";
}

/** "www.ucsc.edu" for a URL; the text itself when it isn't one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** A reader in a word: "Sonnet", "Haiku", "Opus", "the workbook reader", or the id as written. */
export function readerName(id: string): string {
  const s = id.toLowerCase();
  if (s.includes("sonnet")) return "Sonnet";
  if (s.includes("haiku")) return "Haiku";
  if (s.includes("opus")) return "Opus";
  if (s.startsWith("xlsx")) return "the workbook reader";
  if (s.startsWith("pdf-form")) return "the form reader";
  return id;
}

const READ = new Set<ItemResult["status"]>(["passed", "failed"]);

/** What the file says about its own edition, from an edition-mismatch failure's detail (lib/cds-checks.ts). */
function coverLineOf(doc: DocumentRecord): string | undefined {
  for (const it of Object.values(doc.items)) {
    for (const f of it.failures ?? []) {
      if (f.check !== "edition-mismatch") continue;
      const m = /^the cover says ([^;]+)/.exec(f.detail);
      if (m) return `the cover says ${m[1].trim()}`;
      if (f.detail.startsWith("the document states no edition")) return "states no edition";
    }
  }
  return undefined;
}

/** The facts of one file, from its record entry and (when there is one) its manifest entry. */
export function documentFacts(doc: DocumentRecord, manifestEntry?: ManifestEntry | null, template?: Pick<TemplateTable, "items"> | null): DocumentFacts {
  const reads = Object.values(doc.reads ?? {}).filter((r): r is NonNullable<typeof r> => !!r);
  const newest = reads.sort((a, b) => (b.extracted ?? "").localeCompare(a.extracted ?? ""))[0] ?? null;
  const items = Object.values(doc.items ?? {});
  const finalUrl = doc.final_url ?? manifestEntry?.final_url;
  const coverLine = coverLineOf(doc);
  return {
    sha256: doc.sha256,
    source: { url: doc.url, host: hostOf(doc.url), ...(finalUrl && finalUrl !== doc.url ? { finalUrl } : {}) },
    retrieved: doc.retrieved.slice(0, 10),
    filedAs: doc.edition,
    filedBy: filedByOf(manifestEntry?.edition_from),
    ...(coverLine ? { coverLine } : {}),
    reader: newest ? { by: readerName(newest.read_by), on: (newest.extracted ?? "").slice(0, 10), mode: newest.mode } : null,
    itemsRead: items.filter((it) => READ.has(it.status)).length,
    itemsWithFailures: items.filter((it) => (it.failures?.length ?? 0) > 0).length,
    itemsTotal: template ? template.items.length : null,
    pages: manifestEntry?.pages ?? null,
    bytes: manifestEntry?.bytes ?? null,
  };
}

const n = (x: number) => x.toLocaleString("en-US");

const FILED_BY_WORDS: Record<FiledBy, string> = {
  assumed: "by assumption",
  stated: "as the file states",
  manual: "by a person",
  unknown: "(how isn't recorded)",
};

/** "filed as 2025-26 by assumption" */
export function filedWords(f: Pick<DocumentFacts, "filedAs" | "filedBy">): string {
  return `filed as ${editionLabel(f.filedAs)} ${FILED_BY_WORDS[f.filedBy]}`;
}

/**
 * The facts in one sentence: "Pulled 2026-10-26 from drive.google.com (the full address under Details); filed as
 * 2025-26 by assumption; read by Sonnet on 2026-10-26: 367 of 1,105 items, 367 with check failures."
 */
export function factsSentence(f: DocumentFacts): string {
  const read = f.reader ? `read by ${f.reader.by} on ${f.reader.on}` : "no read recorded";
  const items = `${n(f.itemsRead)}${f.itemsTotal !== null ? ` of ${n(f.itemsTotal)}` : ""} items, ${n(f.itemsWithFailures)} with check failures`;
  return `Pulled ${f.retrieved} from ${f.source.host} (the full address under Details); ${filedWords(f)}; ${read}: ${items}.`;
}

/** "1.2 MB", "840 KB" */
export function sizeWords(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

type Value = ItemResult["v"];

/**
 * A value as the console shows CDS values (lib/steward/review-rows.ts `valueWords`: separators, Yes/No, text as text),
 * with the template's type: a percent item (stored 0–1) as a percent, a currency item in dollars.
 */
export function cdsValueWords(v: Value | undefined, valueType?: string | null): string {
  if (v === null || v === undefined || v === "") return "None";
  if (typeof v === "number") {
    if (valueType === "percent" && v >= 0 && v <= 1) return `${Number((v * 100).toFixed(1)).toLocaleString("en-US")}%`;
    if (valueType === "currency") return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (typeof a === "string" && typeof b === "string") return a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
  return a === b;
}

/** An item that carries a value read from the file. */
const hasValue = (it: ItemResult | undefined): it is ItemResult => !!it && READ.has(it.status) && it.v !== undefined && it.v !== null && it.v !== "";

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export interface DifferRow {
  code: CdsCode;
  label: string;
  a: string;
  b: string;
}

export interface OnlyRow {
  code: CdsCode;
  label: string;
  value: string;
}

export interface Comparison {
  /** Items both files read with the same value. */
  agree: number;
  differ: DifferRow[];
  onlyA: OnlyRow[];
  onlyB: OnlyRow[];
  /** Items with a check failure in each file. */
  failuresA: number;
  failuresB: number;
}

/** Template order: section, then code (compareCodes orders by section letter first). */
const byCode = (x: { code: CdsCode }, y: { code: CdsCode }) => compareCodes(x.code, y.code);

/** The two files' items compared: what agrees, what differs, what only one read. */
export function compareDocuments(a: DocumentRecord, b: DocumentRecord, template?: Pick<TemplateTable, "byCode"> | null): Comparison {
  const type = (code: CdsCode) => template?.byCode.get(code)?.value_type ?? null;
  const codes = new Set<CdsCode>([...Object.keys(a.items ?? {}), ...Object.keys(b.items ?? {})]);
  let agree = 0;
  const differ: DifferRow[] = [];
  const onlyA: OnlyRow[] = [];
  const onlyB: OnlyRow[] = [];
  for (const code of codes) {
    const [x, y] = [a.items[code], b.items[code]];
    const [hx, hy] = [hasValue(x), hasValue(y)];
    if (hx && hy) {
      if (sameValue(x.v, y.v)) agree++;
      else differ.push({ code, label: codeLabel(code), a: cdsValueWords(x.v, type(code)), b: cdsValueWords(y.v, type(code)) });
    } else if (hx) onlyA.push({ code, label: codeLabel(code), value: cdsValueWords(x.v, type(code)) });
    else if (hy) onlyB.push({ code, label: codeLabel(code), value: cdsValueWords(y.v, type(code)) });
  }
  const failures = (d: DocumentRecord) => Object.values(d.items ?? {}).filter((it) => (it.failures?.length ?? 0) > 0).length;
  return { agree, differ: differ.sort(byCode), onlyA: onlyA.sort(byCode), onlyB: onlyB.sort(byCode), failuresA: failures(a), failuresB: failures(b) };
}

/* ------------------------------------------------------------------ */
/* Collisions                                                          */
/* ------------------------------------------------------------------ */

export interface Collision {
  edition: string;
  /** The documents claiming it, newest pull first. */
  documents: DocumentRecord[];
}

/** The editions with more than one document on the record, newest edition first. */
export function collisions(record: Pick<CollegeRecord, "documents"> | null | undefined): Collision[] {
  const by = new Map<string, DocumentRecord[]>();
  for (const d of record?.documents ?? []) (by.get(d.edition) ?? by.set(d.edition, []).get(d.edition)!).push(d);
  return [...by]
    .filter(([, docs]) => docs.length > 1)
    .map(([edition, docs]) => ({ edition, documents: [...docs].sort((x, y) => y.retrieved.localeCompare(x.retrieved)) }))
    .sort((x, y) => (parseEdition(y.edition)?.start ?? 0) - (parseEdition(x.edition)?.start ?? 0));
}

/** The record's document a sha (or a prefix of it, 6 characters at least) names, when exactly one matches. */
export function findDocument(record: Pick<CollegeRecord, "documents"> | null | undefined, sha: string | null | undefined): DocumentRecord | null {
  const s = (sha ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{6,64}$/.test(s)) return null;
  const hits = (record?.documents ?? []).filter((d) => d.sha256.startsWith(s));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The document a refile of `sha` to `toEdition` would collide with (its sha256), or null: another document already
 * filed under that edition. Moving a file to the edition it is already in collides with nothing; a sha the record
 * doesn't hold is refile-document's own refusal, not a collision.
 */
export function refileCollision(record: Pick<CollegeRecord, "documents"> | null | undefined, sha: string, toEdition: string): string | null {
  const doc = findDocument(record, sha);
  const to = parseEdition(toEdition)?.key ?? toEdition;
  if (!doc || doc.edition === to) return null;
  return (record?.documents ?? []).find((d) => d !== doc && d.edition === to)?.sha256 ?? null;
}

/* ------------------------------------------------------------------ */
/* The compare link                                                    */
/* ------------------------------------------------------------------ */

/** The characters of a sha a compare link carries. */
export const LINK_SHA = 10;

/** `/admin/data/colleges/<unit>?compare=<a>,<b>#documents` (each sha cut to LINK_SHA characters). */
export function compareHref(unit: string, a: string, b: string): string {
  return `/admin/data/colleges/${unit}?compare=${a.slice(0, LINK_SHA)},${b.slice(0, LINK_SHA)}#documents`;
}

const LINK = /\/admin\/data\/colleges\/\d{6,8}\?compare=[0-9a-f]{6,64},[0-9a-f]{6,64}#documents/;

/** The compare link a message carries (an apply's refusal, a held change's summary), or null. */
export function compareLinkIn(text: string | null | undefined): string | null {
  return LINK.exec(text ?? "")?.[0] ?? null;
}

/** A `?compare=` value: two different shas (or prefixes), or null. */
export function parseCompare(value: string | string[] | null | undefined): [string, string] | null {
  const v = Array.isArray(value) ? value[0] : value;
  const parts = (v ?? "").split(",").map((s) => s.trim().toLowerCase());
  if (parts.length !== 2 || !parts.every((p) => /^[0-9a-f]{6,64}$/.test(p)) || parts[0] === parts[1]) return null;
  return [parts[0], parts[1]];
}

/** "110714 already has a 2024-25 document" (refile-document's refusal, before a link was added): the college and edition. */
export function collisionNamedIn(text: string | null | undefined): { unit: string; edition: string } | null {
  const m = /(\d{6,8}) already has an? (\d{4}-\d{2}) document/.exec(text ?? "");
  return m ? { unit: m[1], edition: m[2] } : null;
}

/**
 * Where a proposal's collision is decided: the link its failed apply carries, or, for a refile still in play (open,
 * asked, approved, failed) whose row would move a file into a taken edition, the comparison worked out from the record.
 * Null when there is no collision.
 */
export async function collisionHref(p: Pick<ProposalDoc, "kind" | "status" | "rows" | "failed_reason">, readRecord: (unit: string) => Promise<CollegeRecord | null>): Promise<string | null> {
  const carried = compareLinkIn(p.failed_reason);
  if (carried) return carried;
  if (p.kind !== "refile" || !["open", "asked", "approved", "failed"].includes(p.status)) return null;
  const records = new Map<string, CollegeRecord | null>();
  for (const r of p.rows) {
    if (!r.sha256 || !r.edition || r.decision === "declined") continue;
    if (!records.has(r.unit_id)) records.set(r.unit_id, await readRecord(r.unit_id));
    const other = refileCollision(records.get(r.unit_id), r.sha256, r.edition);
    if (other) return compareHref(r.unit_id, r.sha256, other);
  }
  return null;
}

/** The collision finding's key (`steward.issues`): one per college and edition. */
export function collisionIssueKey(unit: string, edition: string): string {
  return `collision|${unit}|${edition}`;
}

/** "Choose the file": the action a collision's link carries on the Inbox and a finding. */
export const CHOOSE_THE_FILE = "Choose the file";

/**
 * What Keep this file does, in one sentence for its confirmation: "The other file (pulled 2026-10-19 from www.ucsc.edu)
 * is dropped from this college: its 63 queue items go, its address is listed so discovery won't fetch it again. The kept
 * file stays as it is."
 */
export function keepSentence(other: Pick<DocumentFacts, "retrieved" | "source">, otherQueueItems: number): string {
  const items = `${otherQueueItems.toLocaleString("en-US")} queue item${otherQueueItems === 1 ? "" : "s"}`;
  return `The other file (pulled ${other.retrieved} from ${other.source.host}) is dropped from this college: its ${items} go, its address is listed so discovery won't fetch it again. The kept file stays as it is.`;
}
