/**
 * Guessing next year's Common Data Set URL from this year's (specs/college-reported-round-2.md, decision 2): most
 * colleges keep the same folder and file name and change only the edition, so `CDS_2024-2025.xlsx` is usually followed
 * by `CDS_2025-2026.xlsx`. A guess that answers with a PDF or Excel file becomes the recipe with no model call.
 *
 * Only the FILE NAME is rewritten: folders often hold an upload date (`/uploads/2026/09/`) that isn't the edition.
 */

/** One edition written in a file name, with how to write another edition the same way. */
interface EditionMatch {
  /** The fall the edition describes (CDS 2024-2025 → 2024). */
  start: number;
  index: number;
  length: number;
  write: (start: number) => string;
}

const two = (n: number) => String(n % 100).padStart(2, "0");

/** The first edition written in `name`, in any of the forms colleges use. Null when it names none. */
function findEdition(name: string): EditionMatch | null {
  // 2024-2025, 2024_2025, 2024 2025 (consecutive years; a trailing digit as in "2024-20252" is allowed).
  for (const m of name.matchAll(/(?<!\d)(20\d\d)([-_ ])(20\d\d)/g)) {
    if (Number(m[3]) !== Number(m[1]) + 1) continue;
    const sep = m[2];
    return { start: Number(m[1]), index: m.index!, length: m[0].length, write: (y) => `${y}${sep}${y + 1}` };
  }
  // 2024-25, 2024_25
  for (const m of name.matchAll(/(?<!\d)(20\d\d)([-_ ])(\d\d)(?!\d)/g)) {
    if (Number(m[3]) !== (Number(m[1]) + 1) % 100) continue;
    const sep = m[2];
    return { start: Number(m[1]), index: m.index!, length: m[0].length, write: (y) => `${y}${sep}${two(y + 1)}` };
  }
  // 2425 (two-digit years run together). "20xx" is read as a single year below, never as 20–21.
  for (const m of name.matchAll(/(?<!\d)(\d\d)(\d\d)(?!\d)/g)) {
    if (m[1] === "20" || Number(m[2]) !== (Number(m[1]) + 1) % 100) continue;
    return { start: 2000 + Number(m[1]), index: m.index!, length: m[0].length, write: (y) => `${two(y)}${two(y + 1)}` };
  }
  // CDS2024, cds-2024 (a single year)
  const m = /(?<!\d)(20\d\d)(?!\d)/.exec(name);
  if (m) return { start: Number(m[1]), index: m.index, length: m[0].length, write: (y) => String(y) };
  return null;
}

/**
 * URLs for the next one and two editions after the one `url` names, newest first, keeping only editions that describe a
 * fall newer than `federalYear` (older ones can't publish). Empty when the file name names no edition (a Google Sheets
 * export, a Box link) or nothing newer than the URL's edition would help.
 */
export function guessNextEditionUrls(url: string, federalYear: number): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const slash = u.pathname.lastIndexOf("/");
  const dir = u.pathname.slice(0, slash + 1);
  let name = u.pathname.slice(slash + 1);
  try {
    // "Common%20Data%20Set%202024-2025.pdf": read the name decoded (the URL encodes it again when it's set back).
    name = decodeURIComponent(name);
  } catch {
    // a malformed escape: use the name as written
  }
  const found = findEdition(name);
  if (!found) return [];
  const out: string[] = [];
  for (const start of [found.start + 2, found.start + 1]) {
    if (start <= federalYear) continue;
    const next = new URL(u);
    next.pathname = dir + name.slice(0, found.index) + found.write(start) + name.slice(found.index + found.length);
    out.push(next.toString());
  }
  return out;
}
