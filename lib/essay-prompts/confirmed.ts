/**
 * The hand read (specs/product/essays/sources.md "The hand read"; the hand-read brief): a college's prompts as a person
 * read them inside the application form, saved through the admin console as
 * `data/essay-prompts/confirmed/<unit_id>.json` and applied by the merge (scripts/lib/essay-prompts/merge.mts) as a
 * `confirmed` block. This module holds what both sides need: the record's type, its checks (`validateConfirmed`), the
 * paste box's splitter (`splitPastedPrompts`), the file's text (`recordJson`), the platform homepage a confirmed block
 * cites (`platformHomepage`), and the words the display uses (`handReadLine`).
 *
 * Pure: no Node, no `scripts/` imports, so the console (a client component and a Server Action) and the scripts both
 * load it. The prompt rules are ported from scripts/lib/essay-prompts/checks.mts `promptProblems` (length, limit,
 * applies_to); tests/essay-prompts-confirmed.test.mts runs both over the same fixtures so they stay in step. The
 * page-word rules (verbatim on the page, an optional word for `required: false`) don't apply: a hand read has no page,
 * and the form marks a prompt required or optional itself.
 */
import type { EssayFormKind, EssayPrompt, SchoolEssays } from "../types.ts";

export type FormKind = EssayFormKind;
export const FORM_KINDS: readonly FormKind[] = ["common_app", "coalition", "own", "apply_texas", "uc"];

/**
 * One college's prompts as a person read them in the application form. `quote` on each prompt is the prompt's own
 * text: a hand read has no surrounding sentence. Replaced whole on each save; history is the git log.
 */
export interface ConfirmedRecord {
  unit_id: string;
  name: string;
  /** "2026-27". A record whose cycle isn't the open one is skipped by the merge. */
  cycle: string;
  /** none: the form shows no college questions beyond the platform's. */
  status: "published" | "none";
  confidence: "confirmed";
  source: "form-by-hand";
  form: FormKind;
  /** ISO date the form was read. */
  read_on: string;
  /** The reader's initials, 1–4 letters. */
  reader: string;
  /** ids "{unit_id}:{cycle}:{n}", n from 1 in the form's order; empty when status is none. */
  prompts: EssayPrompt[];
  choose?: { n: number; of: number; quote: string };
  /** For the PR body only ("the Honors prompt is separate"). */
  note?: string;
}

/** Same values as scripts/lib/essay-prompts/checks.mts (a test holds them equal). */
export const PROMPT_CHARS = { min: 10, max: 1500 } as const;
export const LIMIT_RANGE = { words: { min: 25, max: 2000 }, characters: { min: 100, max: 10_000 } } as const;
const KINDS: readonly EssayPrompt["kind"][] = ["essay", "short_answer", "why_us", "program", "activity", "optional", "other"];
const NOTE_MAX = 500;

/** Where a confirmed block's `source_url` points: the platform's homepage (the only Common App link its terms allow). */
export const PLATFORM_HOMEPAGE: Record<Exclude<FormKind, "own">, string> = {
  common_app: "https://www.commonapp.org",
  coalition: "https://www.coalitionforcollegeaccess.org",
  apply_texas: "https://www.applytexas.org",
  uc: "https://admission.universityofcalifornia.edu",
};

/** The form, named in a sentence ("read in the Common App by hand"). */
export const FORM_NAME: Record<FormKind, string> = {
  common_app: "Common App",
  coalition: "Coalition application",
  own: "college's own application",
  apply_texas: "ApplyTexas application",
  uc: "UC application",
};

/**
 * The page a confirmed block cites: the platform's homepage; for the college's own form, its apply page from `links`
 * (else its admissions page, else its website), else the first web address in the record's note. Null when there is
 * none (the merge skips such a record and says so).
 */
export function platformHomepage(
  form: FormKind,
  school?: { links?: { apply?: string | null; admissions?: string | null; website?: string | null } | null } | null,
  note?: string,
): string | null {
  if (form !== "own") return PLATFORM_HOMEPAGE[form] ?? null;
  const l = school?.links;
  const fromLinks = [l?.apply, l?.admissions, l?.website].find((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
  if (fromLinks) return fromLinks;
  return note?.match(/https?:\/\/[^\s)>"']+/)?.[0]?.replace(/[.,;:]$/, "") ?? null;
}

/** The lineage quote for a confirmed `none`. */
export const noneSentence = (form: FormKind) => `No college questions beyond the platform's; read in the ${FORM_NAME[form]} by hand`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 30, 2026" from an ISO date (the date as written, no time zone shift); the text itself when it isn't one. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The credit a confirmed block carries everywhere it shows: "From the application form, read by hand on October 30, 2026". */
export const handReadLine = (readOn: string) => `From the application form, read by hand on ${longDate(readOn)}`;

/* ------------------------------------------------------------------ */
/* validateConfirmed                                                   */
/* ------------------------------------------------------------------ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_KEYS = ["unit_id", "name", "cycle", "status", "confidence", "source", "form", "read_on", "reader", "prompts", "choose", "note"] as const;
const PROMPT_KEYS = ["id", "text", "kind", "limit", "required", "applies_to", "quote"] as const;

/** The first year of a cycle ("2026-27" → 2026), or null (scripts/lib/essay-prompts/cycle.mts cycleStart, ported). */
export function cycleStartOf(cycle: unknown): number | null {
  const m = typeof cycle === "string" ? /^(20\d\d)-(\d\d)$/.exec(cycle) : null;
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) return null;
  return Number(m[1]);
}

/** A real calendar date in ISO form. */
function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whitespace collapsed, ends trimmed (the form's text as one line). */
const squash = (s: string) => s.replace(/[\s ]+/g, " ").trim();

/** A leading list label a paste leaves behind: "1.", "(2)", "a)", "•", "Prompt 3:", "Question 1 -". */
const LABEL = /^(?:(?:prompt|question|essay|short[\s-]answer)\s*#?\s*\d{1,2}\s*[:.)\-–—]?\s+|\(?\d{1,2}[.):]\s*|\(?[a-hA-H][.)]\s+|\(\d{1,2}\)\s*|[-*•·▪◦‣●○]\s*)/i;

/** Problems with one prompt's text as a person entered it (empty when it reads like the form's words). */
function textProblems(text: string, where: string): string[] {
  const out: string[] = [];
  if (text !== squash(text)) out.push(`${where}: the text has extra spaces or line breaks (save it as one line)`);
  if (LABEL.test(text)) out.push(`${where}: the text starts with a number, letter, bullet, or "Prompt 1:" label; enter the prompt's own words`);
  if (/<\/?[a-z][^>]*>/i.test(text)) out.push(`${where}: the text has HTML tags`);
  if (/(\.\.\.|…)$/.test(text)) out.push(`${where}: the text ends in an ellipsis; enter the whole prompt`);
  if (/\b(lorem ipsum|todo|tbd|xxx)\b/i.test(text)) out.push(`${where}: the text looks like a placeholder`);
  return out;
}

/** Problems with one prompt's limit, kind, and applies_to (the rules of checks.mts promptProblems that need no page). */
export function confirmedPromptProblems(p: EssayPrompt, where: string): string[] {
  const out: string[] = [];
  const text = typeof p.text === "string" ? p.text.trim() : "";
  if (text.length < PROMPT_CHARS.min || text.length > PROMPT_CHARS.max) out.push(`${where}: prompt is ${text.length} characters (${PROMPT_CHARS.min} to ${PROMPT_CHARS.max} allowed)`);
  if (p.limit) {
    const r = LIMIT_RANGE[p.limit.kind as keyof typeof LIMIT_RANGE];
    if (!r) out.push(`${where}: a limit counted in ${JSON.stringify(p.limit.kind)} must be in words or characters`);
    else {
      if (!Number.isInteger(p.limit.max) || p.limit.max < r.min || p.limit.max > r.max) out.push(`${where}: a limit of ${p.limit.max} ${p.limit.kind} is outside ${r.min} to ${r.max}`);
      if (p.limit.min !== undefined && (!Number.isInteger(p.limit.min) || p.limit.min < 1 || p.limit.min >= p.limit.max)) out.push(`${where}: the minimum ${p.limit.min} isn't a whole number below the maximum`);
    }
  } else if (p.limit !== null) out.push(`${where}: a limit must be none or { kind, max }`);
  const program = typeof p.applies_to === "object" && p.applies_to !== null ? p.applies_to.program?.trim() : null;
  if (p.kind === "program" && !program) out.push(`${where}: kind program, but applies_to names no program`);
  if (typeof p.applies_to === "object" && p.applies_to !== null) {
    if (!program) out.push(`${where}: applies to a program, but names none`);
  } else if (!["all", "transfer", "international"].includes(p.applies_to as string)) out.push(`${where}: applies_to ${JSON.stringify(p.applies_to)} isn't all, transfer, international, or a program`);
  return out;
}

/**
 * Every problem with a hand-read record (empty when it can be saved). `today` (ISO) bounds `read_on`; the merge, not
 * this check, decides whether the cycle is the open one.
 */
export function validateConfirmed(record: ConfirmedRecord, today: string = new Date().toISOString().slice(0, 10)): string[] {
  const out: string[] = [];
  const r = (record ?? {}) as Partial<ConfirmedRecord> & Record<string, unknown>;
  if (typeof record !== "object" || record === null) return ["the record isn't an object"];
  for (const k of Object.keys(r)) if (!(RECORD_KEYS as readonly string[]).includes(k)) out.push(`"${k}" isn't a field of a hand-read record`);
  if (typeof r.unit_id !== "string" || !/^\d{1,12}$/.test(r.unit_id)) out.push(`unit_id ${JSON.stringify(r.unit_id)} isn't 1 to 12 digits`);
  if (typeof r.name !== "string" || !r.name.trim()) out.push("the college's name is missing");
  if (cycleStartOf(r.cycle) === null) out.push(`cycle ${JSON.stringify(r.cycle)} isn't "YYYY-YY" (two consecutive years)`);
  if (r.status !== "published" && r.status !== "none") out.push(`status ${JSON.stringify(r.status)} isn't published or none`);
  if (r.confidence !== "confirmed") out.push('confidence must be "confirmed"');
  if (r.source !== "form-by-hand") out.push('source must be "form-by-hand"');
  if (!FORM_KINDS.includes(r.form as FormKind)) out.push(`form ${JSON.stringify(r.form)} isn't one of ${FORM_KINDS.join(", ")}`);
  if (!isRealDate(r.read_on)) out.push(`read_on ${JSON.stringify(r.read_on)} isn't a date (YYYY-MM-DD)`);
  else if (r.read_on > today) out.push(`read_on ${r.read_on} is in the future`);
  if (typeof r.reader !== "string" || !/^[A-Za-z]{1,4}$/.test(r.reader)) out.push(`reader ${JSON.stringify(r.reader)} isn't 1 to 4 letters (initials)`);
  if (r.note !== undefined && (typeof r.note !== "string" || r.note.length > NOTE_MAX)) out.push(`note must be text of at most ${NOTE_MAX} characters`);

  const prompts = Array.isArray(r.prompts) ? r.prompts : null;
  if (!prompts) out.push("prompts must be a list");
  else if (r.status === "published" && !prompts.length) out.push("the form asks questions, but none are entered");
  else if (r.status === "none" && prompts.length) out.push(`status none, but ${prompts.length} prompt(s)`);

  const seen = new Set<string>();
  (prompts ?? []).forEach((p, i) => {
    const where = `prompt ${i + 1}`;
    if (typeof p !== "object" || p === null) {
      out.push(`${where}: isn't a prompt`);
      return;
    }
    for (const k of Object.keys(p)) if (!(PROMPT_KEYS as readonly string[]).includes(k)) out.push(`${where}: "${k}" isn't a field of a prompt`);
    if (p.id !== `${r.unit_id}:${r.cycle}:${i + 1}`) out.push(`${where}: id ${p.id} isn't ${r.unit_id}:${r.cycle}:${i + 1}`);
    const text = typeof p.text === "string" ? p.text : "";
    if (!text.trim()) out.push(`${where}: the text is empty`);
    else out.push(...textProblems(text, where));
    if (typeof p.quote !== "string" || !p.quote.trim()) out.push(`${where}: no quote (a hand read's quote is the prompt's own text)`);
    else if (squash(p.quote) !== squash(text)) out.push(`${where}: the quote isn't the prompt's own text (a hand read has no surrounding sentence)`);
    if (!KINDS.includes(p.kind)) out.push(`${where}: kind ${JSON.stringify(p.kind)} isn't one of ${KINDS.join(", ")}`);
    if (typeof p.required !== "boolean") out.push(`${where}: required must be true or false`);
    out.push(...confirmedPromptProblems(p, where));
    const key = squash(text).toLowerCase();
    if (key && seen.has(key) && typeof p.applies_to === "string") out.push(`${where}: the same prompt twice`);
    seen.add(key);
  });

  if (r.choose !== undefined) {
    const c = r.choose as Partial<NonNullable<ConfirmedRecord["choose"]>> | null;
    const n = c?.n;
    const of = c?.of;
    const optional = (prompts ?? []).filter((p) => p && p.required === false).length;
    if (r.status !== "published") out.push(`choose is set, but status is ${r.status}`);
    if (!Number.isInteger(n) || (n as number) < 1) out.push(`choose: how many to answer (${JSON.stringify(n)}) must be a whole number of at least 1`);
    if (!Number.isInteger(of) || (of as number) <= (n as number)) out.push(`choose: ${n} of ${JSON.stringify(of)} isn't a choice (of must be a whole number above n)`);
    else if (r.status === "published" && of !== optional) out.push(`choose says ${of} prompts to pick from, but ${optional} ${optional === 1 ? "is" : "are"} marked optional (the set is the optional prompts; required ones stand outside it)`);
    if (typeof c?.quote !== "string" || !c.quote.trim()) out.push("choose: no quote (the form's own words, \"Answer two of the following\")");
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* splitPastedPrompts                                                  */
/* ------------------------------------------------------------------ */

/** A line that opens a list item ("1. …", "b) …", "• …", "Prompt 2: …"). */
const ITEM_START = /^\s*(?:(?:prompt|question|essay|short[\s-]answer)\s*#?\s*\d{1,2}\s*[:.)\-–—]|\(?\d{1,2}[.)]\s|\(?[a-hA-H][.)]\s|\(\d{1,2}\)\s|[-*•·▪◦‣●○]\s)/i;

/** One pasted paragraph as a prompt: its leading label stripped, whitespace collapsed. */
function cleanItem(lines: readonly string[]): string {
  let text = squash(lines.join(" "));
  // Twice: "1. • Tell us…" or "Prompt 1: a) …" carry two labels.
  for (let i = 0; i < 2; i++) text = text.replace(LABEL, "").trim();
  return text;
}

/**
 * The paste box (the console form's "Enter the questions"): text copied from the form becomes one prompt per
 * paragraph. Paragraphs are separated by blank lines; a paragraph is never split, except a block whose every line opens
 * a list item (a numbered list pasted without blank lines), which is one prompt per line. Leading numbers, letters,
 * bullets, and "Prompt 1:" labels are stripped; whitespace is collapsed. Empty paragraphs are dropped.
 */
export function splitPastedPrompts(text: string): string[] {
  if (typeof text !== "string") return [];
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t ]*\n/)
    .map((b) => b.split("\n").filter((l) => l.trim()))
    .filter((lines) => lines.length);
  const out: string[] = [];
  for (const lines of blocks) {
    if (lines.length > 1 && lines.every((l) => ITEM_START.test(l))) for (const l of lines) out.push(cleanItem([l]));
    else out.push(cleanItem(lines));
  }
  return out.filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* recordJson                                                          */
/* ------------------------------------------------------------------ */

const HEAD_KEYS = ["unit_id", "name", "cycle", "status", "confidence", "source", "form", "read_on", "reader", "choose", "note"] as const;

function ordered<T extends object>(o: T, keys: readonly string[]): Record<string, unknown> {
  const rec = o as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => rec[k] !== undefined).map((k) => [k, rec[k]]));
}

/**
 * The record file's text: fixed key order, one prompt per line, a closing newline (the shape store.mts writes reader
 * records in), so a re-save of the same read is byte-identical and a changed prompt is a one-line diff.
 */
export function recordJson(record: ConfirmedRecord): string {
  // Nested objects too: a row read back from Postgres jsonb has its keys reordered ({"max":250,"kind":"words"}), and
  // the export must still write the same bytes.
  const choose = record.choose && typeof record.choose === "object" ? ordered(record.choose, ["n", "of", "quote"]) : record.choose;
  const head = JSON.stringify(ordered({ ...record, choose }, HEAD_KEYS));
  const prompts = record.prompts ?? [];
  const prompt = (p: EssayPrompt) => {
    const limit = p.limit && typeof p.limit === "object" ? ordered(p.limit, ["kind", "max", "min"]) : p.limit;
    const applies = p.applies_to && typeof p.applies_to === "object" ? ordered(p.applies_to, ["program"]) : p.applies_to;
    return JSON.stringify(ordered({ ...p, limit, applies_to: applies } as EssayPrompt, PROMPT_KEYS));
  };
  const lines = prompts.length ? `[\n${prompts.map((p) => `  ${prompt(p)}`).join(",\n")}\n]` : "[]";
  return `${head.slice(0, -1)},\n  "prompts": ${lines}\n}\n`;
}

/* ------------------------------------------------------------------ */
/* The block, and the advisor's live overlay                           */
/* ------------------------------------------------------------------ */

/** The cycle open on `today` (ISO): from 1 August to 31 July (scripts/lib/essay-prompts/cycle.mts openCycle, ported). */
export function openCycleOf(today: string): string {
  const y = Number(today.slice(0, 4));
  const start = Number(today.slice(5, 7)) >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

type LinksHolder = { links?: { apply?: string | null; admissions?: string | null; website?: string | null } | null } | null | undefined;

/**
 * The `school.essays` block a hand-read record makes (the merge's `blockOf` for a confirmed record, and the advisor's
 * overlay, so the two never differ): the platform's homepage as `source_url`, the day read as `retrieved`, the prompts
 * only when published, then `confidence`, `form`, `read_on`, `reader`. Null when there's no page to cite (the
 * college's own form with no apply page on file).
 */
export function confirmedBlock(r: ConfirmedRecord, school?: LinksHolder): SchoolEssays | null {
  const url = platformHomepage(r.form, school, r.note);
  if (!url) return null;
  const published = r.status === "published";
  return {
    cycle: r.cycle,
    status: r.status,
    source_url: url,
    retrieved: r.read_on,
    ...(published && r.choose ? { choose: r.choose } : {}),
    prompts: published ? r.prompts : [],
    confidence: "confirmed",
    form: r.form,
    read_on: r.read_on,
    reader: r.reader,
  };
}

/**
 * The advisor's live view of a college's prompts (the hand-read brief, "The advisor overlays the table live"): the
 * dataset's block with the console's saved row (`public.essay_prompt_overrides`) laid over it by the merge's
 * precedence. A block from the college's own page with `status: "published"` wins; otherwise the row's record becomes
 * the block (it beats `refers_to_form`, `none`, no block at all, and an older hand read exported to the dataset). A row
 * that isn't for the open cycle, fails `validateConfirmed`, or names another college changes nothing. Pure.
 */
export function overlayEssays(
  school: { unit_id: string; essays?: SchoolEssays | null } & NonNullable<LinksHolder>,
  override: ConfirmedRecord | null | undefined,
  today: string,
): SchoolEssays | undefined {
  const current = school.essays ?? undefined;
  if (!override || override.unit_id !== school.unit_id) return current;
  if (override.cycle !== openCycleOf(today) || validateConfirmed(override, today).length) return current;
  if (current?.status === "published" && current.confidence !== "confirmed") return current;
  return confirmedBlock(override, school) ?? current;
}
