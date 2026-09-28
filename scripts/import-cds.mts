/**
 * Import a college's Common Data Set (official Excel template) into data/overrides.json.
 *
 *   npm run import-cds -- --id 221999 --edition 2024-25 \
 *     --url https://cdn.vanderbilt.edu/.../CDS_2024-2025.xlsx
 *
 *   (--url also accepts a local file path; add --link <public url> so the citation points somewhere
 *   readers can open.) Then run `npm run sync-data`.
 *
 * Reads, by row label rather than fixed cell, from the standard CDS sheets:
 *   B1/B2  undergraduate total and race/ethnicity
 *   C1     applied / admitted / enrolled
 *   C9     SAT/ACT percentiles and submission rates
 *   H2/H2A need-based and merit aid (full-time undergraduates)
 * Anything it can't find is left out of the patch, so federal data fills the gap.
 * PDF-only Common Data Sets aren't supported.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OVERRIDES = join(ROOT, "data", "overrides.json");
const SCHOOLS = join(ROOT, "data", "schools.json");

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const id = arg("id");
const source = arg("url");
const edition = arg("edition");
/** Public URL cited on the site; defaults to --url. */
const link = arg("link") ?? source;
if (!id || !source || !edition || !/^\d{4}-\d{2}$/.test(edition)) {
  console.error("Usage: npm run import-cds -- --id <IPEDS unit id> --edition <YYYY-YY> --url <xlsx url or path>");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Minimal .xlsx reader (zip of XML) via the system unzip              */
/* ------------------------------------------------------------------ */

type Cell = { col: string; value: string | number };
type Sheet = Map<number, Cell[]>;

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

function readWorkbook(zip: string): Map<string, Sheet> {
  const shared = [...readZipEntry(zip, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
  );
  const rels = new Map(
    [...readZipEntry(zip, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(
      (m) => [m[1], m[2].replace(/^\/?xl\//, "")]
    )
  );
  const sheets = new Map<string, Sheet>();
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

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** First row with a text cell starting with `label` that also has numbers. */
function row(sheet: Sheet | undefined, label: string): Cell[] | null {
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

const numbers = (cells: Cell[] | null) => (cells ?? []).filter((c) => typeof c.value === "number").map((c) => c.value as number);
const inCol = (cells: Cell[] | null, col: string) => {
  const c = cells?.find((x) => x.col === col && typeof x.value === "number");
  return c ? (c.value as number) : null;
};
/** Percent values appear as 0.274 or 27.4 depending on the college. */
const frac = (v: number | null | undefined) => (v === null || v === undefined ? null : v > 1.5 ? v / 100 : v);
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

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

function flatItems(sheet: Sheet | undefined): { label: string; value: number | null }[] {
  const items: { label: string; value: number | null }[] = [];
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

function flat(items: { label: string; value: number | null }[], label: string, occurrence: number | "last" = 1): number | null {
  const hits = items.filter((it) => it.label.startsWith(norm(label)));
  const hit = occurrence === "last" ? hits.at(-1) : hits[occurrence - 1];
  return hit?.value ?? null;
}

/** Column holding full-time undergraduates in the H2 table (template: E). */
function fullTimeUndergradCol(sheet: Sheet | undefined): string {
  for (const cells of sheet?.values() ?? []) {
    const hit = cells.find((c) => typeof c.value === "string" && norm(c.value).startsWith("full-time undergrad"));
    if (hit) return hit.col;
  }
  return "E";
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  if (!/^https?:\/\//.test(link!)) console.warn("Warning: citing a local path. Pass --link <public url> so readers can open the source.");
  let file = source!;
  if (/^https?:\/\//.test(source!)) {
    // Some college servers answer browser-like and tool-like user agents differently; keep the first real .xlsx (starts with "PK").
    let bytes: Buffer | null = null;
    for (const ua of ["curl/8.7.1", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"]) {
      const res = await fetch(source!, { headers: { "User-Agent": ua } });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.subarray(0, 2).toString() === "PK") {
        bytes = buf;
        break;
      }
    }
    if (!bytes) throw new Error("Download failed or didn't return an .xlsx file.");
    file = join(mkdtempSync(join(tmpdir(), "cds-")), "cds.xlsx");
    writeFileSync(file, bytes);
  } else if (!existsSync(file)) throw new Error(`No such file: ${file}`);

  const book = readWorkbook(file);
  const B = book.get("CDS-B");
  const C = book.get("CDS-C");
  const H = book.get("CDS-H");
  if (!B && !C && !H) throw new Error(`Not a CDS template workbook. Sheets found: ${[...book.keys()].join(", ")}`);

  const school = (JSON.parse(readFileSync(SCHOOLS, "utf8")) as { unit_id: string; name: string }[]).find((s) => s.unit_id === id);
  const found: string[] = [];
  const missing: string[] = [];
  const note = (label: string, ok: boolean) => (ok ? found : missing).push(label);

  /* ---- C1 / C9: admissions & tests ---- */
  const FC = flatItems(C);
  const FB = flatItems(B);
  const FH = flatItems(H);
  const warnings: string[] = [];
  /**
   * C1 totals, cross-checked against the gender rows and (classic layout) the
   * residency columns on the same row. Colleges' own files contain typos; when
   * two independent breakdowns agree with each other but not the total, trust them.
   */
  const c1 = (verb: "applied" | "were admitted" | "enrolled") => {
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
  };
  const applicants = c1("applied");
  const admitted = c1("were admitted");
  const enrolled = c1("enrolled");
  note("C1 applied/admitted/enrolled", applicants !== null && admitted !== null && enrolled !== null);

  const range = (label: string): [number, number] | null => {
    const lo = flat(FC, `${label}: 25th Percentile`);
    const hi = flat(FC, `${label}: 75th Percentile`);
    if (lo !== null && hi !== null) return [lo, hi];
    // Classic layout: one row with 25th / 50th / 75th in consecutive columns.
    const n = numbers(row(C, label)).filter((v) => v > 1);
    return n.length >= 3 ? [n[0], n[2]] : null;
  };
  const satR = range("SAT Evidence-Based Reading and Writing");
  const satM = range("SAT Math");
  const act = range("ACT Composite");
  const satPct = frac(flat(FC, "Submitting SAT Scores") ?? numbers(row(C, "Submitting SAT Scores"))[0]);
  const actPct = frac(flat(FC, "Submitting ACT Scores") ?? numbers(row(C, "Submitting ACT Scores"))[0]);
  note("C9 test scores", !!(satR || act));

  const admissions: Record<string, unknown> = { year: Number(edition!.slice(0, 4)) };
  if (applicants !== null && admitted !== null && enrolled !== null) {
    Object.assign(admissions, { applicants, admitted, enrolled, acceptance_rate: round4(admitted / applicants) });
  }
  if (satR) admissions.sat_reading_25_75 = satR;
  if (satM) admissions.sat_math_25_75 = satM;
  if (act) admissions.act_composite_25_75 = act;
  if (satPct !== null) admissions.test_submission_rate_sat = round4(satPct);
  if (actPct !== null) admissions.test_submission_rate_act = round4(actPct);

  /* ---- B1 / B2: enrollment & race ---- */
  const undergrads = flat(FB, "Total all undergraduates") ?? numbers(row(B, "Total all undergraduates"))[0] ?? null;
  note("B1 undergraduates", undergrads !== null);
  // Race rows repeat for first-years, degree-seeking, and all undergrads; the last group is all undergrads.
  const last = (label: string) => flat(FB, label, "last") ?? numbers(row(B, label)).at(-1) ?? 0;
  const race = {
    international: last("Nonresidents"),
    hispanic: last("Hispanic/Latino"),
    black: last("Black or African American"),
    white: last("White, non-Hispanic"),
    asian: last("Asian, non-Hispanic"),
    two_or_more: last("Two or more races"),
    other: last("American Indian") + last("Native Hawaiian") + last("Race and/or ethnicity unknown"),
  };
  const raceTotal = Object.values(race).reduce((a, b) => a + b, 0);
  note("B2 race/ethnicity", raceTotal > 0);
  const demographics: Record<string, unknown> = {};
  if (undergrads !== null) demographics.undergrad_enrollment = undergrads;
  if (raceTotal > 0) {
    demographics.racial_diversity = Object.fromEntries(Object.entries(race).map(([k, v]) => [k, round4(v / raceTotal)]));
  }

  /* ---- H2 / H2A: need-based & merit aid ---- */
  const col = fullTimeUndergradCol(H);
  // Flat H2/H2A repeat each line for first-years, full-time, and part-time undergrads: take the 2nd (full-time).
  const h = (label: string) => flat(FH, label, 2) ?? inCol(row(H, label), col);
  const hMoney = (label: string) => {
    const v = h(label);
    return v === null ? null : Math.round(v);
  };
  const cdsAid = {
    undergrads: h("Number of degree-seeking undergraduate students"),
    applied_need: h("Number of students in line a who applied for need-based"),
    has_need: h("Number of students in line b who were determined to have financial need"),
    need_fully_met: h("Number of students in line d whose need was fully met"),
    pct_need_met: frac(h("On average, the percentage of need that was met")),
    avg_package: hMoney("The average financial aid package"),
    avg_need_grant: hMoney("Average need-based scholarship and grant award"),
    avg_need_loan: hMoney("Average need-based loan"),
    merit_no_need: h("Number of students in line a who had no financial need"),
    merit_avg: hMoney("Average dollar amount of institutional non-need-based scholarship"),
  };
  const hasAid = Object.values(cdsAid).some((v) => v !== null);
  note("H2/H2A aid", hasAid);

  /* ---- Write the patch ---- */
  // The sync attributes every value in the patch to this CDS (field-level lineage; specs/data-lineage.md).
  const patch: Record<string, unknown> = {
    _source: `${school?.name ?? id} Common Data Set ${edition}: ${link}`,
    _imported: new Date().toISOString().slice(0, 10),
    cds: { edition, url: link },
  };
  if (Object.keys(admissions).length > 1) patch.admissions = admissions;
  if (Object.keys(demographics).length) patch.demographics = demographics;
  if (hasAid) patch.aid = { cds: cdsAid };

  if (warnings.length) patch._warnings = warnings;
  const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};
  overrides[id!] = patch;
  writeFileSync(OVERRIDES, `${JSON.stringify(overrides, null, 2)}\n`);

  console.log(`${school?.name ?? `Unit ${id} (not in data/schools.json)`}: CDS ${edition}`);
  console.log(`  found:   ${found.join(", ") || "nothing"}`);
  if (missing.length) console.log(`  missing: ${missing.join(", ")} (federal data will be used)`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  console.log(`Wrote data/overrides.json. Run \`npm run sync-data\` to apply.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
