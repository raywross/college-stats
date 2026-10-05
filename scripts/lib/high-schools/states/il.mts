/**
 * Illinois state report card adapter: ISBE's Report Card Public Data Set (one .xlsx per report card year, linked from
 * https://www.isbe.net/pages/illinois-state-report-card-data.aspx). Writes data/high-schools/state/il.json through
 * `npm run sync-hs-states -- --state il`.
 *
 * Sheets used: "General" (postsecondary enrollment, chronic absenteeism, AP exams) and "ACT" (high school assessment
 * proficiency). Rows with Level "School" only. Ids: RCDTS ("08-043-2100-26-0002"); CCD's ST_SCHID ends with the same
 * code without dashes ("IL-08-043-2100-26-080432100260002").
 * Codes: "*" = suppressed by ISBE (too few students); blank = not reported.
 *
 * Downloaded from /Documents/ directly: isbe.net's robots.txt disallows the /_layouts/Download.aspx wrapper the page
 * links through. To move to a newer report card, change REPORT_CARD below.
 */
import type { HsStateSection } from "../../../../lib/high-school-types.ts";
import { suppress, type Suppressed } from "../../../../lib/high-school-core.ts";
import type { StateAdapter, StateAdapterResult, StateContext } from "../types.mts";
import { StateFileBuilder, readXlsxSheet, recordsFrom, stateCrosswalk, type Crosswalk } from "./stb-common.mts";

export const REPORT_CARD = {
  edition: "2025",
  schoolYear: "2024–25",
  /** Postsecondary enrollment covers graduates from two years before the report card's school year. */
  postsecondaryClass: "Class of 2023",
  url: "https://www.isbe.net/Documents/2025-Report-Card-Public-Data-Set.xlsx",
};
const PAGE = "https://www.isbe.net/pages/illinois-state-report-card-data.aspx";

const SUPPRESSED = ["*"];
const pct = (raw: string | undefined) => suppress(raw ?? null, { kind: "share", percent: true, suppressedCodes: SUPPRESSED });

/** "IL-08-043-2100-26-080432100260002" → "080432100260002". */
export function ilNativeKey(stSchId: string): string | null {
  const last = stSchId.trim().split("-").at(-1) ?? "";
  return /^[0-9A-Z]{15}$/i.test(last) ? last.toUpperCase() : null;
}

/** "08-043-2100-26-0002" → "080432100260002". */
export function ilRcdts(raw: string): string | null {
  const k = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return k.length === 15 ? k : null;
}

const GRADES = [9, 10, 11, 12] as const;

/**
 * AP exams scored 3 or higher ("eligible to earn college credit") ÷ AP exams taken, summed over grades 9–12. Any
 * suppressed grade cell makes the school's rate suppressed (a partial sum would misstate it); no exams → not reported.
 */
export function ilApPassRate(r: Record<string, string>): Suppressed {
  let taken = 0;
  let passed = 0;
  for (const g of GRADES) {
    const t = (r[`Total AP Exams Taken Grade ${g}`] ?? "").trim();
    const e = (r[`Total AP Exams Eligible to Earn College Credit Grade ${g}`] ?? "").trim();
    if (SUPPRESSED.includes(t) || SUPPRESSED.includes(e)) return { value: null, suppressed: true };
    const tn = Number(t || 0);
    const en = Number(e || 0);
    if (!Number.isFinite(tn) || !Number.isFinite(en)) return { value: null, suppressed: false };
    taken += tn;
    passed += en;
  }
  if (taken <= 0 || passed > taken) return { value: null, suppressed: false };
  return { value: Math.round((passed / taken) * 1e4) / 1e4, suppressed: false };
}

export function ilSections(retrieved: string): HsStateSection[] {
  const label = (what: string) => `Illinois Report Card ${REPORT_CARD.edition} Public Data Set: ${what}`;
  return [
    {
      key: "postsecondary",
      source: "state-il",
      label: label("postsecondary enrollment"),
      year: REPORT_CARD.postsecondaryClass,
      url: REPORT_CARD.url,
      retrieved,
      fields: ["college_going_rate"],
      notes:
        "\"% Graduates enrolled in a Postsecondary Institution within 12 months\": graduates with a regular diploma from the " +
        "school two years before the report card year who enrolled in a U.S. college (two- or four-year, public or private, " +
        "or trade school) within 12 months, matched through the National Student Clearinghouse (ISBE Report Card glossary). " +
        "ISBE also publishes a 16-month rate; this file uses the 12-month one.",
    },
    {
      key: "ap",
      source: "state-il",
      label: label("Advanced Placement exams"),
      year: REPORT_CARD.schoolYear,
      url: REPORT_CARD.url,
      retrieved,
      fields: ["ap_pass_rate"],
      notes:
        "Derived: \"Total AP Exams Eligible to Earn College Credit\" (exams scored 3 or higher) ÷ \"Total AP Exams Taken\", " +
        "each summed over grades 9–12, so it is the share of exams passed, not of students. Suppressed when ISBE suppressed " +
        "any grade's count.",
    },
    {
      key: "act",
      source: "state-il",
      label: label("high school assessment (ACT)"),
      year: REPORT_CARD.schoolYear,
      url: REPORT_CARD.url,
      retrieved,
      fields: ["ela_proficiency", "math_proficiency"],
      notes:
        "\"HS Assessment ELA / Math Proficiency Rate - Total\": the share of grade 11 students scoring at Level 3 " +
        "(Proficient) or Level 4 (Above Proficient) on the ACT, Illinois's high school accountability test.",
    },
    {
      key: "chronic-absence",
      source: "state-il",
      label: label("chronic absenteeism"),
      year: REPORT_CARD.schoolYear,
      url: REPORT_CARD.url,
      retrieved,
      fields: ["chronic_absence"],
      notes:
        "\"Chronic Absenteeism\": chronically absent students (absent, with or without valid cause, for 10% or more of the " +
        "school days of the year; Illinois School Code 26-18) ÷ the school's enrollment. Medically homebound and hospitalized " +
        "students are excluded.",
    },
  ];
}

const looksHigh = (r: Record<string, string>) => r["School Type"] === "High School" || /(^|-\s*)12$/.test((r["Grades Served"] ?? "").trim());

/** Fills the builder from the "General" and "ACT" sheets' rows (tests pass small extracts). */
export function buildIlFile(
  sheets: { general: readonly string[][]; act: readonly string[][] },
  crosswalk: Crosswalk,
  retrieved: string,
): { result: StateAdapterResult; builder: StateFileBuilder } {
  const b = new StateFileBuilder(crosswalk);
  const highIds = new Set<string>();
  for (const r of recordsFrom(sheets.general, ["RCDTS", "Level"])) {
    const id = r.Level === "School" ? ilRcdts(r.RCDTS) : null;
    if (!id) continue;
    const high = looksHigh(r);
    if (high) highIds.add(id);
    const name = r["School Name"] ?? "";
    b.set("college_going_rate", id, name, pct(r["% Graduates enrolled in a Postsecondary Institution within 12 months"]), high);
    b.set("ap_pass_rate", id, name, ilApPassRate(r), high);
    b.set("chronic_absence", id, name, pct(r["Chronic Absenteeism"]), high);
  }
  for (const r of recordsFrom(sheets.act, ["RCDTS", "Level"])) {
    const id = r.Level === "School" ? ilRcdts(r.RCDTS) : null;
    if (!id) continue;
    const high = highIds.has(id) || looksHigh(r);
    b.set("ela_proficiency", id, r["School Name"] ?? "", pct(r["HS Assessment ELA Proficiency Rate - Total"]), high);
    b.set("math_proficiency", id, r["School Name"] ?? "", pct(r["HS Assessment Math Proficiency Rate - Total"]), high);
  }
  return { result: b.result(ilSections(retrieved)), builder: b };
}

async function load(ctx: StateContext): Promise<StateAdapterResult> {
  const crosswalk = await stateCrosswalk(ctx, ilNativeKey);
  const file = await ctx.fetchCached(REPORT_CARD.url, { file: `il-report-card-${REPORT_CARD.edition}.xlsx` });
  const { result, builder } = buildIlFile({ general: readXlsxSheet(file, "General"), act: readXlsxSheet(file, "ACT") }, crosswalk, ctx.today);
  for (const line of builder.report()) ctx.log(line);
  return result;
}

export const adapter: StateAdapter = {
  state: "IL",
  source: "state-il",
  name: "Illinois Report Card Public Data Set",
  publisher: "Illinois State Board of Education",
  url: PAGE,
  built: true,
  load,
};
