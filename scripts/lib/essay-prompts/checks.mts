/**
 * The checks a read must pass before its record is written as passing (specs/product/essays/prompts.md "Checks"); a
 * record with any problem is held under data/essay-prompts/held/ and listed, never merged. Pure.
 *
 * - The cycle: named on the page (its words found in the page's text) and not older than the open cycle (nor more
 *   than one cycle ahead, which points to a misread year). A page that names none gets the open cycle, marked
 *   `cycle_assumed` and listed in the PR for a look (most colleges' pages print no year); a record with neither a
 *   cycle quote nor that mark is held.
 * - `choose` ("answer four of the eight"): the prompts marked optional are the set to pick from, so `of` is their count
 *   and `n` is fewer; prompts marked required stand outside the set (Duke's one required essay beside its pick-some
 *   list); the sentence is on the page and says to choose.
 * - A `none` quote says there are no essays; a `refers_to_form` quote names the essay and the application it lives in.
 * - A prompt that is one of the platforms' own (the Common App's seven, reproduced on many colleges' pages) is not
 *   the college's prompt: the record is held.
 * - Each prompt: 10 to 1,500 characters, found verbatim in the page's text; its quote found verbatim too.
 * - A limit: a whole number from 25 to 2,000 words or 100 to 10,000 characters; a minimum under the maximum.
 * - `required` from the page's own word: false needs an optional word ("optional", "if you wish", "you may"); true is
 *   refused when the only word is an optional one.
 * - The kind read, not inferred: `why_us` only when the prompt asks why this college or program; `program` only with
 *   a named program in `applies_to` (and that name on the page).
 * - The status agrees with the prompts: published lists some; none and refers_to_form list none and quote the page.
 */
import type { EssayPrompt } from "../../../lib/types.ts";
import { cycleStart, openCycle } from "./cycle.mts";
import type { EssayRecord } from "./store.mts";

export const PROMPT_CHARS = { min: 10, max: 1500 } as const;
export const LIMIT_RANGE = { words: { min: 25, max: 2000 }, characters: { min: 100, max: 10_000 } } as const;

const OPTIONAL_WORD = /\boptional(ly)?\b|if you (wish|choose|would like|like)|\byou may\b|\bmay (choose|submit|also|wish)\b|\bencouraged\b|\bnot required\b|\bnot mandatory\b/i;
/** "choose four of the eight", "respond to 2 of the following", "select one from these topics": a pick-some list. */
export const CHOOSE_WORD = /\b(choose|select|pick|answer|respond to|complete|write|submit)\b[^.;]{0,60}?\b(\d+|one|two|three|four|five|six|seven|eight)\b[^.;]{0,40}?\b(of|from|among|out of)\b[^.;]{0,40}?\b(\d+|the following|these|them|those|the (prompts|questions|topics|options|essays)|(prompts|questions|topics|options|essays)( below| listed)?)\b/i;
const REQUIRED_WORD =/\brequired\b|\bmust\b|\ball (first[- ]year )?applicants\b|\bplease (respond|answer|complete|write)\b|\brespond to (each|all|both|the following)\b|\banswer (each|all|both|the following)\b/i;
const WHY_US = /\bwhy\b[^?.]{0,120}\b(college|university|school|institute|program|major|community|campus|here|us|match|fit)\b|\b(draws?|attracts?|brings?|led) you to\b|\byou want to (attend|study|be)\b|\binterest(ed|s)? (you )?in (attending|studying at|our)\b|\bchoose to (attend|apply)\b|\bwhat about\b[^?]{0,80}\b(college|university|program|school)\b/i;

/** Text compared for "verbatim": curly quotes and dashes as their plain forms, runs of whitespace as one space. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    // Inline tags become spaces in the page's text ("<em>you</em>." → "you ."), so a space before punctuation is none.
    .replace(/ ([.,;:?!)\]'"])/g, "$1")
    .replace(/([(\[]) /g, "$1")
    .trim();
}

export interface CheckContext {
  /** ISO date of the run: the open cycle is the one this date falls in. */
  today: string;
  /** The page's text as the model read it; without it the verbatim checks are skipped (a re-check of a committed record). */
  pageText?: string;
  /** The platforms' own prompt texts (data/reference/platform-prompts.json): a college prompt equal to one is held. */
  platformTexts?: readonly string[];
}

/** "does not require a supplemental essay", "no additional essays", "no essays beyond the Common App's". */
const NONE_SENTENCE = /\b(no|not|never|without|doesn.t|does not|don.t|do not|aren.t|are not|isn.t|is not)\b[^.]{0,80}\b(essays?|supplement(al)?|writing|prompts?|short[\s-]answers?)\b|\b(essays?|supplement(al)?|writing|prompts?)\b[^.]{0,60}\b(not|no longer|aren.t|are not|isn.t|is not)\s+(required|needed|necessary|part of|accepted|considered)/i;
/** The essay and the application it lives in: "complete the essay on the Common Application", "the Cornell questions in the Common App". */
const REFERS_SENTENCE = /\b(essays?|prompts?|questions?|writing|supplement|short[\s-]answers?|personal statement)\b/i;
const FORM_WORD = /\b(common app(lication)?|coalition|apply ?texas|cal state apply|questbridge|scoir|the application|your application|our application|online application|application (form|portal|platform)|within the application|in the application|as part of (the|your) application)\b/i;

/** Problems with one prompt (empty when it passes). `where` prefixes each; `choose` when the page says to pick some. */
export function promptProblems(p: EssayPrompt, where: string, page: string | null, choose = false): string[] {
  const out: string[] = [];
  const text = p.text?.trim() ?? "";
  if (text.length < PROMPT_CHARS.min || text.length > PROMPT_CHARS.max) out.push(`${where}: prompt is ${text.length} characters (${PROMPT_CHARS.min} to ${PROMPT_CHARS.max} allowed)`);
  if (page !== null && text && !page.includes(normalizeForMatch(text))) out.push(`${where}: prompt text isn't on the page verbatim`);
  if (!p.quote?.trim()) out.push(`${where}: no quote`);
  else if (page !== null && !page.includes(normalizeForMatch(p.quote))) out.push(`${where}: quote isn't on the page verbatim`);
  if (p.limit) {
    const r = LIMIT_RANGE[p.limit.kind];
    if (!r) out.push(`${where}: limit kind ${JSON.stringify(p.limit.kind)} isn't words or characters`);
    else {
      if (!Number.isInteger(p.limit.max) || p.limit.max < r.min || p.limit.max > r.max) out.push(`${where}: limit ${p.limit.max} ${p.limit.kind} is outside ${r.min} to ${r.max}`);
      if (p.limit.min !== undefined && (!Number.isInteger(p.limit.min) || p.limit.min < 1 || p.limit.min >= p.limit.max)) out.push(`${where}: minimum ${p.limit.min} isn't a whole number below the maximum`);
    }
  }
  const words = `${p.quote ?? ""} ${text}`;
  // Under `choose`, the optional prompts are the set to pick from and need no optional word of their own; a required
  // one stands outside the set and keeps the usual rule.
  if (p.required === false && !choose && !OPTIONAL_WORD.test(words) && !CHOOSE_WORD.test(words)) out.push(`${where}: marked optional, but neither the prompt nor its quote says optional`);
  if (p.required === true && OPTIONAL_WORD.test(words) && !REQUIRED_WORD.test(words.replace(/\bnot (required|mandatory)\b/gi, ""))) out.push(`${where}: marked required, but the page's word is optional`);
  if (p.kind === "why_us" && !WHY_US.test(text)) out.push(`${where}: kind why_us, but the prompt doesn't ask why this college or program`);
  const program = typeof p.applies_to === "object" ? p.applies_to.program?.trim() : null;
  if (p.kind === "program" && !program) out.push(`${where}: kind program, but applies_to names no program`);
  if (typeof p.applies_to === "object") {
    if (!program) out.push(`${where}: applies_to names an empty program`);
    else if (page !== null && !page.toLowerCase().includes(normalizeForMatch(program).toLowerCase())) out.push(`${where}: program ${JSON.stringify(program)} isn't named on the page`);
  } else if (!["all", "transfer", "international"].includes(p.applies_to)) out.push(`${where}: applies_to ${JSON.stringify(p.applies_to)} isn't all, transfer, international, or a program`);
  return out;
}

/** Every problem with a record (empty when it passes). */
export function checkRecord(r: EssayRecord, ctx: CheckContext): string[] {
  const out: string[] = [];
  const page = ctx.pageText === undefined ? null : normalizeForMatch(ctx.pageText);
  const start = cycleStart(r.cycle);
  const open = cycleStart(openCycle(ctx.today))!;
  if (start === null) out.push(r.cycle_quote ? `the page's cycle words ${JSON.stringify(r.cycle_quote)} name no cycle` : "the page names no cycle");
  else if (start < open) out.push(`cycle ${r.cycle} is older than the open cycle ${openCycle(ctx.today)}`);
  else if (start > open + 1) out.push(`cycle ${r.cycle} is more than one cycle ahead of ${openCycle(ctx.today)}`);
  if (r.cycle_assumed) {
    if (r.cycle_quote) out.push("cycle_assumed is set, but the page names a cycle");
    if (start !== null && start !== open) out.push(`an assumed cycle must be the open one, ${openCycle(ctx.today)}, not ${r.cycle}`);
  } else if (start !== null && !r.cycle_quote) out.push("the page names no cycle (the reader marks such a record cycle_assumed)");
  if (r.cycle_quote && page !== null && !page.includes(normalizeForMatch(r.cycle_quote))) out.push("the cycle's words aren't on the page verbatim");
  if (r.choose) {
    const { n, of, quote } = r.choose;
    const optional = r.prompts.filter((p) => !p.required).length;
    if (r.status !== "published") out.push(`choose is set, but status is ${r.status}`);
    if (!Number.isInteger(n) || n < 1) out.push(`choose: ${JSON.stringify(n)} isn't a whole number of prompts to answer`);
    if (!Number.isInteger(of) || of <= n) out.push(`choose: ${n} of ${JSON.stringify(of)} isn't a choice (of must be a whole number above n)`);
    if (r.status === "published" && of !== optional) out.push(`choose says ${of} prompts to pick from, but ${optional} ${optional === 1 ? "is" : "are"} marked optional (the set is the optional prompts; required ones stand outside it)`);
    if (!quote?.trim()) out.push("choose: no quote");
    else if (page !== null && !page.includes(normalizeForMatch(quote))) out.push("choose: the quote isn't on the page verbatim");
    else if (!CHOOSE_WORD.test(quote) && !/\b(choose|select|pick|one of|any of|\d+|one|two|three|four|five|six|seven|eight)\b/i.test(quote)) out.push("choose: the quote doesn't say to choose some of the prompts");
  }
  if (r.status !== "published" && r.status_quote?.trim()) {
    const q = r.status_quote;
    if (r.status === "none" && !NONE_SENTENCE.test(q)) out.push("status none, but the quoted sentence doesn't say there are no essays");
    if (r.status === "refers_to_form" && !(REFERS_SENTENCE.test(q) && FORM_WORD.test(q))) out.push("status refers_to_form, but the quoted sentence doesn't name the essay and the application it is part of");
  }
  if (ctx.platformTexts?.length && r.prompts.length) {
    const platform = new Set(ctx.platformTexts.map((t) => normalizeForMatch(t).toLowerCase()));
    r.prompts.forEach((p, i) => {
      if (platform.has(normalizeForMatch(p.text ?? "").toLowerCase())) out.push(`prompt ${i + 1}: this is one of the application platform's own prompts, reproduced on the page, not the college's`);
    });
  }
  if (!/^https?:\/\//.test(r.source_url)) out.push(`source_url ${JSON.stringify(r.source_url)} isn't a web address`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.retrieved)) out.push(`retrieved ${JSON.stringify(r.retrieved)} isn't an ISO date`);
  if (r.status === "published" && !r.prompts.length) out.push("status published, but no prompts");
  if (r.status !== "published") {
    if (r.prompts.length) out.push(`status ${r.status}, but ${r.prompts.length} prompt(s)`);
    if (!r.status_quote?.trim()) out.push(`status ${r.status} without the page's sentence that says so`);
    else if (page !== null && !page.includes(normalizeForMatch(r.status_quote))) out.push("the status sentence isn't on the page verbatim");
  }
  const seen = new Set<string>();
  r.prompts.forEach((p, i) => {
    const where = `prompt ${i + 1}`;
    if (p.id !== `${r.unit_id}:${r.cycle}:${i + 1}`) out.push(`${where}: id ${p.id} isn't ${r.unit_id}:${r.cycle}:${i + 1}`);
    const key = normalizeForMatch(p.text ?? "");
    if (seen.has(key) && typeof p.applies_to === "string") out.push(`${where}: the same prompt twice`);
    seen.add(key);
    out.push(...promptProblems(p, where, page, !!r.choose));
  });
  return out;
}
