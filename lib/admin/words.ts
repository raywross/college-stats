/**
 * The console's words for the code's names (specs/product/admin-redesign.md "Words that change", "Principles: Words,
 * not keys"). Field codes read "C10, class rank"; a review item's key `unit|edition|code` reads as the college, the
 * edition, and the field; collection names, change kinds, and log target kinds read as words. Codes and keys appear on
 * screen only through these functions or under a `<details>Details</details>`. Pure (no server or browser APIs), so
 * pages, client components, and tests share it.
 */
import { CDS_CODE, CDS_ITEM_NAMES, CDS_SECTION_NAMES, itemOfCode, type CdsSection } from "../cds-sections.ts";

/** The words that replace the code's names, in one place so every screen says the same thing. */
export const WORDS = {
  change: "change",
  changes: "Changes",
  heldChange: "held change",
  publishedVersion: "published version",
  publishedVersions: "Published versions",
  liveVersion: "the live version",
  finding: "finding",
  findings: "Findings",
  held: "held",
  makeLive: "Make this the live version",
  undoChange: "Undo this change",
  restoreVersion: (n: number | string) => `Restore version ${n}`,
  admins: "Admins",
  runNow: "Run now",
  testDate: "Test date",
  pullRequests: "Open pull requests on GitHub",
} as const;

const ITEM = /^([A-J])(\d{1,2})([A-Z])?$/;

/** The CDS item a code names ("C.1001" → "C10", "C10" → "C10", "H.2A01" → "H2A"), or null for anything else. */
export function cdsItem(code: string): string | null {
  const c = code.trim();
  if (CDS_CODE.test(c)) return itemOfCode(c);
  if (c === "J") return "J";
  const m = ITEM.exec(c);
  return m ? `${m[1]}${m[2]}${m[3] ?? ""}` : null;
}

/** The field's name in words ("class rank"), or null when the code isn't a CDS code the table names. */
export function codeName(code: string | null | undefined): string | null {
  if (!code) return null;
  const item = cdsItem(code);
  if (!item) return null;
  return CDS_ITEM_NAMES[item] ?? CDS_SECTION_NAMES[item[0] as CdsSection] ?? null;
}

/**
 * A field code with its name: "C10, class rank", "C.1001, class rank". A code the table doesn't know shows as written,
 * and no code at all shows as "the whole document" (a C1 extraction carries none).
 */
export function codeLabel(code: string | null | undefined): string {
  if (!code || !code.trim()) return "the whole document";
  const name = codeName(code);
  return name ? `${code.trim()}, ${name}` : code.trim();
}

/** A review item's key `unit|edition|code` split into its parts (null where a part is missing). */
export function parseItemKey(key: string): { unit: string | null; edition: string | null; code: string | null } {
  const [unit, edition, code] = key.split("|");
  return { unit: unit || null, edition: edition || null, code: code || null };
}

/**
 * A review item's key in words: "Harvard University, 2025–26, C10, class rank". `name` is the college's name when the
 * caller has it (the key carries only the unit id).
 */
export function itemKeyLabel(key: string, name?: string | null): string {
  const { unit, edition, code } = parseItemKey(key);
  const college = name?.trim() || (unit ? `College ${unit}` : "A college");
  return [college, edition ? editionLabel(edition) : null, code ? codeLabel(code) : null].filter(Boolean).join(", ");
}

/** "2025-26" → "2025–26" (an en dash, as the site writes a year range). */
export function editionLabel(edition: string): string {
  return edition.replace(/^(\d{4})[-/–](\d{2,4})$/, "$1–$2");
}

/** Every data-store collection the console names, in words (the collection's name stays under Details). */
export const COLLECTION_WORDS: Readonly<Record<string, string>> = {
  "base.aliases": "college aliases",
  "base.colleges": "the federal base data",
  "base.detail": "college detail",
  "base.meta": "dataset facts",
  "base.release_calendar": "the release calendar",
  "base.source_files": "the source files",
  "campus.pages": "campus pages",
  "campus.sources": "campus sources",
  "coalition.members": "Coalition members",
  "common_app.grid": "the Common App requirements grid",
  "common_app.members": "Common App members",
  "common_app.name_map": "Common App names",
  "directories.blocked": "blocked directory hosts",
  "directories.listings": "campus directory listings",
  "directories.matches": "directory matches",
  "directories.unmatched": "unmatched directory names",
  "identity.brand_colors": "college colors",
  "identity.brand_logos": "college logos",
  "identity.brand_overrides": "brand overrides",
  "identity.link_issues": "link problems",
  "identity.probe": "site probes",
  "identity.wikidata": "Wikidata accounts",
  "identity.wikidata_issues": "Wikidata problems",
  "reported.batches": "college-reported batches",
  "reported.cds_records": "Common Data Set records",
  "reported.docs": "college documents",
  "reported.entries": "college-reported values",
  "reported.failures": "documents that failed to read",
  "reported.reports": "college-reported run reports",
  "reported.review_queue": "the review queue",
  "reported.sources": "college document addresses",
  "steward.issues": "the Steward's findings",
  "steward.proposals": "the Steward's proposals",
  "steward.todo": "the Steward's To do",
  "steward.decisions": "the Steward's decisions",
  "steward.audits": "the Steward's audits",
  "steward.runs": "the Steward's runs",
  "steward.reviews": "the Steward's job reviews",
  "essays.prompts": "essay questions",
  "essays.held": "held essay questions",
  "essays.overrides": "hand-read essay questions",
};

/** A collection in words; an unknown one reads as its parts ("visit_events.hosts" → "visit events: hosts"). */
export function collectionLabel(name: string): string {
  return COLLECTION_WORDS[name] ?? name.replace(/_/g, " ").replace(".", ": ");
}

const CHANGE_KIND_WORDS: Readonly<Record<string, string>> = {
  pipeline: "Pipeline run",
  import: "Import",
  edit: "Console edit",
  revert: "Undo",
  "publish-fix": "Publish fix",
};

/** A change's kind in words (`data_change_sets.kind`). */
export function changeKindLabel(kind: string): string {
  return CHANGE_KIND_WORDS[kind] ?? kind.replace(/[-_]/g, " ");
}

const TARGET_KIND_WORDS: Readonly<Record<string, string>> = {
  user: "Person",
  student: "Student record",
  household: "Household",
  invitation: "Invitation",
  member: "Household member",
  organization: "Organization",
  setting: "Setting",
  college: "College",
  change_set: "Change",
  snapshot: "Published version",
};

/** A log row's target kind in words. */
export function targetKindLabel(kind: string | null | undefined): string {
  if (!kind) return "—";
  return TARGET_KIND_WORDS[kind] ?? kind.replace(/[-_]/g, " ");
}
