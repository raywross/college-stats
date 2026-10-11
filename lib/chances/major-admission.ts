/**
 * How colleges admit by school or major (specs/chances/base-rates.md "Major", major-and-grades.md "Data"):
 * data/major-admission.json, hand-curated from each college's own pages with every value quoted (the
 * college-reported agent's recipe is later work). A unit is the university itself (unit_id is its IPEDS id, usually a
 * "the major doesn't affect admission" statement) or a school or major within it ("{unit_id}:{slug}"). Checked by
 * scripts/check-major-admission.mts in `npm run verify`; cited as `reported.major_admission.*` (lib/fields.ts),
 * which lib/lineage.ts resolves to the unit's own page. Pure: safe in server and client code and in tests.
 */
import file from "../../data/major-admission.json" with { type: "json" };
import { isMajorFamily } from "../majors.ts";
import { catalogCourse, COURSE_SUBJECTS } from "./catalog.ts";
import { isHttpsUrl, isIsoDate } from "./guaranteed.ts";
import type { MajorAdmissionUnit, MajorEmphasis, MajorGateKind } from "./types.ts";

/** A curated unit, with how it was checked: read on the page, or quoted from it in a search result. */
export type CuratedMajorUnit = MajorAdmissionUnit & { verified_via: "page" | "search" };

export interface MajorAdmissionFile {
  description?: string;
  checked: string;
  units: CuratedMajorUnit[];
}

const data = file as MajorAdmissionFile;

/** The IPEDS id a unit belongs to: "190415:engineering" → "190415". */
export function collegeOf(unitId: string): string {
  const i = unitId.indexOf(":");
  return i < 0 ? unitId : unitId.slice(0, i);
}

/** Every curated unit. */
export function allMajorUnits(): readonly CuratedMajorUnit[] {
  return data.units;
}

/** The schools and majors within a college that admit separately (never the university-level statement). */
export function majorUnitsFor(unitId: string): CuratedMajorUnit[] {
  return data.units.filter((u) => u.unit !== "university" && collegeOf(u.unit_id) === unitId);
}

/** The college's university-level statement (e.g. "the major you list doesn't affect admission"), or null. */
export function universityStatement(unitId: string): CuratedMajorUnit | null {
  return data.units.find((u) => u.unit === "university" && u.unit_id === unitId) ?? null;
}

/** The unit a student's intended major (a two-digit CIP family) would apply to at a college: a major before a school; null when none. */
export function majorUnitFor(unitId: string, family: string): CuratedMajorUnit | null {
  const units = majorUnitsFor(unitId).filter((u) => u.cip_families.includes(family));
  return units.find((u) => u.unit === "major") ?? units[0] ?? null;
}

/** One unit by its id ("190415:engineering"), or null. */
export function majorUnitById(id: string): CuratedMajorUnit | null {
  return data.units.find((u) => u.unit_id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Validation (scripts/check-major-admission.mts, `npm run verify`)    */
/* ------------------------------------------------------------------ */

const UNIT_ID_RE = /^\d+(:[a-z0-9]+(-[a-z0-9]+)*)?$/;
const CONSIDERED: readonly string[] = ["no", "pool", "pool_and_emphasis"];
const EMPHASIS: readonly MajorEmphasis[] = ["math", "science", "cs", "writing", "arts"];
const GATE_RANGE: Record<MajorGateKind, [number, number]> = { sat_math: [200, 800], act_math: [1, 36], ap: [1, 5], ib_hl: [1, 7] };

/** Digits of a number as a page might print them: "1234" matches "1,234" and "1234". */
const inQuote = (quote: string, n: number) => quote.replace(/(\d),(?=\d{3})/g, "$1").includes(String(n));

/** A share as a page prints its percentage: 0.212 → "21.2%", 0.2 → "20%". */
export function percentText(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** A unit's published admit rate: from its counts when it prints them, else its printed percentage; null when neither. */
export function unitAdmitRate(u: Pick<MajorAdmissionUnit, "admit_rate" | "published_rate">): { rate: number; year: string; quote: string; source_url: string } | null {
  if (u.admit_rate) return { rate: u.admit_rate.admitted / u.admit_rate.applied, year: u.admit_rate.year, quote: u.admit_rate.quote, source_url: u.admit_rate.source_url };
  return u.published_rate ?? null;
}

/**
 * Problems with the major-admission file, one line each (empty means sound). Every unit: a unique id of the right
 * shape for its kind (a university is its bare IPEDS id, a school or major adds ":slug"), a college in the dataset,
 * valid CIP families (none for a university), a direct-admit flag; an admit rate with admitted ≤ applied, a year, a
 * page, and both numbers in its quote; a review whose every value is quoted, whose gate numbers appear in the quote,
 * whose gate courses are catalog keys, and whose page and read date are real; and how it was verified.
 */
export function validateMajorAdmission(input: MajorAdmissionFile, knownUnitIds?: Set<string>): string[] {
  if (!input || !Array.isArray(input.units)) return ['major-admission: "units" must be an array'];
  const errors: string[] = [];
  if (!isIsoDate(input.checked)) errors.push("major-admission: checked must be a real ISO date");
  const seen = new Set<string>();
  input.units.forEach((u, i) => {
    if (!u || typeof u !== "object") {
      errors.push(`major-admission[${i}]: not an object`);
      return;
    }
    const where = `major-admission[${i}] ${typeof u.unit_id === "string" ? u.unit_id : "(no unit_id)"}`;
    if (typeof u.unit_id !== "string" || !UNIT_ID_RE.test(u.unit_id)) errors.push(`${where}: unit_id must be an IPEDS id, or "{id}:{slug}" for a school or major`);
    else {
      if (seen.has(u.unit_id)) errors.push(`${where}: duplicate unit_id`);
      seen.add(u.unit_id);
      if (knownUnitIds && !knownUnitIds.has(collegeOf(u.unit_id))) errors.push(`${where}: ${collegeOf(u.unit_id)} isn't a college in the dataset`);
      const bare = !u.unit_id.includes(":");
      if (u.unit === "university" && !bare) errors.push(`${where}: a university unit is its bare IPEDS id`);
      if (u.unit !== "university" && bare) errors.push(`${where}: a ${u.unit} unit needs ":slug" after the IPEDS id`);
    }
    if (u.unit !== "university" && u.unit !== "school" && u.unit !== "major") errors.push(`${where}: unit must be "university", "school", or "major"`);
    if (typeof u.name !== "string" || !u.name.trim()) errors.push(`${where}: name is required`);
    if (!Array.isArray(u.cip_families)) errors.push(`${where}: cip_families must be a list`);
    else {
      for (const f of u.cip_families) if (typeof f !== "string" || !isMajorFamily(f)) errors.push(`${where}: cip family ${JSON.stringify(f)} isn't a lib/majors.ts family`);
      if (u.unit !== "university" && u.cip_families.length === 0) errors.push(`${where}: a school or major lists the CIP families it admits`);
      if (u.unit === "university" && u.cip_families.length > 0) errors.push(`${where}: a university-level statement lists no CIP families`);
    }
    if (!(u.direct_admit === null || typeof u.direct_admit === "boolean" || u.direct_admit === "some")) errors.push(`${where}: direct_admit must be true, false, "some", or null`);
    if (u.verified_via !== "page" && u.verified_via !== "search") errors.push(`${where}: verified_via must be "page" or "search"`);
    const a = u.admit_rate;
    if (a !== null) {
      if (!a || typeof a !== "object") errors.push(`${where}: admit_rate must be an object or null`);
      else {
        const counts = Number.isInteger(a.admitted) && Number.isInteger(a.applied) && a.admitted >= 0 && a.applied > 0;
        if (!counts) errors.push(`${where}: admit_rate needs whole admitted and applied counts`);
        else if (a.admitted > a.applied) errors.push(`${where}: admit_rate admitted (${a.admitted}) is above applied (${a.applied})`);
        if (typeof a.year !== "string" || !a.year.trim()) errors.push(`${where}: admit_rate.year is required`);
        if (!isHttpsUrl(a.source_url)) errors.push(`${where}: admit_rate.source_url must be an https page`);
        if (typeof a.quote !== "string" || !a.quote.trim()) errors.push(`${where}: admit_rate.quote is required`);
        else if (counts && (!inQuote(a.quote, a.admitted) || !inQuote(a.quote, a.applied))) errors.push(`${where}: admit_rate's counts must appear in its quote`);
      }
    }
    const pr = u.published_rate;
    if (pr !== undefined && pr !== null) {
      if (typeof pr !== "object") errors.push(`${where}: published_rate must be an object or null`);
      else {
        const ok = typeof pr.rate === "number" && pr.rate > 0 && pr.rate <= 1;
        if (!ok) errors.push(`${where}: published_rate.rate must be a share from 0 to 1`);
        if (typeof pr.year !== "string" || !pr.year.trim()) errors.push(`${where}: published_rate.year is required`);
        if (!isHttpsUrl(pr.source_url)) errors.push(`${where}: published_rate.source_url must be an https page`);
        if (typeof pr.quote !== "string" || !pr.quote.trim()) errors.push(`${where}: published_rate.quote is required`);
        else if (ok && !pr.quote.includes(percentText(pr.rate))) errors.push(`${where}: published_rate's percentage (${percentText(pr.rate)}) must appear in its quote`);
        if (a !== null) errors.push(`${where}: published_rate is for a college that prints no counts; drop it beside admit_rate`);
      }
    }
    const r = u.review;
    if (r !== null) {
      if (!r || typeof r !== "object") {
        errors.push(`${where}: review must be an object or null`);
        return;
      }
      if (r.major_considered !== null && !CONSIDERED.includes(r.major_considered)) errors.push(`${where}: review.major_considered must be "no", "pool", "pool_and_emphasis", or null`);
      if (!Array.isArray(r.emphasis) || r.emphasis.some((e) => !EMPHASIS.includes(e))) errors.push(`${where}: review.emphasis must list ${EMPHASIS.join(", ")}`);
      else if (r.emphasis.length > 0 && r.major_considered !== "pool_and_emphasis") errors.push(`${where}: an emphasis needs major_considered "pool_and_emphasis"`);
      if (r.major_considered === "pool_and_emphasis" && Array.isArray(r.emphasis) && r.emphasis.length === 0) errors.push(`${where}: "pool_and_emphasis" names the subjects in review.emphasis`);
      if (!Array.isArray(r.required_courses)) errors.push(`${where}: review.required_courses must be a list`);
      else
        r.required_courses.forEach((c, j) => {
          if (!c || !COURSE_SUBJECTS.includes(c.subject)) errors.push(`${where}: required_courses[${j}].subject isn't a course subject`);
          if (!c || typeof c.level !== "string" || !c.level.trim()) errors.push(`${where}: required_courses[${j}].level is required`);
          if (!c || typeof c.quote !== "string" || !c.quote.trim()) errors.push(`${where}: required_courses[${j}] needs its quote`);
        });
      if (r.gate !== null) {
        if (!r.gate || !Array.isArray(r.gate.any_of) || r.gate.any_of.length === 0) errors.push(`${where}: review.gate.any_of must list at least one route`);
        else
          r.gate.any_of.forEach((g, j) => {
            const range = g && GATE_RANGE[g.kind];
            if (!range) {
              errors.push(`${where}: gate[${j}].kind must be sat_math, act_math, ap, or ib_hl`);
              return;
            }
            if (typeof g.min !== "number" || g.min < range[0] || g.min > range[1]) errors.push(`${where}: gate[${j}].min must be ${range[0]}–${range[1]} for ${g.kind}`);
            if (g.kind === "ap" || g.kind === "ib_hl") {
              const c = typeof g.course === "string" ? catalogCourse(g.course) : null;
              const ok = c && (g.kind === "ap" ? c.key.startsWith("ap_") : "level" in c && c.level === "hl");
              if (!ok) errors.push(`${where}: gate[${j}].course must be a ${g.kind === "ap" ? "AP" : "IB HL"} catalog key`);
            } else if (g.course !== undefined) errors.push(`${where}: gate[${j}] names a course for a section score`);
            if (typeof g.min === "number" && typeof r.quote === "string" && !inQuote(r.quote, g.min)) errors.push(`${where}: gate[${j}]'s number (${g.min}) must appear in the review quote`);
          });
      }
      if (typeof r.quote !== "string" || !r.quote.trim()) errors.push(`${where}: review.quote is required`);
      if (!isHttpsUrl(r.source_url)) errors.push(`${where}: review.source_url must be an https page`);
      if (!isIsoDate(r.fetched)) errors.push(`${where}: review.fetched must be a real ISO date`);
      if (r.edition !== null && (typeof r.edition !== "string" || !r.edition.trim())) errors.push(`${where}: review.edition must be words or null`);
    }
    if (u.admit_rate === null && !u.published_rate && u.review === null) errors.push(`${where}: needs a review or an admit rate quoting the college (direct_admit alone has no source)`);
  });
  return errors;
}
