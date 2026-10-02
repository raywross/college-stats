/**
 * Reading a college's Common Data Set from the official Excel template, shared by `npm run import-cds` (which writes
 * data/overrides.json) and `npm run sync-college-reported` (which reads section C1 deterministically, without a
 * model). The .xlsx is a zip of XML read with the system `unzip`; values are found by row label, not fixed cell.
 */
import { execFileSync } from "node:child_process";

export type Cell = { col: string; value: string | number };
export type Sheet = Map<number, Cell[]>;
/** Sheets keyed by upper-cased name, with "CSD-" typos normalized to "CDS-" ("CDS-B", "CDS-C", "CDS-H"). */
export type Workbook = Map<string, Sheet>;

function decode(xml: string): string {
  return xml
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function readZipEntry(zip: string, entry: string): string {
  try {
    return execFileSync("unzip", ["-p", zip, entry], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** Every sheet of an .xlsx file on disk. */
export function readWorkbook(zip: string): Workbook {
  const shared = [...readZipEntry(zip, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
  );
  const rels = new Map(
    [...readZipEntry(zip, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(
      (m) => [m[1], m[2].replace(/^\/?xl\//, "")]
    )
  );
  const sheets: Workbook = new Map();
  for (const m of readZipEntry(zip, "xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels.get(m[2]);
    if (!target) continue;
    const xml = readZipEntry(zip, `xl/${target}`);
    const sheet: Sheet = new Map();
    for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, row, attrs, body = ""] = c;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value: string | number | undefined;
      if (type === "s") value = shared[Number(/<v>([^<]*)<\/v>/.exec(body)?.[1])];
      else if (type === "inlineStr") value = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else if (type === "str") value = decode(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "");
      else {
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        value = v === undefined || v === "" ? undefined : Number(v);
      }
      if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) continue;
      const r = Number(row);
      if (!sheet.has(r)) sheet.set(r, []);
      sheet.get(r)!.push({ col, value });
    }
    sheets.set(m[1].trim().toUpperCase().replace(/^CSD-/, "CDS-"), sheet);
  }
  return sheets;
}

/* ------------------------------------------------------------------ */
/* Label-based lookups                                                 */
/* ------------------------------------------------------------------ */

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** First row with a text cell starting with `label` that also has numbers. */
export function row(sheet: Sheet | undefined, label: string): Cell[] | null {
  if (!sheet) return null;
  const needle = norm(label);
  for (const r of [...sheet.keys()].sort((a, b) => a - b)) {
    const cells = sheet.get(r)!;
    if (cells.some((c) => typeof c.value === "string" && norm(c.value).startsWith(needle)) && cells.some((c) => typeof c.value === "number")) {
      return cells;
    }
  }
  return null;
}

export const numbers = (cells: Cell[] | null) => (cells ?? []).filter((c) => typeof c.value === "number").map((c) => c.value as number);
export const inCol = (cells: Cell[] | null, col: string) => {
  const c = cells?.find((x) => x.col === col && typeof x.value === "number");
  return c ? (c.value as number) : null;
};
/** Percent values appear as 0.274 or 27.4 depending on the college. */
export const frac = (v: number | null | undefined) => (v === null || v === undefined ? null : v > 1.5 ? v / 100 : v);
export const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Newer CDS templates (and a hidden table in some classic ones) include
 * machine-readable items: a question code cell ("C117", "C.905", "H2A01"),
 * then the label, then the value. Codes aren't stable across colleges'
 * files, so items are matched by label; `occurrence` picks among repeats
 * (e.g. H2 lists first-years, then full-time, then part-time undergraduates).
 */
const CODE = /^[A-J]\d?A?\.?\d{2,5}$/;
const toNum = (v: string | number | undefined): number | null => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[,$%\s]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};
const stripLetter = (s: string) => norm(s).replace(/^[a-z]\.\s*/, "");

export type FlatItem = { label: string; value: number | null };

export function flatItems(sheet: Sheet | undefined): FlatItem[] {
  const items: FlatItem[] = [];
  for (const r of [...(sheet?.keys() ?? [])].sort((a, b) => a - b)) {
    const cells = sheet!.get(r)!;
    cells.forEach((c, i) => {
      const next = cells[i + 1];
      if (typeof c.value === "string" && CODE.test(c.value.trim()) && next && typeof next.value === "string" && !CODE.test(next.value.trim())) {
        items.push({ label: stripLetter(next.value), value: toNum(cells[i + 2]?.value) });
      }
    });
  }
  return items;
}

export function flat(items: FlatItem[], label: string, occurrence: number | "last" = 1): number | null {
  const hits = items.filter((it) => it.label.startsWith(norm(label)));
  const hit = occurrence === "last" ? hits.at(-1) : hits[occurrence - 1];
  return hit?.value ?? null;
}

/** Column holding full-time undergraduates in the H2 table (template: E). */
export function fullTimeUndergradCol(sheet: Sheet | undefined): string {
  for (const cells of sheet?.values() ?? []) {
    const hit = cells.find((c) => typeof c.value === "string" && norm(c.value).startsWith("full-time undergrad"));
    if (hit) return hit.col;
  }
  return "E";
}

/* ------------------------------------------------------------------ */
/* C1: applied / admitted / enrolled                                   */
/* ------------------------------------------------------------------ */

export type C1Verb = "applied" | "were admitted" | "enrolled";

/**
 * One C1 total, cross-checked against the gender rows and (classic layout) the residency columns on the same row.
 * Colleges' own files contain typos; when two independent breakdowns agree with each other but not the total, trust
 * them. Notes about disagreements are pushed onto `warnings`.
 */
export function c1Total(C: Sheet | undefined, FC: FlatItem[], verb: C1Verb, warnings: string[]): number | null {
  const classicRow = numbers(row(C, `Total first-time, first-year who ${verb}`));
  const total = flat(FC, `Total first-time, first-year students who ${verb}`) ?? classicRow[0] ?? null;
  const genders = ["men", "women", "another gender", "unknown gender"].map((g) => {
    const label = verb === "enrolled" ? null : `Total first-time, first-year ${g} who ${verb}`;
    return label ? (flat(FC, label) ?? numbers(row(C, label))[0] ?? 0) : 0;
  });
  const byGender = genders.reduce((a, b) => a + b, 0) || null;
  const byResidency = classicRow.length >= 4 ? classicRow.slice(1).reduce((a, b) => a + b, 0) : null;
  const off = (x: number | null) => x !== null && total !== null && Math.abs(x - total) / total > 0.01;
  if (total !== null && byGender !== null && byResidency !== null && off(byGender) && Math.abs(byGender - byResidency) <= 1) {
    warnings.push(`C1 "${verb}" total ${total} disagrees with its breakdowns (${byGender}); using ${byGender}.`);
    return byGender;
  }
  if (total !== null && byGender !== null && off(byGender)) {
    warnings.push(`C1 "${verb}" total ${total} differs from the gender rows (${byGender}); kept the total. Check the file.`);
  }
  return total;
}

/** C1's three totals from a workbook (null where not found), with any cross-check warnings. */
export function readC1(book: Workbook): { applicants: number | null; admitted: number | null; enrolled: number | null; warnings: string[] } {
  const C = book.get("CDS-C");
  const FC = flatItems(C);
  const warnings: string[] = [];
  return {
    applicants: c1Total(C, FC, "applied", warnings),
    admitted: c1Total(C, FC, "were admitted", warnings),
    enrolled: c1Total(C, FC, "enrolled", warnings),
    warnings,
  };
}

/**
 * The CDS edition a workbook states about itself ("Common Data Set 2025-2026" → "2025-26"), from any text cell that
 * names the Common Data Set with a year range; null when none does.
 */
export function workbookEdition(book: Workbook): string | null {
  for (const sheet of book.values()) {
    for (const cells of sheet.values()) {
      for (const c of cells) {
        if (typeof c.value !== "string" || !/common data set/i.test(c.value)) continue;
        const m = /(20\d{2})\s*[-–/]\s*(?:20)?(\d{2})\b/.exec(c.value);
        if (m) return `${m[1]}-${m[2]}`;
      }
    }
  }
  return null;
}

/** A sheet as plain text, one row per line (cells joined with " | "), for a model fallback when C1 isn't found. */
export function sheetText(sheet: Sheet | undefined): string {
  if (!sheet) return "";
  return [...sheet.keys()]
    .sort((a, b) => a - b)
    .map((r) => sheet.get(r)!.map((c) => String(c.value)).join(" | "))
    .join("\n");
}
