/**
 * A change's report as a list (specs/product/admin-redesign.md "Data": "a change's page shows its report as a list of
 * the counts and checks it contains, with the raw text under Details"). A run writes its report as markdown into the
 * change's summary (the college-reported run's old pull-request body, the essay run's summary): headings, two-column
 * tables of counts, bullet lines, wider tables of rows, and a few sentences. `reportLines()` reads that text into
 * lines the page renders as a list; anything it can't place stays in the raw text under Details.
 *
 * Pure: no server or browser APIs, so the page and tests/admin-report-words.test.mts share it.
 */

export type ReportLine =
  /** A section's heading ("Summary", "Circuit breaker"). */
  | { kind: "heading"; text: string }
  /** A count or a fact: "Colleges attempted: 12", "Cost: $1.20". */
  | { kind: "count"; label: string; value: string }
  /** A check and how it came out: ok true (passed), false (failed or stopped), null (said, not judged). */
  | { kind: "check"; label: string; ok: boolean | null; detail: string }
  /** One row of a wider table, as its header's words and the row's values. */
  | { kind: "row"; facts: { label: string; value: string }[] }
  /** Rows of a table left out of the list (they are in the raw text). */
  | { kind: "more"; count: number }
  /** A sentence that is none of the above. */
  | { kind: "note"; text: string };

export interface ReportOptions {
  /** The most rows of one wider table the list shows; the rest are counted in a "more" line. */
  maxRows?: number;
}

export const REPORT_MAX_ROWS = 20;

/** Markdown's marks off a piece of text: bold, italics, inline code's backticks, links (their words), escaped pipes. */
export function plainText(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,;:])/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\\|/g, "|")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text's first sentence (up to the first ". " or the end), for a check's detail. */
function firstSentence(s: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  return (m ? m[1] : s).trim();
}

function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split(/(?<!\\)\|/).map((c) => plainText(c));
}

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^[\s|:-]+$/.test(line) && line.includes("-");
const isRule = (line: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);

/** Words that say a check failed or a run stopped, and words that say it passed. */
const FAILED = /\b(tripped|failed|stopped|held|blocked)\b/i;
const NOT_FAILED = /\b(not tripped|no (failures|problems)|nothing (failed|held))\b/i;
const PASSED = /\b(passed|ok|not tripped|within)\b/i;

/** A heading that names checks: the lines under it read as checks. */
const CHECK_HEADING = /\b(checks?|circuit breaker|gate|guards?)\b/i;

function judge(text: string): boolean | null {
  if (NOT_FAILED.test(text)) return true;
  if (FAILED.test(text)) return false;
  if (PASSED.test(text)) return true;
  return null;
}

/** "**Tripped:** the share …" or "Label: value" → [label, value]; null when the line has no label. */
function labelled(text: string): [string, string] | null {
  const bold = /^\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(text.trim());
  if (bold) return [plainText(bold[1]).replace(/:$/, ""), plainText(bold[2])];
  const plain = plainText(text);
  const m = /^([A-Za-z][^:]{0,60}):\s+(.+)$/.exec(plain);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

/**
 * The report's lines, in order. Two-column tables and labelled bullets become counts; lines under a heading that names
 * checks, a blockquote ("> **Stopped early** …"), and "Tripped"/"Not tripped" sentences become checks; wider tables
 * become rows (at most `maxRows` each, then one "more" line); headings stay headings; any other sentence is a note. A
 * table's header row and divider and a horizontal rule are dropped. Empty or missing text gives no lines.
 */
export function reportLines(text: string | null | undefined, options: ReportOptions = {}): ReportLine[] {
  if (!text || !text.trim()) return [];
  const maxRows = options.maxRows ?? REPORT_MAX_ROWS;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReportLine[] = [];
  let underChecks = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || isRule(line)) continue;

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const text = plainText(heading[1]);
      underChecks = CHECK_HEADING.test(text);
      out.push({ kind: "heading", text });
      continue;
    }

    if (isTableLine(line)) {
      // The table: its header, its divider, its rows.
      const block: string[] = [];
      while (i < lines.length && isTableLine(lines[i].trim())) block.push(lines[i++].trim());
      i--;
      const header = cells(block[0]);
      const body = block.slice(1).filter((l) => !isDivider(l)).map(cells);
      const blankHeader = header.every((h) => h === "");
      const hasDivider = block.slice(1).some(isDivider);
      if (header.length === 2 && (blankHeader || !hasDivider)) {
        // A two-column table with no header words is a list of counts: | Colleges attempted | 12 |. With no divider
        // at all, its first line is a row too.
        for (const [label, value] of blankHeader ? body : [header, ...body]) {
          if (!label && !value) continue;
          if (underChecks) out.push({ kind: "check", label, ok: judge(`${label} ${value}`), detail: value });
          else out.push({ kind: "count", label, value });
        }
        continue;
      }
      const shown = body.slice(0, maxRows);
      for (const row of shown) out.push({ kind: "row", facts: header.map((label, k) => ({ label: label || `Column ${k + 1}`, value: row[k] ?? "" })).filter((f) => f.value !== "") });
      if (body.length > shown.length) out.push({ kind: "more", count: body.length - shown.length });
      continue;
    }

    const quote = /^>\s*(.*)$/.exec(line);
    if (quote) {
      const l = labelled(quote[1]);
      const text = plainText(quote[1]);
      out.push({ kind: "check", label: l ? l[0] : firstSentence(text), ok: judge(text), detail: l ? firstSentence(l[1]) : text });
      continue;
    }

    const bullet = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    const content = bullet ? bullet[1] : line;
    const box = /^\[( |x|X)\]\s+(.*)$/.exec(content);
    if (box) {
      out.push({ kind: "check", label: plainText(box[2]), ok: box[1] !== " ", detail: "" });
      continue;
    }
    const text = plainText(content);
    if (/^(not )?tripped\b/i.test(text) || /^\*\*(not )?tripped/i.test(content)) {
      out.push({ kind: "check", label: "Circuit breaker", ok: /^\**not tripped/i.test(content.replace(/\*/g, "")), detail: firstSentence(text) });
      continue;
    }
    const l = labelled(content);
    if (underChecks) {
      out.push({ kind: "check", label: l ? l[0] : firstSentence(text), ok: judge(text), detail: l ? l[1] : "" });
      continue;
    }
    if (bullet && l) {
      out.push({ kind: "count", label: l[0], value: l[1] });
      continue;
    }
    out.push({ kind: "note", text });
  }
  return out;
}

/** How many counts and checks the list holds (the page says "Nothing to list" when both are zero). */
export function reportTally(lines: readonly ReportLine[]): { counts: number; checks: number; failed: number } {
  let counts = 0;
  let checks = 0;
  let failed = 0;
  for (const l of lines) {
    if (l.kind === "count") counts++;
    if (l.kind === "check") {
      checks++;
      if (l.ok === false) failed++;
    }
  }
  return { counts, checks, failed };
}
