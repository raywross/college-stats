/**
 * STUB written by U2 (the console page) because U1's module had not landed on feature/essays-hand-read when U2 needed
 * it. Same signatures as the brief's contract; the lead replaces this file with U1's at merge.
 *
 * A hand-read essay record (specs/product/essays/sources.md "The hand read"): the type the console builds, its checks,
 * the pasted-text splitter, the file's stable JSON, and the platform homepages a confirmed block cites. Pure, no Node
 * imports, so the admin form can run it in the browser before any call.
 */
import type { EssayFormKind, EssayPrompt } from "../types.ts";

export type FormKind = EssayFormKind;

/** Mirrors scripts/lib/essay-prompts/store.mts `ConfirmedRecord`. */
export interface ConfirmedRecord {
  unit_id: string;
  name: string;
  cycle: string;
  status: "published" | "none";
  confidence: "confirmed";
  source: "form-by-hand";
  form: FormKind;
  read_on: string;
  reader: string;
  prompts: EssayPrompt[];
  choose?: { n: number; of: number; quote: string };
  note?: string;
}

const PROMPT_CHARS = { min: 10, max: 1500 } as const;
const LIMIT_RANGE = { words: { min: 25, max: 2000 }, characters: { min: 100, max: 10_000 } } as const;
const FORMS: readonly FormKind[] = ["common_app", "coalition", "own", "apply_texas", "uc"];
const KINDS: readonly EssayPrompt["kind"][] = ["essay", "short_answer", "why_us", "program", "activity", "optional", "other"];

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Every problem with a hand-read record (empty when it passes). Prompt problems start "prompt {n}:". */
export function validateConfirmed(r: ConfirmedRecord): string[] {
  const out: string[] = [];
  if (!/^\d{1,12}$/.test(r.unit_id ?? "")) out.push("the college's unit id isn't a number");
  if (!r.name?.trim()) out.push("no college name");
  const m = /^(20\d\d)-(\d\d)$/.exec(r.cycle ?? "");
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) out.push(`cycle ${JSON.stringify(r.cycle)} isn't a cycle like 2026-27`);
  if (r.status !== "published" && r.status !== "none") out.push("status must be published or none");
  if (r.confidence !== "confirmed") out.push("confidence must be confirmed");
  if (r.source !== "form-by-hand") out.push("source must be form-by-hand");
  if (!FORMS.includes(r.form)) out.push(`form ${JSON.stringify(r.form)} isn't one of ${FORMS.join(", ")}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.read_on ?? "") || Number.isNaN(Date.parse(r.read_on))) out.push("the read-on date isn't a date");
  if (!/^[A-Za-z]{1,4}$/.test(r.reader ?? "")) out.push("the reader's initials must be 1 to 4 letters");
  const prompts = Array.isArray(r.prompts) ? r.prompts : [];
  if (r.status === "published" && prompts.length === 0) out.push("the form asks questions, but none are entered");
  if (r.status === "none" && prompts.length) out.push(`no college questions, but ${prompts.length} entered`);
  if (r.status === "none" && r.choose) out.push("a choice group needs questions");
  const seen = new Set<string>();
  prompts.forEach((p, i) => {
    const where = `prompt ${i + 1}`;
    const text = p.text?.trim() ?? "";
    if (p.id !== `${r.unit_id}:${r.cycle}:${i + 1}`) out.push(`${where}: id ${p.id} isn't ${r.unit_id}:${r.cycle}:${i + 1}`);
    if (text.length < PROMPT_CHARS.min || text.length > PROMPT_CHARS.max) out.push(`${where}: the question is ${text.length} characters (${PROMPT_CHARS.min} to ${PROMPT_CHARS.max} allowed)`);
    if (p.quote !== p.text) out.push(`${where}: the quote must be the question's own text`);
    if (!KINDS.includes(p.kind)) out.push(`${where}: kind ${JSON.stringify(p.kind)} isn't one of ${KINDS.join(", ")}`);
    if (p.limit) {
      const range = LIMIT_RANGE[p.limit.kind];
      if (!range) out.push(`${where}: the limit must be in words or characters`);
      else {
        if (!Number.isInteger(p.limit.max) || p.limit.max < range.min || p.limit.max > range.max) out.push(`${where}: a limit of ${p.limit.max} ${p.limit.kind} is outside ${range.min} to ${range.max}`);
        if (p.limit.min !== undefined && (!Number.isInteger(p.limit.min) || p.limit.min < 1 || p.limit.min >= p.limit.max)) out.push(`${where}: the minimum ${p.limit.min} isn't a whole number below the maximum`);
      }
    }
    if (typeof p.required !== "boolean") out.push(`${where}: required must be yes or no`);
    if (typeof p.applies_to === "object") {
      if (!p.applies_to.program?.trim()) out.push(`${where}: applies to a program, but names none`);
    } else if (!["all", "transfer", "international"].includes(p.applies_to)) out.push(`${where}: applies_to ${JSON.stringify(p.applies_to)} isn't recognized`);
    if (p.kind === "program" && typeof p.applies_to !== "object") out.push(`${where}: a program question must name its program`);
    const key = norm(text);
    if (key && seen.has(key) && typeof p.applies_to === "string") out.push(`${where}: the same question twice`);
    seen.add(key);
  });
  if (r.choose) {
    const { n, of } = r.choose;
    const optional = prompts.filter((p) => !p.required).length;
    if (!Number.isInteger(n) || n < 1) out.push("choose: how many to answer must be a whole number of at least 1");
    else if (!Number.isInteger(of) || of <= n) out.push(`choose: ${n} of ${of} isn't a choice (there must be more questions to pick from than to answer)`);
    if (of !== optional) out.push(`choose: ${of} to pick from, but ${optional} ${optional === 1 ? "question is" : "questions are"} not required`);
    if (!r.choose.quote?.trim()) out.push("choose: no wording");
  }
  if (r.note !== undefined && r.note.length > 2000) out.push("the note is over 2,000 characters");
  return out;
}

/**
 * Pasted text as one question per paragraph: split on blank lines, each paragraph's lines joined, and a leading number
 * or bullet ("1.", "2)", "(3)", "-", "•", "*") stripped. Empty paragraphs are dropped.
 */
export function splitPastedPrompts(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/^(?:\(?\d{1,2}[.)]|[-–—•*·])\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

/** The record file's text: keys in a fixed order, two-space indent, a trailing newline (so a re-save diffs cleanly). */
export function recordJson(r: ConfirmedRecord): string {
  const prompts = r.prompts.map((p) => ({
    id: p.id,
    text: p.text,
    kind: p.kind,
    limit: p.limit ? { kind: p.limit.kind, max: p.limit.max, ...(p.limit.min !== undefined ? { min: p.limit.min } : {}) } : null,
    required: p.required,
    applies_to: typeof p.applies_to === "object" ? { program: p.applies_to.program } : p.applies_to,
    quote: p.quote,
  }));
  const ordered = {
    unit_id: r.unit_id,
    name: r.name,
    cycle: r.cycle,
    status: r.status,
    confidence: r.confidence,
    source: r.source,
    form: r.form,
    read_on: r.read_on,
    reader: r.reader,
    prompts,
    ...(r.choose ? { choose: { n: r.choose.n, of: r.choose.of, quote: r.choose.quote } } : {}),
    ...(r.note ? { note: r.note } : {}),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** The homepage a confirmed block cites for its form (the only Common App link its terms allow); null for a college's own form. */
export function platformHomepage(form: FormKind): string | null {
  switch (form) {
    case "common_app":
      return "https://www.commonapp.org";
    case "coalition":
      return "https://www.coalitionforcollegeaccess.org";
    case "apply_texas":
      return "https://www.applytexas.org";
    case "uc":
      return "https://admission.universityofcalifornia.edu";
    default:
      return null;
  }
}
