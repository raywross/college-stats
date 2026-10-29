/**
 * Essay text normalization (specs/product/essays/workspace.md "The round trip": "Windows line endings, non-breaking
 * spaces, and Word's smart punctuation are left in the text but counted as the forms count them").
 *
 * Two jobs, kept apart so the student's own characters survive:
 * - `normalizeText` is what the workspace stores from a paste or an import: one kind of line ending (`\n`), no byte
 *   order mark, no zero-width characters. Smart quotes, dashes, and non-breaking spaces are left exactly as typed.
 * - `normalizeForCount` is what the count reads (lib/essays/count.ts): the stored text with every kind of space a form
 *   treats as a space turned into one, so "650 of 650" here is 650 in the form.
 *
 * Pure; safe in server code, client components, and tests.
 */

/** Spaces a word processor writes that a form reads as an ordinary space. */
const SPACE_LIKE = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;
/** Characters with no width that a paste carries along: zero-width space, joiners, the byte order mark, soft hyphen. */
const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060\ufeff\u00ad]/g;

/** Line endings to `\n` (Windows `\r\n`, old Mac `\r`, Unicode line and paragraph separators). */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n");
}

/** The text as the workspace keeps it: line endings unified, invisible characters dropped, everything else as typed. */
export function normalizeText(text: string): string {
  return normalizeLineEndings(text).replace(ZERO_WIDTH, "");
}

/** The text as a form counts it: `normalizeText`, then every space-like character as a plain space. */
export function normalizeForCount(text: string): string {
  return normalizeText(text).replace(SPACE_LIKE, " ");
}

/** The draft's paragraphs (blank lines and single line breaks both end one), for comment anchors. */
export function paragraphsOf(text: string): string[] {
  return normalizeText(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * A selection in the field (character offsets into `text`) as a comment anchor: the paragraph it starts in (0-based,
 * as `paragraphsOf` numbers them) and the span's offsets inside that trimmed paragraph, cut at the paragraph's end.
 * Null for an empty selection or one in a blank line.
 */
export function anchorFor(text: string, selStart: number, selEnd: number): { paragraph: number; start: number; end: number } | null {
  if (selEnd <= selStart) return null;
  const norm = normalizeText(text);
  let pos = 0;
  let paragraph = -1;
  for (const line of norm.split("\n")) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos = lineEnd + 1;
    const lead = line.length - line.trimStart().length;
    const body = line.trim();
    if (body === "") continue;
    paragraph++;
    if (selStart > lineEnd) continue;
    const from = Math.max(0, selStart - lineStart - lead);
    const to = Math.min(body.length, Math.min(selEnd, lineEnd) - lineStart - lead);
    return to > from ? { paragraph, start: from, end: to } : null;
  }
  return null;
}

/** The words an anchor points at in `text`, or null when the draft changed under it. */
export function anchoredText(text: string, anchor: { paragraph: number; start: number; end: number }): string | null {
  const p = paragraphsOf(text)[anchor.paragraph];
  if (p === undefined || anchor.end > p.length) return null;
  return p.slice(anchor.start, anchor.end);
}
