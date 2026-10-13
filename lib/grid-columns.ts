/**
 * Which column a C7 or C8A mark sits under, from a flattened CDS PDF's layout text (`pdftotext -layout`: one string
 * per printed line, characters at their horizontal positions). A model reading the same text often puts a mark under
 * the neighbouring column; this reads positions instead. Pure; `npm run check-grid-columns` feeds it and records the
 * result on each item (`ItemResult.column`), and the grid-column check holds what it couldn't place.
 *
 * Conservative by design: a row resolves only when it has exactly one mark (or exactly one level written out in
 * words) and the mark sits clearly nearer one heading than its neighbours. Anything else is left unresolved (held).
 */
import type { CdsCode } from "./cds-sections";

export const C7_HEADINGS = ["Very Important", "Important", "Considered", "Not Considered"] as const;
/** The C8A headings in column order, as the 2025–26 template's code table spells them (lib/test-policy.ts reads these). */
export const C8_HEADINGS = [
  "Required to be considered for admission",
  "Required for some",
  "Recommended",
  "Not required for admission, but considered if submitted",
  "Not considered for admission, even if submitted",
] as const;

const C7_ROWS: readonly [CdsCode, RegExp][] = [
  ["C.701", /rigou?r of (the )?secondary/i],
  ["C.702", /class rank/i],
  ["C.703", /academic gpa/i],
  ["C.704", /standardized test/i],
  ["C.705", /application essay/i],
  ["C.706", /recommendation/i],
  ["C.707", /^\s*interview/i],
  ["C.708", /extracurricular/i],
  ["C.709", /talent/i],
  ["C.710", /character/i],
  ["C.711", /first[- ]generation/i],
  ["C.712", /alumni/i],
  ["C.713", /geographical/i],
  ["C.714", /state residency/i],
  ["C.715", /religious/i],
  ["C.716", /volunteer/i],
  ["C.717", /work experience/i],
  ["C.718", /level of applicant/i],
];
const C8_ROWS: readonly [CdsCode, RegExp][] = [
  ["C.802", /SAT\s+or\s+ACT/i],
  ["C.803", /ACT\s+Only/i],
  ["C.804", /SAT\s+Only/i],
];

/** A mark: a lone X, check, box, or bullet (and the private-use glyphs Wingdings checks extract as). */
const MARK = /(?<=^|\s)(?:[xX✓✔✗☒☑■●•√]|[])(?=\s|$)/g;

export interface Column {
  heading: string;
  center: number;
}

/** The heading nearest x, when x is clearly closer to it than to either neighbour (within 40% of the gap). */
export function nearest(columns: readonly Column[], x: number): string | null {
  const sorted = [...columns].sort((a, b) => a.center - b.center);
  let best = -1;
  for (let i = 0; i < sorted.length; i++) if (best < 0 || Math.abs(sorted[i].center - x) < Math.abs(sorted[best].center - x)) best = i;
  if (best < 0) return null;
  const gaps = [best > 0 ? sorted[best].center - sorted[best - 1].center : Infinity, best < sorted.length - 1 ? sorted[best + 1].center - sorted[best].center : Infinity];
  const gap = Math.min(...gaps);
  return Math.abs(sorted[best].center - x) <= (gap === Infinity ? 12 : gap * 0.4) ? sorted[best].heading : null;
}

/** The one mark's position in `line` after `from`, or null when there are none or several. */
function oneMark(line: string, from: number): number | null {
  const marks = [...line.slice(from).matchAll(MARK)].map((m) => from + (m.index ?? 0));
  return marks.length === 1 ? marks[0] : null;
}

/** The C7 heading written out as words in `text` (a college that types levels instead of marking them), or null. */
function c7Words(text: string): string | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const found = new Set<string>();
  if (/very important/.test(t)) found.add("Very Important");
  if (/not considered/.test(t)) found.add("Not Considered");
  if (/(?<!very )important/.test(t.replace(/very important/g, ""))) found.add("Important");
  if (/(?<!not )considered/.test(t.replace(/not considered/g, ""))) found.add("Considered");
  return found.size === 1 ? [...found][0] : null;
}

/**
 * C7 column centers from a heading line ("Very Important   Important   Considered   Not Considered"), or null. When
 * "Not Considered" wraps around the line ("Not" above, "Considered" below), `around` (the lines just above and below)
 * supplies it: a "Not" or "Considered" to the right of the Considered column.
 */
export function c7Columns(line: string, around: readonly string[] = []): Column[] | null {
  const vi = line.search(/very\s+important/i);
  if (vi < 0) return null;
  const after = vi + "Very Important".length;
  const rest = line.slice(after);
  const imp = /\bimportant\b/i.exec(rest);
  const con = /(?<!not\s{1,12})\bconsidered\b/i.exec(rest);
  if (!imp || !con) return null;
  const at = (m: RegExpExecArray) => after + m.index + m[0].length / 2;
  const notOnLine = /\bnot(\s+considered)?\b/i.exec(rest);
  let notCenter = notOnLine ? at(notOnLine) : null;
  if (notCenter === null) {
    const right = at(con) + 6;
    for (const other of around) {
      for (const m of other.matchAll(/\bnot\b|\bconsidered\b/gi)) {
        const c = (m.index ?? 0) + m[0].length / 2;
        if (c > right && (notCenter === null || Math.abs(c - right) < Math.abs(notCenter - right))) notCenter = c;
      }
    }
  }
  if (notCenter === null) return null;
  const cols: Column[] = [
    { heading: "Very Important", center: vi + 7 },
    { heading: "Important", center: at(imp) },
    { heading: "Considered", center: at(con) },
    { heading: "Not Considered", center: notCenter },
  ];
  return cols.every((c, i) => i === 0 || c.center > cols[i - 1].center) ? cols : null;
}

/** C8A column centers from the heading block (the lines between "C8A" and the first test row), or null. */
export function c8Columns(block: readonly string[]): Column[] | null {
  const find = (re: RegExp, guard?: (line: string, i: number) => boolean): number | null => {
    for (const line of block) {
      for (const m of line.matchAll(new RegExp(re.source, "gi"))) {
        const i = m.index ?? 0;
        if (!guard || guard(line, i)) return i + m[0].length / 2;
      }
    }
    return null;
  };
  // Headings are found by their words, not their order: the 2025–26 form reads Required to be considered / Required for
  // some / Recommended / Not required … considered if submitted / Not considered; forms before 2023 read Require /
  // Recommend / Require for Some / Consider if Submitted / Not Used.
  const notBefore = (line: string, i: number) => !/not\s+$/i.test(line.slice(Math.max(0, i - 6), i));
  const required = find(/required to be/) ?? find(/\brequire\b(?!\s+for)/, notBefore);
  const some = find(/required? for(\s+some)?/, notBefore) ?? find(/\bsome\b/);
  const recommended = find(/recommend/);
  const considered = find(/not required/) ?? find(/consider(ed)? if/);
  const notConsidered =
    find(/not considered/) ?? find(/not used/) ?? (considered !== null ? find(/\bnot\b/, (l, i) => i > considered + 8 && !/^not\s+required/i.test(l.slice(i))) : null);
  // A page that cuts off the last column (Cal Poly Humboldt) still places marks under the other four; a mark out where
  // the fifth would be is too far from its neighbour to resolve.
  const found = [required, some, recommended, considered, notConsidered];
  const missing = found.filter((c) => c === null).length;
  if (missing > 1 || (missing === 1 && notConsidered !== null)) return null;
  const cols = found.flatMap((c, i) => (c === null ? [] : [{ heading: C8_HEADINGS[i], center: c }]));
  // Each heading its own column: distinct positions at least a few characters apart.
  const xs = cols.map((c) => c.center).sort((a, b) => a - b);
  return xs.every((x, i) => i === 0 || x - xs[i - 1] >= 5) ? cols : null;
}

/** Reads one grid's rows: per code, the heading its mark sits under, or null when it can't be placed. */
function readRows(
  lines: readonly string[],
  start: number,
  end: number,
  rows: readonly [CdsCode, RegExp][],
  columnsAt: (i: number) => Column[] | null,
  words?: (text: string) => string | null
): Map<CdsCode, string | null> {
  const out = new Map<CdsCode, string | null>();
  for (let i = start; i < end; i++) {
    const line = lines[i];
    for (const [code, re] of rows) {
      if (out.has(code)) continue;
      const m = re.exec(line);
      // A row's label starts its line; the same words inside a question ("…make use of SAT or ACT scores…") don't count.
      // Some forms repeat the item code on every row ("C8A SAT or ACT").
      if (!m || !/^(C7|C8A?)?$/i.test(line.slice(0, m.index).trim())) continue;
      const cols = columnsAt(i);
      const from = m.index + m[0].length;
      let heading: string | null = null;
      const x = oneMark(line, from);
      if (x !== null && cols) heading = nearest(cols, x);
      else if (x === null && words && words(line.slice(from))) heading = words(line.slice(from));
      else if (x === null && cols && ![...line.slice(from).matchAll(MARK)].length) {
        // The mark on a line by itself just below (Taylor's "SAT or ACT" row): the next non-blank line, with no row label
        // and nothing but one mark.
        let j = i + 1;
        while (j < i + 3 && !(lines[j] ?? "").trim()) j++;
        const next = lines[j] ?? "";
        // Empty boxes printed in every column (Alabama A&M's "տ"; ☐ □) may sit beside the one mark.
        if (!rows.some(([, r]) => r.test(next)) && /^[\sմյտ☐□]*\S[\sմյտ☐□]*$/u.test(next)) {
          const nx = oneMark(next, 0);
          if (nx !== null) heading = nearest(cols, nx);
        }
      }
      out.set(code, heading);
    }
  }
  return out;
}

/** Every C7 and C8A row this layout text places: code → heading, or null when the row was found but not placed. */
export function gridColumns(lines: readonly string[]): Map<CdsCode, string | null> {
  const out = new Map<CdsCode, string | null>();
  const c7 = lines.findIndex((l) => /^\s*C7\b/.test(l));
  if (c7 >= 0) {
    const end = Math.min(lines.length, c7 + 80);
    const stop = lines.slice(c7 + 1, end).findIndex((l) => /^\s*C8\b|C8:|^\s*C8A\b/.test(l));
    const last = stop < 0 ? end : c7 + 1 + stop;
    // The latest heading line above each row on the same page (the grid repeats it for Nonacademic). A page break
    // (pdftotext's form feed) between heading and row can shift every position, so such a row isn't placed.
    const columnsAt = (i: number) => {
      for (let j = i; j >= c7; j--) {
        const cols = c7Columns(lines[j], [lines[j - 2] ?? "", lines[j - 1] ?? "", lines[j + 1] ?? "", lines[j + 2] ?? ""]);
        if (cols) return cols;
        if (lines[j].includes("\f")) return null;
      }
      return null;
    };
    for (const [k, v] of readRows(lines, c7, last, C7_ROWS, columnsAt, c7Words)) out.set(k, v);
  }
  const c8 = lines.findIndex((l) => /^\s*C8A\b/.test(l));
  if (c8 >= 0) {
    const end = Math.min(lines.length, c8 + 40);
    const firstRow = lines.slice(c8, end).findIndex((l) => C8_ROWS.some(([, r]) => r.test(l) && /^\s*(C8A\s+)?(SAT|ACT)/i.test(l)));
    if (firstRow > 0) {
      const cols = c8Columns(lines.slice(c8, c8 + firstRow));
      const stop = lines.slice(c8 + firstRow, end).findIndex((l) => /^\s*C8[B-G]\b/.test(l));
      const last = stop < 0 ? end : c8 + firstRow + stop;
      for (const [k, v] of readRows(lines, c8 + firstRow, last, C8_ROWS, () => cols)) out.set(k, v);
    }
  }
  return out;
}
