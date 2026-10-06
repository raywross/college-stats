/**
 * Connecticut state report card adapter: EdSight (the CT State Department of Education's public data portal) report
 * exports. Writes data/high-schools/state/ct.json through `npm run sync-hs-states -- --state ct`.
 *
 * Each EdSight report (a SAS stored process at edsight.ct.gov, embedded in public-edsight.ct.gov pages) has an "Export
 * .csv file" link. The export needs the guest session the report page opens, so this adapter opens the report as a
 * guest, follows its export link, and caches the CSV in `.cache/high-schools/` (delete the file to refresh).
 * edsight.ct.gov publishes no robots.txt; public-edsight.ct.gov allows these pages.
 *
 * Reports (All Districts, All Schools, All Students):
 *   - College Entrance and Persistence: National Student Clearinghouse matches for every public high school's
 *     graduates. Entrance from the newest class; persistence from the class before (the newest class's is "N/A").
 *   - Chronic Absenteeism.
 *   - Connecticut School Day SAT (grade 11; the state's high school accountability test).
 * Ids: 7-digit school codes ("0026111"), the last part of CCD's ST_SCHID ("CT-0020011-0026111").
 * Codes: "*" = suppressed (CSDE Data Suppression Guidelines: counts of 5 or fewer and complementary cells; a percent
 * whose numerator is 5 or fewer or whose denominator is under 20); "N/A" = not reported.
 *
 * Not delivered: Clearinghouse completion (EdSight's per-school Clearinghouse reports stop at the class of 2014, as
 * PDFs); fall-only enrollment (EdSight's entrance rate counts enrollment any time in the first year, so it fills
 * college_going_rate, not nsc_enrolled_fall); AP pass rates (no per-school export). To move years, change YEARS below.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HsStateSection } from "../../../../lib/high-school-types.ts";
import { suppress } from "../../../../lib/high-school-core.ts";
import { USER_AGENT } from "../context.mts";
import type { StateAdapter, StateAdapterResult, StateContext } from "../types.mts";
import { StateFileBuilder, csvRows, stateCrosswalk, type Crosswalk } from "./stb-common.mts";

export const YEARS = {
  /** EdSight "year" = the graduating class's school year. */
  entrance: "2023-24",
  persistence: "2022-23",
  chronic: "2024-25",
  sat: "2024-25",
};
const dash = (y: string) => y.replace("-", "–");
const classOf = (y: string) => `Class of ${Number(y.slice(0, 4)) + 1}`;

const EDSIGHT = "https://edsight.ct.gov/SASStoredProcess";
const PROGRAMS = "/CTDOE/EdSight/Release/Reporting/Public/Reports/StoredProcesses";
const PAGES = {
  entrance: "https://public-edsight.ct.gov/performance/college-enrollment-dashboard/college-entrance-and-persistence",
  chronic: "https://public-edsight.ct.gov/students/chronic-absenteeism",
  sat: "https://public-edsight.ct.gov/performance/connecticut-school-day-sat",
};

const SUPPRESSED = ["*"];
const MISSING = ["N/A"];
const pct = (raw: string | undefined) => suppress(raw ?? null, { kind: "share", percent: true, suppressedCodes: SUPPRESSED, missingCodes: MISSING });

/** "CT-0020011-0026111" → "0026111". */
export function ctNativeKey(stSchId: string): string | null {
  const m = /^CT-\d{7}-(\d{7})$/.exec(stSchId.trim());
  return m ? m[1] : null;
}

/** An export's school code cell ('="0026111"' read as text) → 7 digits. */
export function ctSchoolCode(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  return d.length === 7 ? d : null;
}

/**
 * An EdSight export as records keyed by its header row (the row starting "District"), carrying District/School
 * forward into continuation rows (the SAT export prints a school's Math row with blank name cells). Duplicate header
 * names keep their first column; `extra` names a column by index for exports that repeat "Count"/"%".
 */
export function edsightRecords(text: string, extra: Record<string, (headerAbove: string[], header: string[]) => number> = {}): Record<string, string>[] {
  const rows = csvRows(text);
  const at = rows.findIndex((r) => r[0] === "District" && r.includes("School Code"));
  if (at < 0) throw new Error("EdSight export: no header row");
  const header = rows[at];
  const extraAt = Object.fromEntries(Object.entries(extra).map(([k, f]) => [k, f(rows[at - 1] ?? [], header)]));
  const out: Record<string, string>[] = [];
  let carry = { District: "", "District Code": "", School: "", "School Code": "" };
  for (const r of rows.slice(at + 1)) {
    if (r.length < header.length - 1 || r.every((c) => !c)) continue;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      if (!(h in rec)) rec[h] = r[i] ?? "";
    });
    for (const [k, i] of Object.entries(extraAt)) rec[k] = i >= 0 ? (r[i] ?? "") : "";
    if (rec["School Code"]) carry = { District: rec.District || carry.District, "District Code": rec["District Code"] || carry["District Code"], School: rec.School, "School Code": rec["School Code"] };
    else Object.assign(rec, carry);
    out.push(rec);
  }
  return out;
}

/** The SAT export's "Level 3&4 Met or Exceeded" percent column: the "%" right after that group's "Count". */
export const satMetOrExceeded = (above: string[], header: string[]) => {
  const g = above.findIndex((c) => /Level\s*3\s*&\s*4/i.test(c));
  return g >= 0 && header[g + 1] === "%" ? g + 1 : -1;
};

export function ctSections(retrieved: string): HsStateSection[] {
  return [
    {
      key: "college-entrance",
      source: "state-ct",
      label: `EdSight College Entrance and Persistence, ${classOf(YEARS.entrance)}: college entrance`,
      year: classOf(YEARS.entrance),
      url: PAGES.entrance,
      retrieved,
      fields: ["college_going_rate"],
      notes:
        "Entrance(%): the share of the school's graduates from that class who enrolled in a two- or four-year college any " +
        "time during the first year after high school, from CSDE's match with National Student Clearinghouse records. " +
        "\"*\" is suppressed; \"N/A\" is not reported.",
    },
    {
      key: "college-persistence",
      source: "state-ct",
      label: `EdSight College Entrance and Persistence, ${classOf(YEARS.persistence)}: persistence`,
      year: classOf(YEARS.persistence),
      url: PAGES.entrance,
      retrieved,
      fields: ["nsc_persisted"],
      notes:
        "Persistence(%): of the graduates who enrolled in college the first year after high school, the share who returned " +
        "for a second year (freshman to sophomore), from National Student Clearinghouse records. One class older than " +
        "the entrance figure, because the newest class's second year isn't in yet.",
    },
    {
      key: "chronic-absence",
      source: "state-ct",
      label: `EdSight Chronic Absenteeism, ${dash(YEARS.chronic)}`,
      year: dash(YEARS.chronic),
      url: PAGES.chronic,
      retrieved,
      fields: ["chronic_absence"],
      notes: "Chronically absent %: students who missed 10% or more of the days they were enrolled, for any reason, all students.",
    },
    {
      key: "sat",
      source: "state-ct",
      label: `EdSight Connecticut School Day SAT, ${dash(YEARS.sat)}`,
      year: dash(YEARS.sat),
      url: PAGES.sat,
      retrieved,
      fields: ["ela_proficiency", "math_proficiency"],
      notes:
        "Level 3 & 4 (Met or Exceeded) %: the share of grade 11 students with scored tests who met or exceeded Connecticut's " +
        "achievement standard on the School Day SAT (Evidence-Based Reading and Writing for ELA; Math). \"*\" is suppressed " +
        "(CSDE suppresses counts of 5 or fewer, their complements, and percents with a denominator under 20).",
    },
  ];
}

/** Fills the builder from the four exports' text (tests pass small extracts). */
export function buildCtFile(
  exports: { entrance: string; persistence: string; chronic: string; sat: string },
  crosswalk: Crosswalk,
  retrieved: string,
): { result: StateAdapterResult; builder: StateFileBuilder } {
  const b = new StateFileBuilder(crosswalk);
  const each = (text: string, f: (id: string, r: Record<string, string>) => void, extra?: Parameters<typeof edsightRecords>[1]) => {
    for (const r of edsightRecords(text, extra)) {
      const id = ctSchoolCode(r["School Code"] ?? "");
      if (id) f(id, r);
    }
  };
  each(exports.entrance, (id, r) => b.set("college_going_rate", id, r.School, pct(r["Entrance(%)"]), true));
  each(exports.persistence, (id, r) => b.set("nsc_persisted", id, r.School, pct(r["Persistence(%)"]), true));
  each(exports.chronic, (id, r) => b.set("chronic_absence", id, r.School, pct(r["%"]), false));
  each(
    exports.sat,
    (id, r) => {
      const field = r.Subject === "ELA" ? "ela_proficiency" : r.Subject === "Math" ? "math_proficiency" : null;
      if (field) b.set(field, id, r.School, pct(r.met), true);
    },
    { met: satMetOrExceeded },
  );
  return { result: b.result(ctSections(retrieved)), builder: b };
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

/**
 * One EdSight export into the cache (once): open the report as a guest (cookies kept across its redirects), find its
 * "Export .csv file" link, fetch that with the same session.
 */
export async function edsightExport(
  ctx: Pick<StateContext, "cacheDir" | "offline" | "log">,
  report: string,
  params: Record<string, string>,
  file: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const path = join(ctx.cacheDir, file);
  if (existsSync(path)) return path;
  const pageUrl = `${EDSIGHT}/guest?${new URLSearchParams({ _program: `${PROGRAMS}/${report}`, ...params, _select: "Submit" })}`;
  if (ctx.offline) throw new Error(`${pageUrl}: not cached and --offline is set`);
  const jar = new Map<string, string>();
  const get = async (url: string): Promise<string> => {
    let u = url;
    for (let hop = 0; hop < 12; hop++) {
      const res = await fetchImpl(u, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, redirect: "manual" });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const kv = c.split(";")[0];
        const eq = kv.indexOf("=");
        if (eq > 0) jar.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
      }
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.arrayBuffer().catch(() => undefined);
        u = new URL(loc, u).toString();
        continue;
      }
      if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer()).toString("latin1");
    }
    throw new Error(`${url}: too many redirects`);
  };
  ctx.log(`  downloading EdSight ${report} ${JSON.stringify(params)}`);
  const page = await get(pageUrl);
  const href = /href=(https:\/\/edsight\.ct\.gov\/SASStoredProcess\/do\?[^\s>]*Export[^\s>]*)/.exec(page)?.[1];
  if (!href) throw new Error(`${report}: the report page has no export link (did EdSight change?)`);
  const csv = await get(href.replace(/&amp;/g, "&"));
  if (!/"District"/.test(csv)) throw new Error(`${report}: the export isn't the expected CSV`);
  mkdirSync(ctx.cacheDir, { recursive: true });
  writeFileSync(path, csv, "latin1");
  writeFileSync(`${path}.url`, `${href.replace(/&amp;/g, "&")}\n`);
  return path;
}

async function load(ctx: StateContext): Promise<StateAdapterResult> {
  const crosswalk = await stateCrosswalk(ctx, ctNativeKey);
  const all = { _district: "All Districts", _school: "All Schools" };
  const read = async (report: string, params: Record<string, string>, file: string) => readFileSync(await edsightExport(ctx, report, params, file), "latin1");
  const exports = {
    entrance: await read("CollegeEntranceandPersistenceReport_SiteCore", { _year: YEARS.entrance, ...all, _subgroup: "" }, `ct-college-entrance-${YEARS.entrance}.csv`),
    persistence: await read("CollegeEntranceandPersistenceReport_SiteCore", { _year: YEARS.persistence, ...all, _subgroup: "" }, `ct-college-entrance-${YEARS.persistence}.csv`),
    chronic: await read("ChronicAbsenteeismReport_SiteCore", { _year: YEARS.chronic, ...all, _subgroup: "All Students " }, `ct-chronic-absenteeism-${YEARS.chronic}.csv`),
    sat: await read("CTSchoolDaySATReport_SiteCore", { _year: YEARS.sat, ...all, _subject: "All Subjects", _subgroup: "All Students " }, `ct-school-day-sat-${YEARS.sat}.csv`),
  };
  const { result, builder } = buildCtFile(exports, crosswalk, ctx.today);
  for (const line of builder.report()) ctx.log(line);
  return result;
}

export const adapter: StateAdapter = {
  state: "CT",
  source: "state-ct",
  name: "EdSight report exports",
  publisher: "Connecticut State Department of Education",
  url: "https://public-edsight.ct.gov/",
  built: true,
  load,
};
