/**
 * The console's words for the code's names (specs/product/admin-redesign.md "Words that change", "Principles: Words,
 * not keys"). Field codes read "C10, class rank"; a review item's key `unit|edition|code` reads as the college, the
 * edition, and the field; collection names, change kinds, and log target kinds read as words. Codes and keys appear on
 * screen only through these functions or under a `<details>Details</details>`. Pure (no server or browser APIs), so
 * pages, client components, and tests share it.
 */
import { CDS_CODE, CDS_ITEM_NAMES, CDS_SECTION_NAMES, itemOfCode, type CdsSection } from "../cds-sections.ts";
import { fieldDef, registeredPathFor } from "../fields.ts";
import type { CheckId } from "../reported.ts";

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

/**
 * Why a machine couldn't get a document, in words: the college-reported failure reasons
 * (specs/college-data-failures.md#reason-codes), the review queue's acquisition checks, and a blocked directory
 * host's reasons. The code itself stays in a `title` or under Details.
 */
export const REASON_WORDS: Readonly<Record<string, string>> = {
  no_document_found: "No document found",
  class_profile_only: "Only a class profile found",
  class_profile_no_figures: "Class profile without figures",
  robots_disallowed: "The site's robots rules forbid it",
  host_blocked: "The site blocks us",
  unreachable: "Couldn't reach it",
  edition_too_old: "Only an old edition",
  not_newer: "Nothing newer than we have",
  edition_unknown: "Edition year unknown",
  never_read: "Never read",
  failed_checks: "Failed the checks",
  read_no_values: "Read, but no values",
  malformed_url: "The address isn't valid",
  discovery_error: "Discovery failed",
  notice_no_term: "Announcement doesn't name the class",
  notice_no_figures: "Announcement without figures",
  season_none_found: "No announcement found this season",
  "not-a-url": "The address isn't valid",
  robots: "The site's robots rules forbid it",
  challenge: "A bot check",
  login: "Needs a login",
  forbidden: "Access refused",
  "rate-limited": "Too many requests",
  unauthorized: "Needs a login",
  terms: "The site's terms forbid it",
};

/** A reason code in words; an unknown one reads as its words ("some_new_reason" → "Some new reason"). */
export function reasonLabel(code: string): string {
  const known = REASON_WORDS[code];
  if (known) return known;
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : code;
}

/**
 * An attempt's stored result ("class_profile_only: only class profile(s) found (2), no Common Data Set", a review
 * queue's "unreachable: HTTP 404 (100654|2025-26|C.101)") split for the screen: `text` is the explanation sentence
 * (the label when there is none), `label` the reason in words, `code` and `key` the raw parts for a title or Details.
 * A result that doesn't start with a code shows as written.
 */
export function attemptResultWords(result: string): { text: string; label: string | null; code: string | null; key: string | null } {
  const m = /^([a-z][a-z0-9]*(?:[_-][a-z0-9]+)*)(?::\s*([\s\S]*))?$/.exec(result.trim());
  if (!m || (!m[2] && !REASON_WORDS[m[1]] && !/[_-]/.test(m[1]))) return { text: result.trim(), label: null, code: null, key: null };
  const code = m[1];
  let detail = (m[2] ?? "").trim();
  let key: string | null = null;
  const k = /\s*\(([^()|\s]*\|[^()|\s]*\|[^()\s]*)\)$/.exec(detail);
  if (k) {
    key = k[1];
    detail = detail.slice(0, k.index).trim();
  }
  const label = reasonLabel(code);
  const text = detail ? detail[0].toUpperCase() + detail.slice(1) : label;
  return { text, label, code, key };
}

/**
 * A stored sentence with snake_case codes in it ("status refers_to_form, but the quoted sentence…"), the codes the
 * map names replaced by their words in quotes ("status “Refers to the form”, but…"). Codes the map doesn't name read
 * as their words with the underscores replaced. The raw sentence belongs in a `title`.
 */
export function codeWordsInText(text: string, words: Readonly<Record<string, string>>): string {
  return text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (code) => `“${words[code] ?? code.replace(/_/g, " ")}”`);
}

/* ------------------------------------------------------------------ */
/* Text the Steward wrote                                              */
/* ------------------------------------------------------------------ */

/** A CDS code as the Steward writes it: an item ("C7", "H2A", "B22") or a template code ("C.1001", "H.2A01"). */
const CODE_PART = String.raw`[A-J](?:\.(?:\d{3,4}|\d[A-Z](?:\d{2})?)|\d{1,2}[A-Z]?)`;
/** A code, or a range of two ("B4–B5", "B4-B5", "B4 to B5"), standing alone (not inside a word, a number, or a key). */
const STEWARD_CODE = new RegExp(String.raw`(?<![\w.\/#|-])(${CODE_PART})(?:(\s*[–—-]\s*|\s+to\s+)(${CODE_PART}))?(?![\w]|\.\d)`, "g");
/** What is left exactly as written: a link, a path, an email, a file name, a review key. */
const PROTECTED = /(\S*(?:[/@|]|:\/\/)\S*|\S+\.(?:pdf|xlsx?|csv|html?|json|docx?)\b)/i;
/** A dotted key ("admissions.acceptance_rate"). */
const DOTTED = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\b/g;

/** The item's own name, or null (a section's name alone is too vague to add to a sentence). */
function itemName(code: string): string | null {
  const item = cdsItem(code);
  return item ? (CDS_ITEM_NAMES[item] ?? null) : null;
}

const lowerFirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

/** Field paths the registry knows read as their label ("admissions.acceptance_rate" → “acceptance rate”). */
function fieldWords(text: string): string {
  return text.replace(DOTTED, (path) => {
    const registered = registeredPathFor(path);
    return registered === path ? `“${lowerFirst(fieldDef(registered).label)}”` : path;
  });
}

/** CDS codes gain their names on first appearance; see `stewardText`. */
function codeWords(text: string, whole: string, seen: Set<string>): string {
  const lower = whole.toLowerCase();
  // A name the sentence already says ("class rank (C10)") needs no repeating.
  const said = (name: string) => lower.includes(name.toLowerCase());
  return text.replace(STEWARD_CODE, (match: string, a: string, _dash: string | undefined, b: string | undefined, offset: number, src: string) => {
    const items = [a, b].filter((c): c is string => !!c).map((c) => cdsItem(c)!);
    if (items.every((i) => seen.has(i))) return match;
    const names = [a, b].filter((c): c is string => !!c).map(itemName);
    items.forEach((i) => seen.add(i));
    if (names.every((n) => !n) || names.every((n) => !n || said(n))) return match;
    const words = b ? (names[0] === names[1] || !names[1] ? names[0] : !names[0] ? names[1] : `${names[0]}; ${names[1]}`) : names[0];
    if (!words) return match;
    // Inside parentheses already ("(C10)"), the name joins them with a comma; elsewhere it follows in its own.
    const wrapped = src[offset - 1] === "(" && src[offset + match.length] === ")";
    return wrapped ? `${match}, ${words}` : `${match} (${words})`;
  });
}

/**
 * A sentence the Steward wrote (a finding, a proposal's summary, a decision's question, a To do note), read in words:
 * a bare CDS code gains its name the first time it appears ("C7" → "C7 (admission factors)", "(C10)" → "(C10, class
 * rank)"), a range both names ("B4–B5 (graduation rates; graduation rates, Pell recipients)"), a registered field
 * path its label in quotes, and a snake_case key its words (`codeWordsInText` with `REASON_WORDS`). A code whose name
 * the sentence already says is left alone, as are later mentions, links, file names, emails and review keys. Pure; the
 * raw sentence belongs in a `title` or under Details.
 */
export function stewardText(text: string | null | undefined): string {
  if (!text) return "";
  const seen = new Set<string>();
  return text
    .split(PROTECTED)
    .map((part, i) => (i % 2 === 1 ? part : codeWordsInText(fieldWords(codeWords(part, text, seen)), REASON_WORDS)))
    .join("");
}

/* ------------------------------------------------------------------ */
/* The checks a Findings cluster is grouped by                         */
/* ------------------------------------------------------------------ */

/**
 * Every check the college-reported pipeline can hold a value with (`CheckId` in lib/reported.ts, the `check` of a
 * Findings cluster), named for what it found: a cluster is a group of values that failed it. Typed against `CheckId`,
 * so a new check without words fails the typecheck; the id stays in a `title`.
 */
export const CHECK_WORDS: Readonly<Record<CheckId, string>> = {
  "cohort-and-scope": "Not first-year students, all rounds",
  "quote-present": "A number with no quote",
  "funnel-order": "More admits than applicants, or more enrolled than admits",
  "rate-matches": "The stated admit rate doesn't match the counts",
  "newer-than-federal": "Not newer than the federal figures",
  "plausible-change": "An unlikely change from the federal figure",
  "sources-agree": "Two documents disagree",
  unreachable: "Couldn't fetch the college's documents",
  "type-range": "A value its type can't hold",
  "number-on-line": "The value isn't on the line it cites",
  "line-in-document": "A cited line isn't in the document",
  "edition-mismatch": "The year doesn't match the edition",
  "form-vs-code": "The form and the code table differ",
  "overflow-total": "A total printed as ## that its parts can't fill in",
  "aid-year": "No aid year stated",
  "parts-sum": "Parts don't add up to the total",
  "sums-to-100": "Percentages don't add up to 100%",
  order: "Values out of order",
  "ratio-matches": "A rate or average doesn't match its counts",
  "one-mark": "Not exactly one mark in a row",
  "grid-column": "A grid read by a model, held until its columns are checked",
  misread: "Misread, by a person's check",
  inconsistent: "Two answers in one document contradict",
  "valid-date": "Not a real date",
  "date-order": "Dates out of the cycle's order",
  "enrollment-disagrees": "Disagrees with the document's enrollment",
  "federal-disagrees": "Disagrees with the federal figure",
  "residency-funnel": "A residency row out of funnel order",
  "residency-sum": "Residency rows don't add up to the total",
  "residency-vs-federal": "Residency shares far from the federal ones",
  "column-3-not-all-undergrads": "The degree-seeking column isn't every undergraduate",
  "previous-cohort-disagrees": "The previous class disagrees with federal graduation rates",
  "not-a-url": "The address isn't a link",
  "out-of-range": "A value outside its usual range",
  "batch-failed": "The document's read failed twice",
};

/** A check id in words; an id the table doesn't know reads as its words ("some-new-check" → "Some new check"). */
export function checkLabel(id: string): string {
  const known = (CHECK_WORDS as Readonly<Record<string, string>>)[id];
  if (known) return known;
  const words = id.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}
