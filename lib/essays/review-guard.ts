/**
 * The guard (specs/product/essays/reviewer.md "The guard"): runs on every answer the reader gives, before anything is
 * stored or shown. A note that breaks a rule is dropped, with its reason, and never reaches the student; a review whose
 * every note was dropped shows "Nothing to note this time". The rules, each with a test that plants the violation
 * (tests/essays-review-guard.test.mts):
 *
 * 1. `fix` is empty unless the category is `mechanics`, and then at most eight words.
 * 2. No field except `fix` holds more than eight consecutive words that also appear, in order, in the draft (quoting
 *    the student back is the span's job).
 * 3. No field holds a grade word, a percentage, "chance", or "admit"/"accept" in a predicting sense (word lists below).
 * 4. `observation`, `why`, and `ask` are each one or two sentences.
 * 5. A `care` note asks a question and never gives an instruction.
 * Also, beyond the spec's list, because the product rule is "Quad never writes a sentence of the essay": 6. no field
 * proposes wording (a quoted passage of four or more words that is not the draft's or the prompt's own, or "try
 * writing…", "something like…", "a stronger version"); 7. the note has the schema's shape, a known category, and a span
 * that points at words actually in the draft; 8. at most MAX_NOTES (eight) notes per review.
 *
 * Pure; safe anywhere. Never throws on any input.
 */
import { paragraphsOf } from "./normalize.ts";
import type { NoteSpan } from "./notes-view.ts";
import { FIX_MAX_WORDS, isNoteCategory, MAX_NOTES, MAX_SENTENCES, NOTE_CATEGORIES, QUOTE_RUN_MAX, type NoteCategory } from "./rubric.ts";

export type { NoteSpan };

/** A note as the model returns it (the structured output's item). */
export interface RawNote {
  category: string;
  paragraph: number | null;
  quote: string | null;
  observation: string;
  why: string;
  source: string | null;
  ask: string;
  fix: string | null;
}

/** A note that passed: what is stored and shown. */
export interface GuardedNote {
  category: NoteCategory;
  span: NoteSpan | null;
  observation: string;
  why: string;
  source: string | null;
  ask: string;
  fix: string | null;
}

export type DropReason = "shape" | "category" | "span" | "fix" | "quote_run" | "grade_word" | "prediction" | "sentences" | "care_question" | "care_instruction" | "prose" | "over_limit";
export const DROP_REASONS: readonly DropReason[] = ["shape", "category", "span", "fix", "quote_run", "grade_word", "prediction", "sentences", "care_question", "care_instruction", "prose", "over_limit"];

export interface Dropped {
  /** The note's category as the model gave it ("unknown" when it wasn't one). */
  category: string;
  reason: DropReason;
}

export interface GuardResult {
  kept: GuardedNote[];
  dropped: Dropped[];
}

export interface GuardOptions {
  /** The prompt's text: a note may quote the prompt back. */
  promptText?: string | null;
  /** The urls the guidance sent cites; a `source` outside them is cleared (not dropped). */
  allowedSources?: ReadonlySet<string> | null;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/** Words, lowercased, with curly apostrophes made straight ("don't", "well-known" are one word each). */
export function wordsOf(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? []
  );
}

/** Every run of `n` consecutive words in `text`, joined by spaces. */
function grams(words: readonly string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/** The longest run of consecutive words `field` shares, in order, with the draft (only runs over QUOTE_RUN_MAX matter). */
export function sharesRunWith(field: string, draftGrams: ReadonlySet<string>, n = QUOTE_RUN_MAX + 1): boolean {
  const w = wordsOf(field);
  for (let i = 0; i + n <= w.length; i++) if (draftGrams.has(w.slice(i, i + n).join(" "))) return true;
  return false;
}

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|mr|mrs|ms|dr|st|vs|u\.s|a\.m|p\.m|no)\./gi;
/** Quoted passages ("…", “…”, and ‘…’/'…' at word boundaries), whose inner punctuation isn't the note's own. */
const QUOTED = /“[^”]*”|"[^"]*"|(?<![\p{L}\p{N}])['‘][^'’\n]*?['’](?![\p{L}\p{N}])/gu;

/** How many sentences a field holds: quoted passages and abbreviations don't end one. */
export function sentenceCount(text: string): number {
  const plain = text.replace(QUOTED, "Q").replace(ABBREVIATIONS, (m) => m.slice(0, -1));
  return plain
    .split(/(?<=[.!?…])["'”’)]*\s+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

/** The text of each quoted passage in a field. */
export function quotedPassages(text: string): string[] {
  return [...text.matchAll(QUOTED)].map((m) => m[0].slice(1, -1).trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Word lists (rule 3)                                                 */
/* ------------------------------------------------------------------ */

/** School years: "ninth grade", "9th grade", "grade 9", "ninth-grade" are not grades. */
const SCHOOL_YEAR = /\b(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th))[\s-]+grade(?:rs?)?|grade[\s-]+(?:\d{1,2}|school))\b/gi;

/** Words that grade an essay or judge its quality. */
export const GRADE_WORDS: readonly RegExp[] = [
  /\bgrad(?:e|es|ed|ing)\b/i,
  /\bscor(?:e|es|ed|ing)\b/i,
  /\brat(?:ing|ings|ed)\b/i,
  /\b(?:strong|stronger|strongest|weak|weaker|weakest|weakness|weaknesses)\b/i,
  /\b(?:excellent|outstanding|mediocre|impressive|unimpressive|flawless|brilliant|amazing|terrible|awful)\b/i,
  /\b(?:good|great|bad|poor|fine|solid|best|worst|nice)\s+(?:essay|draft|writing|piece|job|work|start)\b/i,
  /\b(?:overdone|over-done|trite|hackneyed)\b|\bclich(?:e|é)(?:s|d)?(?![\p{L}])/iu,
  /\b\d+(?:\.\d+)?\s*(?:\/|out of)\s*\d+\b/i,
  /(?<![\p{L}])[A-F][+-](?![\p{L}])/u,
  /\b(?:an?|the)\s+[A-F]\s+(?:essay|draft|paper)\b/,
];

/**
 * Predictions about admission: a percentage, chance, odds, and admit/accept/reject in a predicting sense ("get
 * accepted", "admit you", "acceptance rate", "help you get in", "colleges will love"). "You admit you were scared" and
 * "accepting help" are not predictions and pass.
 */
export const PREDICTION_WORDS: readonly RegExp[] = [
  /%|\bpercent(?:age)?\b/i,
  /\bchances?\b/i,
  /\bodds\b/i,
  /\b(?:be|being|been|is|are|was|were|get|gets|got|getting)\s+(?:you\s+)?(?:accepted|admitted|rejected|denied|waitlisted|wait-listed|deferred)\b/i,
  /\b(?:accept|admit|reject|deny|waitlist|defer)s?\s+(?:you|students like you|applicants like you|this applicant)\b(?!\s+(?:were|was|are|had|have|did|do|felt|feel|didn't|don't|weren't|wanted|thought|knew|could|can|need|needed|still)\b)/i,
  /\b(?:acceptance|admission|admissions|admit)\s+(?:rates?|letters?|odds|decisions?|offers?)\b/i,
  /\ban\s+admit\b/i,
  /\b(?:help|helps|helped|helping)\s+(?:you\s+)?get\s+in\b/i,
  /\bget(?:s|ting)?\s+(?:you\s+)?in(?:to)?\s*(?:[.!?,;]|$)/i,
  /\b(?:got|get|gets|getting)\s+(?:you\s+)?into\s+(?:college|the college|this college|school|[A-Z])/,
  /\b(?:colleges?|admissions?(?:\s+(?:officers?|readers?|committees?|offices?))?|readers?|committees?)\s+(?:will|would|won't|wouldn't)\s+(?:love|hate|dislike|reject|accept|admit|be impressed|favor)\b/i,
  /\b(?:help|hurt|boost|improve|lower|raise|cost)s?\s+(?:you(?:r)?\s+)?(?:your\s+)?(?:application|admission|odds|candidacy|shot)\b/i,
  /\bcosts?\s+(?:you\s+)?admission\b/i,
];

/**
 * Whether a field grades: a match of GRADE_WORDS outside a school year ("ninth grade"), unless every word of the match
 * is the prompt's own ("Describe a weakness" lets a note say "weakness").
 */
export function hasGradeWord(text: string, promptWords: ReadonlySet<string> = new Set()): boolean {
  const t = text.replace(SCHOOL_YEAR, " ");
  return GRADE_WORDS.some((re) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    return [...t.matchAll(g)].some((m) => {
      const w = wordsOf(m[0]);
      return w.length === 0 || !w.every((x) => promptWords.has(x));
    });
  });
}
export function hasPrediction(text: string): boolean {
  return PREDICTION_WORDS.some((re) => re.test(text));
}

/* ------------------------------------------------------------------ */
/* Care and prose (rules 5, 6)                                         */
/* ------------------------------------------------------------------ */

/** Verbs that open an instruction ("Remove the name.", "Don't share this."). */
export const INSTRUCTION_VERBS: readonly string[] = [
  "add", "avoid", "change", "consider", "cut", "delete", "describe", "disclose", "don't", "drop", "explain", "include", "keep", "leave",
  "make", "mention", "move", "never", "omit", "remove", "rephrase", "replace", "reveal", "rewrite", "share", "skip", "stop", "take",
  "talk", "tell", "trim", "use", "withhold", "write",
];
const INSTRUCTION_PHRASES = /\b(?:you should|you must|you need to|you have to|you ought to|make sure|be sure to|do not|i recommend|i suggest|it's best to|it is best to|it would be best)\b/i;

function sentencesOf(text: string): string[] {
  return text
    .replace(QUOTED, "Q")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whether a field gives an instruction: a sentence opening on an instruction verb, or "you should", "make sure". */
export function givesInstruction(text: string): boolean {
  if (INSTRUCTION_PHRASES.test(text)) return true;
  return sentencesOf(text).some((s) => {
    const first = wordsOf(s)[0];
    if (!first) return false;
    if (first === "do" && /^do\s+not\b/i.test(s)) return true;
    return INSTRUCTION_VERBS.includes(first) && !s.trim().endsWith("?");
  });
}

/** Phrases that offer the student wording. */
export const PROSE_PATTERNS: readonly RegExp[] = [
  /\b(?:try|consider)\s+(?:writing|saying|phrasing|wording|starting with|opening with|ending with|something like|replacing|changing it to|a line like)\b/i,
  /\byou\s+(?:could|might|can|may)\s+(?:write|say|open with|start with|end with|replace|rephrase|reword|change it to)\b/i,
  /\b(?:rewrite|rephrase|reword)\s+(?:it|this|that|the|your|as|to)\b/i,
  /\btry\s*[:,]?\s*["“‘']/i,
  /\b(?:instead|replace it with|change it to)\s*[:,]?\s*["“‘']/i,
  /\bsomething\s+(?:like|along the lines of)\b/i,
  /\b(?:replace|swap)\s+(?:it|this|that|the [\p{L} ]+?)\s+(?:with|for)\b/iu,
  /\bchange\s+(?:it|this|that)\s+to\b/i,
  /\b(?:here's|here is)\s+(?:a|one|an)\s+(?:version|way|rewrite|example|option)\b/i,
  /\b(?:a|one)\s+(?:stronger|better|tighter|cleaner|clearer|punchier)\s+(?:version|sentence|opening|ending|line|phrasing)\b/i,
];

/** A quoted passage this long that isn't the draft's or the prompt's own words reads as wording offered. */
export const PROSE_QUOTE_MIN_WORDS = 4;

/** Whether a quoted passage is the draft's or the prompt's own words (`ownWords` is " words | words ", space-padded). */
const isOwnQuote = (q: string, ownWords: string) => {
  const w = wordsOf(q);
  return w.length > 0 && ownWords.includes(` ${w.join(" ")} `);
};

function proposesProse(text: string, ownWords: string): boolean {
  if (PROSE_PATTERNS.some((re) => re.test(text))) return true;
  return quotedPassages(text).some((q) => wordsOf(q).length >= PROSE_QUOTE_MIN_WORDS && !isOwnQuote(q, ownWords));
}

/** A field with the draft's and the prompt's own quoted words taken out (quoting "strong" back is not grading). */
function withoutOwnQuotes(text: string, ownWords: string): string {
  return text.replace(QUOTED, (m) => (isOwnQuote(m.slice(1, -1), ownWords) ? "Q" : m));
}

/* ------------------------------------------------------------------ */
/* Spans (rule 7)                                                      */
/* ------------------------------------------------------------------ */

const loose = (s: string) => s.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").toLowerCase();

function findIn(paragraph: string, quote: string): { start: number; end: number } | null {
  const exact = paragraph.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  // Same length after loosening (quotes and case only; whitespace runs collapse, so fall back to a regex then).
  const lp = loose(paragraph);
  const lq = loose(quote).trim();
  if (!lq) return null;
  if (lp.length === paragraph.length) {
    const i = lp.indexOf(lq);
    if (i >= 0) return { start: i, end: i + lq.length };
  }
  const pattern = lq
    .split(" ")
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['\u2018\u2019]").replace(/"/g, '["\u201c\u201d]'))
    .join("\\s+");
  const m = new RegExp(pattern, "i").exec(paragraph);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/**
 * The span a note points at: its quote found in its paragraph (or, when the paragraph number is off, in the first
 * paragraph holding it); the whole paragraph when only the number is given; the whole draft when neither is. Null
 * `span` with `ok: false` when the quote isn't in the draft.
 */
export function resolveSpan(paragraphs: readonly string[], paragraph: number | null, quote: string | null): { ok: true; span: NoteSpan | null } | { ok: false } {
  const q = typeof quote === "string" ? quote.trim() : "";
  const p = typeof paragraph === "number" && Number.isInteger(paragraph) ? paragraph : null;
  if (!q) {
    if (p === null) return { ok: true, span: null };
    const text = paragraphs[p];
    return text === undefined ? { ok: false } : { ok: true, span: { paragraph: p, start: 0, end: text.length } };
  }
  const order = p !== null && paragraphs[p] !== undefined ? [p, ...paragraphs.map((_, i) => i).filter((i) => i !== p)] : paragraphs.map((_, i) => i);
  for (const i of order) {
    const at = findIn(paragraphs[i], q);
    if (at && at.end > at.start) return { ok: true, span: { paragraph: i, ...at } };
  }
  return { ok: false };
}

/* ------------------------------------------------------------------ */
/* The guard                                                           */
/* ------------------------------------------------------------------ */

const FIELD_MAX = 600;
const str = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);

/** One note checked: the note as stored, or the first rule it broke. */
export interface CheckContext {
  paragraphs: readonly string[];
  draftGrams: ReadonlySet<string>;
  ownWords: string;
  promptWords: ReadonlySet<string>;
  allowedSources: ReadonlySet<string> | null;
}

export function checkNote(raw: unknown, ctx: CheckContext): { ok: true; note: GuardedNote } | { ok: false; reason: DropReason } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "shape" };
  const r = raw as Record<string, unknown>;
  if (!isNoteCategory(r.category)) return { ok: false, reason: "category" };
  const category = r.category;
  const observation = str(r.observation);
  const why = str(r.why);
  const ask = str(r.ask);
  if (!observation || !why || !ask || observation.length > FIELD_MAX || why.length > FIELD_MAX || ask.length > FIELD_MAX) return { ok: false, reason: "shape" };
  const fixRaw = str(r.fix);
  const fix = fixRaw ? fixRaw : null;
  const sourceRaw = str(r.source);

  // 1. The fix: mechanics only, at most eight words.
  if (fix !== null && (category !== "mechanics" || fix.split(/\s+/).filter(Boolean).length > FIX_MAX_WORDS)) return { ok: false, reason: "fix" };

  const fields = [observation, why, ask];
  // 2. No run of more than eight of the draft's words in a row.
  if (fields.some((f) => sharesRunWith(f, ctx.draftGrams))) return { ok: false, reason: "quote_run" };
  // 3. No grade words, no predictions.
  const all = (fix ? [...fields, fix] : fields).map((f) => withoutOwnQuotes(f, ctx.ownWords));
  if (all.some((f) => hasGradeWord(f, ctx.promptWords))) return { ok: false, reason: "grade_word" };
  if (all.some(hasPrediction)) return { ok: false, reason: "prediction" };
  // 4. One or two sentences each.
  if (fields.some((f) => sentenceCount(f) < 1 || sentenceCount(f) > MAX_SENTENCES)) return { ok: false, reason: "sentences" };
  // 5. Care: a question, never an instruction.
  if (category === "care") {
    if (!ask.includes("?")) return { ok: false, reason: "care_question" };
    if (fields.some(givesInstruction)) return { ok: false, reason: "care_instruction" };
  }
  // 6. No wording offered.
  if (fields.some((f) => proposesProse(f, ctx.ownWords))) return { ok: false, reason: "prose" };
  // 7. The span is in the draft.
  const span = resolveSpan(ctx.paragraphs, typeof r.paragraph === "number" ? r.paragraph : null, str(r.quote));
  if (!span.ok) return { ok: false, reason: "span" };

  const source = sourceRaw && /^https?:\/\//.test(sourceRaw) && (!ctx.allowedSources || ctx.allowedSources.has(sourceRaw)) ? sourceRaw : null;
  return { ok: true, note: { category, span: span.span, observation, why, source, ask, fix } };
}

/**
 * The guard one note at a time, for a streamed answer (./review-stream.ts): `check` each note as its JSON object
 * completes; the first MAX_NOTES that pass are kept, in the model's order, and the rest are dropped with their reason.
 */
export interface NoteGuard {
  check(item: unknown): { ok: true; note: GuardedNote } | { ok: false; dropped: Dropped };
  readonly kept: readonly GuardedNote[];
  readonly dropped: readonly Dropped[];
}

export function noteGuard(draft: string, opts: GuardOptions = {}): NoteGuard {
  const paragraphs = paragraphsOf(draft);
  const draftWords = wordsOf(draft);
  const promptWords = wordsOf(opts.promptText ?? "");
  const ctx: CheckContext = {
    paragraphs,
    draftGrams: grams(draftWords, QUOTE_RUN_MAX + 1),
    ownWords: ` ${draftWords.join(" ")} | ${promptWords.join(" ")} `,
    promptWords: new Set(promptWords),
    allowedSources: opts.allowedSources ?? null,
  };
  const kept: GuardedNote[] = [];
  const dropped: Dropped[] = [];
  return {
    kept,
    dropped,
    check(item) {
      const category = typeof item === "object" && item !== null && isNoteCategory((item as { category?: unknown }).category) ? (item as { category: string }).category : "unknown";
      const checked = checkNote(item, ctx);
      if (checked.ok && kept.length < MAX_NOTES) {
        kept.push(checked.note);
        return { ok: true, note: checked.note };
      }
      const d: Dropped = { category, reason: checked.ok ? "over_limit" : checked.reason };
      dropped.push(d);
      return { ok: false, dropped: d };
    },
  };
}

/** Every note of an answer checked; the passing ones (at most MAX_NOTES, in the model's order) and the reasons for the rest. */
export function guardNotes(raw: unknown, draft: string, opts: GuardOptions = {}): GuardResult {
  const guard = noteGuard(draft, opts);
  for (const item of Array.isArray(raw) ? raw : []) guard.check(item);
  const kept = [...guard.kept];
  const dropped = [...guard.dropped];
  return { kept, dropped };
}

/** The order the notes list shows: mechanics first, then the rest in draft order (whole-draft notes after their category's spans). */
export function orderNotes<T extends { category: NoteCategory; span: NoteSpan | null }>(notes: readonly T[]): T[] {
  const pos = (n: T) => (n.span ? n.span.paragraph * 1e6 + n.span.start : Number.MAX_SAFE_INTEGER);
  return [...notes].sort((a, b) => {
    const ma = a.category === "mechanics" ? 0 : 1;
    const mb = b.category === "mechanics" ? 0 : 1;
    if (ma !== mb) return ma - mb;
    const d = pos(a) - pos(b);
    return d !== 0 ? d : NOTE_CATEGORIES.indexOf(a.category) - NOTE_CATEGORIES.indexOf(b.category);
  });
}
