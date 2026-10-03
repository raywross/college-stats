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
 * H2/H2A (aid) is no longer read here: CDS records read all three columns by code (lib/cds/financial-aid.ts,
 * specs/data-expansion/cds-financial-aid.md). Re-importing keeps a patch's existing hand-imported `aid` and its
 * `lineage` until a record supersedes them.
 * Anything it can't find is left out of the patch, so federal data fills the gap.
 * PDF-only Common Data Sets aren't supported.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c1Total, flat, flatItems, frac, numbers, readWorkbook, round4, row, type C1Verb } from "./lib/cds-xlsx.mts";

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
  const warnings: string[] = [];
  /**
   * C1 totals, cross-checked against the gender rows and (classic layout) the
   * residency columns on the same row. Colleges' own files contain typos; when
   * two independent breakdowns agree with each other but not the total, trust them
   * (scripts/lib/cds-xlsx.mts c1Total).
   */
  const c1 = (verb: C1Verb) => c1Total(C, FC, verb, warnings);
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

  /* ---- Write the patch ---- */
  // The sync attributes every value in the patch to this CDS (field-level lineage; specs/data-lineage.md).
  const patch: Record<string, unknown> = {
    _source: `${school?.name ?? id} Common Data Set ${edition}: ${link}`,
    _imported: new Date().toISOString().slice(0, 10),
    cds: { edition, url: link },
  };
  if (Object.keys(admissions).length > 1) patch.admissions = admissions;
  if (Object.keys(demographics).length) patch.demographics = demographics;
  const previous = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8"))[id!] : undefined;
  if (previous?.aid) patch.aid = previous.aid;
  if (previous?.lineage) patch.lineage = previous.lineage;

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
