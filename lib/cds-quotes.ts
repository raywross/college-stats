/**
 * Line-cited quotes (specs/college-reported-round-3.md, Decision 4): a model answers `{ v, lines: [412] }`, and code
 * builds the quote from those numbered layout lines, verbatim. A quote is therefore always real text from the
 * document; the check is that the number appears on its cited line(s), and a line id outside the document fails.
 *
 * Pure module (type-only imports), shared by the readers (scripts/lib/college-reported/layout.mts) and the checks.
 *
 * Lines are the numbered layout lines of one document (`LaidOutDocument.lines`): PDF rows carry `@x` position tags
 * ("@78 Rigor of secondary school record | @450 X"), older-Excel rows carry cell tags ("@B101 Rigor … | @C101 x");
 * quotes and number checks strip the tags first.
 */
import type { ItemFailure } from "./cds-sections";

/** A numbered layout line: 1-based across the document's body (definitions dropped). */
export type LineId = number;

/** Quotes are at most this long (the records validator enforces the same limit). */
export const QUOTE_MAX = 160;

/** Drops the layout tags at the start of each cell: "@450 X" → "X", "@C101 x" → "x", an empty "@D101" → "". */
export function stripLayoutTags(line: string): string {
  return line
    .split(" | ")
    .map((cell) => cell.replace(/^\s*@[A-Z]{0,3}\d+(?:\s|$)/, "").trim())
    .join(" | ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Joins digits a printer split inside one cell ("$3 4 , 604" → "$34,604", "$ 8 , 318" → "$8,318", "$5 66" → "$566")
 * and leaves everything else alone. Only money cells, or cells of digits whose thousands comma has a space beside it,
 * are joined: two close values ("11/1 12/15", "362 ##") are not one number.
 */
export function joinSplitDigits(cell: string): string {
  const t = cell.trim();
  const money = /^\$\s?\d[\d\s,.]*$/.test(t);
  const spacedComma = /^\d[\d\s,.]*$/.test(t) && /\d\s+,\s*\d|\d,\s+\d{3}/.test(t);
  return money || spacedComma ? t.replace(/\s+/g, "") : cell;
}

/** A line as text: tags stripped and split digits joined in every cell. */
export function lineText(line: string): string {
  return stripLayoutTags(line)
    .split(" | ")
    .map(joinSplitDigits)
    .join(" | ");
}

/** The cited lines' raw text, or null when the list is empty or any id isn't a line of the document. */
export function citedLines(lines: readonly string[], ids: readonly LineId[]): string[] | null {
  if (!ids.length) return null;
  const out: string[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 1 || id > lines.length) return null;
    out.push(lines[id - 1]);
  }
  return out;
}

/**
 * The verbatim quote (≤ 160 characters) for a value cited on `ids`: the lines' text joined with " / ". When it is too
 * long, the window keeps `around` (the printed value) in view; without it, the end of the quote (where values sit,
 * right of their labels) is kept. Null when a line id is outside the document.
 */
export function quoteFromLines(lines: readonly string[], ids: readonly LineId[], around?: string | number | null): string | null {
  const cited = citedLines(lines, ids);
  if (!cited) return null;
  const text = cited.map(lineText).join(" / ").replace(/\s+/g, " ").trim();
  if (text.length <= QUOTE_MAX) return text;
  const room = QUOTE_MAX - 2; // two ellipses at most
  let at = text.length;
  if (around !== undefined && around !== null) {
    const needles = typeof around === "number" ? numberForms(around) : [String(around)];
    const hits = needles.map((n) => text.indexOf(n)).filter((i) => i >= 0);
    if (hits.length) at = Math.min(...hits) + Math.ceil(room / 2);
  }
  const end = Math.min(text.length, Math.max(room, at));
  const start = Math.max(0, end - room);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Ways a number may be printed, for locating it in a quote: "37270", "37,270", "0.274", "27.4". */
function numberForms(v: number): string[] {
  const plain = String(v);
  return [plain, v.toLocaleString("en-US", { maximumFractionDigits: 10 }), String(Math.round(v * 1e8) / 1e6)];
}

/** Every number printed on a line (tags stripped, split digits joined, thousands separators and "$", "%" allowed). */
export function numbersOn(line: string): number[] {
  const text = lineText(line);
  const out: number[] = [];
  // A number not glued to a letter (so "C11", "H2A", or "B3" item names aren't read as values).
  for (const m of text.matchAll(/(?<![A-Za-z\d.])-?\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![A-Za-z\d])/g)) {
    out.push(Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`));
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The value `v` appears on its cited line(s): as printed, with thousands separators or split digits, or, for a percent
 * item (`percent: true`, stored as a 0–1 share), as its percent (0.274 printed "27.4%", "27.4", or "0.274"). False when
 * a line id is outside the document.
 */
export function numberOnLines(v: number, lines: readonly string[], ids: readonly LineId[], opts: { percent?: boolean } = {}): boolean {
  const cited = citedLines(lines, ids);
  if (!cited) return false;
  const targets = opts.percent ? [v, v * 100] : [v];
  return cited.some((line) => numbersOn(line).some((n) => targets.some((t) => close(n, t))));
}

/** One model answer as the structured output returns it. A `quote` the model wrote is never used. */
export interface CitedAnswer {
  v: number | string | boolean | null;
  lines: LineId[];
  quote?: unknown;
}

/** Where a cited value is, and its quote, built by code from the document's lines. */
export interface Citation {
  line: LineId;
  lines?: LineId[];
  page?: number;
  quote: string;
}

/**
 * The citation for one model answer: first cited line, all cited lines when more than one, its page, and the quote
 * built from those lines (the answer's own `quote`, if any, is ignored). A numeric value must appear on its cited
 * line(s); otherwise, or when a line id is outside the document, the answer fails check `line-cite`.
 */
export function citeAnswer(
  answer: CitedAnswer,
  lines: readonly string[],
  pages: readonly number[] | null,
  opts: { percent?: boolean } = {}
): { citation: Citation } | { failure: ItemFailure } {
  const ids = [...new Set(answer.lines)];
  const quote = quoteFromLines(lines, ids, typeof answer.v === "number" ? answer.v : null);
  if (quote === null) {
    return { failure: { check: "line-cite", detail: `cited line(s) ${ids.join(", ") || "none"} aren't lines 1–${lines.length} of the document` } };
  }
  if (typeof answer.v === "number" && !numberOnLines(answer.v, lines, ids, opts)) {
    return { failure: { check: "line-cite", detail: `${answer.v} isn't on cited line(s) ${ids.join(", ")}` } };
  }
  const citation: Citation = { line: ids[0], quote };
  if (ids.length > 1) citation.lines = ids;
  const page = pages?.[ids[0] - 1];
  if (page !== undefined) citation.page = page;
  return { citation };
}

/* ------------------------------------------------------------------ */
/* Numbered-line form used by the extraction calls (llm.mts, batch.mts) */
/* ------------------------------------------------------------------ */

/** One numbered line of a document's layout text, with the page it came from (1 for a sheet or an HTML page). */
export interface NumberedLine {
  /** The line id the model cites (1-based, unique within the document). */
  id: LineId;
  page: number;
  text: string;
}

/** Alias kept for callers written against the models track's first version of this module. */
export const QUOTE_MAX_CHARS = QUOTE_MAX;

/**
 * `quoteFromLines` for numbered lines: the cited lines' text in the order cited, joined with " / ", layout tags
 * stripped, capped at QUOTE_MAX. null when no cited id is a line of the document, so an item never gets an invented
 * quote.
 */
export function quoteFromNumberedLines(lines: readonly NumberedLine[] | ReadonlyMap<number, NumberedLine>, ids: readonly LineId[]): string | null {
  const byId = lines instanceof Map ? (lines as ReadonlyMap<number, NumberedLine>) : new Map((lines as readonly NumberedLine[]).map((l) => [l.id, l]));
  const parts: string[] = [];
  for (const id of ids) {
    const line = byId.get(id);
    if (!line) continue;
    const text = lineText(line.text);
    if (text && !parts.includes(text)) parts.push(text);
  }
  if (!parts.length) return null;
  const quote = parts.join(" / ");
  return quote.length <= QUOTE_MAX ? quote : `${quote.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
}
