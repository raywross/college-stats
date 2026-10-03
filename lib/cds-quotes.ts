/**
 * Quotes built by code from the numbered layout lines a model cites (specs/college-reported-round-3.md, Decision 4):
 * the model answers `{ v, lines: [412] }` and the quote is those lines' text, verbatim, so a quote is always real text
 * from the document. Pure module, no imports.
 *
 * Minimal version from the models track; the readers track may provide a fuller one (same name and contract).
 */

/** One numbered line of a document's layout text. */
export interface NumberedLine {
  /** The line id the model cites (1-based, unique within the document). */
  id: number;
  /** 1-based PDF page (1 for a sheet or an HTML page). */
  page: number;
  text: string;
}

/** Quotes are capped at this many characters (ItemResult.quote). */
export const QUOTE_MAX_CHARS = 160;

/**
 * The cited lines' text, in the order cited, joined with " / ", whitespace collapsed, capped at QUOTE_MAX_CHARS (an
 * ellipsis marks a cut). null when no cited id is a line of the document (a check fails such an item; it is never
 * given an invented quote).
 */
export function quoteFromLines(lines: readonly NumberedLine[] | ReadonlyMap<number, NumberedLine>, ids: readonly number[]): string | null {
  const byId = lines instanceof Map ? (lines as ReadonlyMap<number, NumberedLine>) : new Map((lines as readonly NumberedLine[]).map((l) => [l.id, l]));
  const parts: string[] = [];
  for (const id of ids) {
    const line = byId.get(id);
    if (!line) continue;
    const text = line.text.replace(/\s+/g, " ").trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  if (!parts.length) return null;
  const quote = parts.join(" / ");
  return quote.length <= QUOTE_MAX_CHARS ? quote : `${quote.slice(0, QUOTE_MAX_CHARS - 1).trimEnd()}…`;
}
