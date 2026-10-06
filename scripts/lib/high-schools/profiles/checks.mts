/**
 * From a model's answer to a HighSchoolDetail, with the checks every value must pass (specs/product/high-school-data.md
 * "Profile PDFs"). Pure.
 *
 * Document checks (any failure: nothing is written for the school, the document goes to the review queue):
 *   - wrong-school: the name the profile prints must be this school's (half its distinctive words or more);
 *   - edition: the profile must say which year or class it describes, and be no older than `minEditionStart`.
 * Field checks (a failing field is withheld and queued; the school's other fields still publish, as in the
 * college-reported engine):
 *   - quote: every number appears on the lines it cites (lib/cds-quotes numberOnLines), and every cited line exists;
 *   - distribution-sum: GPA band shares sum to 1 ± 0.02 (counts become shares of their total), at least two bands;
 *   - count-bound: no matriculation count above the class size (or, with no class size, CCD's 12th-grade enrollment);
 *     a count-basis GPA distribution totals no more than the class size + 10%;
 *   - scale-kind: the scale's kind agrees with its printed maximum;
 *   - range: SAT 400–1600, ACT 1–36, low ≤ high;
 *   - names: AP/IB course names must appear in the document (more than 20% missing withholds the list);
 *   - plausible: class size between 1 and 3× CCD's 12th grade (+ 50), so a total enrollment read as a class fails.
 * College matching (./match.mts): an ambiguous name keeps unit_id null and is queued with its candidates; an unmatched
 * name keeps unit_id null and is listed for a curated alias. Neither withholds the list.
 */
import type { HighSchoolDetail, CitedNum } from "../../../../lib/high-school-types.ts";
import { lineText, numberOnLines, quoteFromNumberedLines, type NumberedLine } from "../../../../lib/cds-quotes.ts";
import type { ProfileAnswer, ProfileField } from "./extract.mts";
import { nameCoverage, documentText } from "./document.mts";
import { matchCollege, type CollegeIndex } from "./match.mts";

export interface CheckFailure {
  field: ProfileField | "document";
  check: "wrong-school" | "edition" | "quote" | "distribution-sum" | "count-bound" | "scale-kind" | "range" | "names" | "plausible" | "empty";
  detail: string;
}

export interface CollegeReview {
  check: "college-ambiguous" | "college-unmatched";
  names: { name: string; candidates?: string[] }[];
}

export interface AssessContext {
  school: { id: string; name: string; grade12: number | null };
  lines: readonly NumberedLine[];
  url: string;
  retrieved: string;
  hash?: string;
  index: CollegeIndex;
  /** Oldest edition accepted (its fall year). Default 2023: a 2023–24 profile or newer. */
  minEditionStart?: number;
}

export interface Assessment {
  /** The detail to write (only passing fields filled), or null when a document check failed or nothing passed. */
  detail: HighSchoolDetail | null;
  failures: CheckFailure[];
  passed: ProfileField[];
  withheld: ProfileField[];
  colleges: CollegeReview[];
  match: { listed: number; matched: number; ambiguous: number; unmatched: number };
  edition: string | null;
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                      */
/* ------------------------------------------------------------------ */

/** "1,234" → 1234, "21.5%" → 21.5, "" → null. */
export function parseNum(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/[,%~$\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * The edition a profile describes as "YYYY–YY" plus its fall year: "2025-2026", "2025–26", "2025/26" → 2025–26;
 * "Class of 2026" → 2025–26 (its senior year); "Fall 2025" → 2025–26; a lone year → that year's fall when it reads like
 * a school year start. Null when no year is printed.
 */
export function parseEdition(text: string | null | undefined): { edition: string; start: number } | null {
  if (!text) return null;
  const fmt = (y: number) => ({ edition: `${y}–${String((y + 1) % 100).padStart(2, "0")}`, start: y });
  const range = /(20\d\d)\s*[-–—/]\s*(?:20)?(\d\d)(?!\d)/.exec(text);
  if (range && Number(range[2]) === (Number(range[1]) + 1) % 100) return fmt(Number(range[1]));
  const cls = /class\s+of\s+(?:['’])?(20\d\d|\d\d)\b/i.exec(text);
  if (cls) {
    const y = cls[1].length === 2 ? 2000 + Number(cls[1]) : Number(cls[1]);
    return fmt(y - 1);
  }
  const fall = /fall\s+(20\d\d)/i.exec(text);
  if (fall) return fmt(Number(fall[1]));
  const lone = /(?<!\d)(20\d\d)(?!\d)/.exec(text);
  return lone ? fmt(Number(lone[1])) : null;
}

/** "Class of 2025" → "2025"; "Classes of 2023-2025" / "2023–25" → "2023–2025"; else the printed text. */
export function normalizeClasses(text: string): string {
  const t = text.trim();
  const range = /(20\d\d)\s*[-–—]\s*(20\d\d|\d\d)(?!\d)/.exec(t);
  if (range) {
    const end = range[2].length === 2 ? 2000 + Number(range[2]) : Number(range[2]);
    if (end > Number(range[1])) return `${range[1]}–${end}`;
  }
  const years = [...t.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].map((m) => Number(m[1]));
  if (years.length === 1) return String(years[0]);
  return t;
}

const validIds = (lines: readonly NumberedLine[], ids: readonly number[] | undefined) => {
  const max = lines.length ? lines[lines.length - 1].id : 0;
  return (ids ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= max);
};

const pageOf = (lines: readonly NumberedLine[], ids: readonly number[]) => (ids.length ? lines.find((l) => l.id === ids[0])?.page : undefined);

/** The cited lines' text, verbatim, joined with a space (no length cap beyond 600 characters): the school's own rule. */
export function verbatim(lines: readonly NumberedLine[], ids: readonly number[]): string | null {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const parts = [...new Set(ids)].sort((a, b) => a - b).map((id) => byId.get(id)).filter(Boolean).map((l) => lineText(l!.text).replace(/\s*\|\s*/g, " ").trim()).filter(Boolean);
  if (!parts.length) return null;
  const t = parts.join(" ").replace(/\s+/g, " ").trim();
  return t.length <= 600 ? t : `${t.slice(0, 599).trimEnd()}…`;
}

/** Number on its lines, given the plain lines array numberOnLines wants. */
function onLines(v: number, lines: readonly NumberedLine[], ids: readonly number[], percent = false): boolean {
  const byIndex = lines.map((l) => l.text);
  // numberOnLines takes 1-based ids into a plain array; our ids are 1-based and dense (numberLines).
  return numberOnLines(v, byIndex, ids, { percent });
}

const courseKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(ap|ib|advanced placement|international baccalaureate|hl|sl|higher level|standard level)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Course names found in the document; `missing` are names whose words don't appear in it. */
export function coursesInDocument(names: readonly string[], text: string): { found: string[]; missing: string[] } {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const found: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    const k = courseKey(name);
    if (!name || seen.has(k)) continue;
    seen.add(k);
    if (k && hay.includes(` ${k} `)) found.push(name);
    else missing.push(name);
  }
  return { found, missing };
}

/* ------------------------------------------------------------------ */
/* The assessment                                                       */
/* ------------------------------------------------------------------ */

export function assessProfile(answer: ProfileAnswer, ctx: AssessContext): Assessment {
  const { lines } = ctx;
  const failures: CheckFailure[] = [];
  const fail = (field: CheckFailure["field"], check: CheckFailure["check"], detail: string) => failures.push({ field, check, detail });
  const text = documentText(lines);
  const empty: Assessment = { detail: null, failures, passed: [], withheld: [], colleges: [], match: { listed: 0, matched: 0, ambiguous: 0, unmatched: 0 }, edition: null };

  // Document checks.
  const printed = answer.school_name?.text ?? "";
  if (nameCoverage(ctx.school.name, `${printed}\n${text.slice(0, 4000)}`) < 0.5 || (printed && nameCoverage(ctx.school.name, printed) === 0)) {
    fail("document", "wrong-school", `profile names "${printed.slice(0, 80)}", not ${ctx.school.name}`);
    return empty;
  }
  const ed = parseEdition(answer.edition?.text);
  if (!ed) {
    fail("document", "edition", "the profile doesn't say which year or class it describes");
    return empty;
  }
  empty.edition = ed.edition;
  const minStart = ctx.minEditionStart ?? 2023;
  if (ed.start < minStart) {
    fail("document", "edition", `edition ${ed.edition} is older than ${minStart}–${String((minStart + 1) % 100).padStart(2, "0")}`);
    return empty;
  }

  const passed: ProfileField[] = [];
  const withheld: ProfileField[] = [];
  const detail: HighSchoolDetail = {
    id: ctx.school.id,
    profile: { url: ctx.url, retrieved: ctx.retrieved, edition: ed.edition, ...(ctx.hash ? { hash: ctx.hash } : {}) },
    class_size: null,
    gpa_scale: null,
    gpa_distribution: null,
    ap_courses: null,
    ib_courses: null,
    scores: null,
    matriculation: null,
  };
  const field = (f: ProfileField, ok: boolean) => (ok ? passed.push(f) : withheld.push(f));

  // Class size.
  if (answer.class_size) {
    const ids = validIds(lines, answer.class_size.lines);
    const v = parseNum(answer.class_size.v);
    const before = failures.length;
    if (v === null || !Number.isInteger(v) || v <= 0) fail("class_size", "quote", `class size "${answer.class_size.v}" isn't a whole number`);
    else if (!ids.length || !onLines(v, lines, ids)) fail("class_size", "quote", `${v} isn't on cited line(s) ${JSON.stringify(answer.class_size.lines)}`);
    else if (ctx.school.grade12 !== null && v > ctx.school.grade12 * 3 + 50) fail("class_size", "plausible", `class size ${v} vs ${ctx.school.grade12} 12th graders in CCD`);
    if (failures.length === before && v !== null) {
      const quote = quoteFromNumberedLines(lines, ids)!;
      const c: CitedNum = { v, quote };
      const page = pageOf(lines, ids);
      if (page !== undefined) c.page = page;
      detail.class_size = c;
    }
    field("class_size", failures.length === before);
  }

  // GPA scale.
  if (answer.gpa_scale) {
    const g = answer.gpa_scale;
    const ids = validIds(lines, g.lines);
    const max = parseNum(g.max);
    const before = failures.length;
    if (!ids.length) fail("gpa_scale", "quote", "no cited line");
    else if (max !== null && !onLines(max, lines, ids) && !onLines(max, lines, validIds(lines, g.rule_lines))) fail("gpa_scale", "quote", `max ${max} isn't on its cited lines`);
    const expect: Record<string, number> = { "unweighted-4": 4, "weighted-5": 5, "100-point": 100 };
    if (expect[g.kind] !== undefined && max !== null && max !== expect[g.kind]) fail("gpa_scale", "scale-kind", `kind ${g.kind} but max ${max}`);
    if (failures.length === before) {
      const page = pageOf(lines, ids);
      detail.gpa_scale = {
        kind: g.kind,
        max,
        weighted: !!g.weighted,
        conversion: verbatim(lines, validIds(lines, g.rule_lines)),
        quote: quoteFromNumberedLines(lines, ids)!,
        ...(page !== undefined ? { page } : {}),
      };
    }
    field("gpa_scale", failures.length === before);
  }

  // GPA distribution.
  if (answer.gpa_distribution) {
    const d = answer.gpa_distribution;
    const before = failures.length;
    const vals = d.bands.map((b) => ({ band: b.band.replace(/\s+/g, " ").trim(), v: parseNum(b.v), ids: validIds(lines, b.lines) }));
    if (vals.length < 2) fail("gpa_distribution", "distribution-sum", `${vals.length} band(s); a distribution needs two or more`);
    for (const b of vals) {
      if (b.v === null) fail("gpa_distribution", "quote", `band ${b.band}: "${d.bands.find((x) => x.band.trim() === b.band)?.v}" isn't a number`);
      else if (!b.ids.length || !onLines(b.v, lines, b.ids)) fail("gpa_distribution", "quote", `band ${b.band}: ${b.v} isn't on its cited line(s)`);
    }
    if (new Set(vals.map((b) => b.band.toLowerCase())).size !== vals.length) fail("gpa_distribution", "distribution-sum", "a band is listed twice");
    let shares: { band: string; share: number }[] = [];
    if (failures.length === before) {
      const nums = vals.map((b) => b.v!);
      if (d.basis === "percent") shares = vals.map((b, i) => ({ band: b.band, share: Math.round(nums[i] * 100) / 10000 }));
      else {
        const total = nums.reduce((a, b) => a + b, 0);
        const bound = detail.class_size?.v ?? ctx.school.grade12;
        if (total <= 0) fail("gpa_distribution", "distribution-sum", "counts total 0");
        else if (bound !== null && total > bound * 1.1) fail("gpa_distribution", "count-bound", `band counts total ${total}, class size ${bound}`);
        else shares = vals.map((b, i) => ({ band: b.band, share: Math.round((nums[i] / total) * 10000) / 10000 }));
      }
      const sum = shares.reduce((a, b) => a + b.share, 0);
      if (shares.length && Math.abs(sum - 1) > 0.02) fail("gpa_distribution", "distribution-sum", `shares sum to ${Math.round(sum * 1000) / 1000}, not 1 ± 0.02`);
    }
    if (failures.length === before) detail.gpa_distribution = shares;
    field("gpa_distribution", failures.length === before);
  }

  // AP / IB courses.
  for (const k of ["ap_courses", "ib_courses"] as const) {
    const a = answer[k];
    if (!a) continue;
    const before = failures.length;
    const { found, missing } = coursesInDocument(a.names ?? [], text);
    if (!found.length) fail(k, "empty", "no course names");
    else if (missing.length > 0.2 * (found.length + missing.length)) fail(k, "names", `${missing.length} of ${found.length + missing.length} names aren't in the document (${missing.slice(0, 3).join(", ")})`);
    if (failures.length === before) detail[k] = found;
    field(k, failures.length === before);
  }

  // Scores.
  const scores: NonNullable<HighSchoolDetail["scores"]> = {};
  const scoreIds: number[] = [];
  for (const [k, lo, hi] of [["sat_mid50", 400, 1600], ["act_mid50", 1, 36]] as const) {
    const s = answer[k];
    if (!s) continue;
    const before = failures.length;
    const ids = validIds(lines, s.lines);
    const low = parseNum(s.low);
    const high = parseNum(s.high);
    if (low === null || high === null) fail(k, "quote", `range "${s.low}"–"${s.high}" isn't two numbers`);
    else if (!(low >= lo && high <= hi && low <= high)) fail(k, "range", `${low}–${high} outside ${lo}–${hi} or reversed`);
    else if (!ids.length || !onLines(low, lines, ids) || !onLines(high, lines, ids)) fail(k, "quote", `${low}–${high} isn't on its cited line(s)`);
    if (failures.length === before) {
      scores[k] = [low!, high!];
      scoreIds.push(...ids);
    }
    field(k, failures.length === before);
  }
  if (scores.sat_mid50 || scores.act_mid50) detail.scores = { ...scores, quote: quoteFromNumberedLines(lines, scoreIds) ?? undefined };

  // Matriculation.
  const colleges: CollegeReview[] = [];
  const match = { listed: 0, matched: 0, ambiguous: 0, unmatched: 0 };
  if (answer.matriculation) {
    const m = answer.matriculation;
    const before = failures.length;
    const bound = detail.class_size?.v ?? ctx.school.grade12;
    const entries: NonNullable<HighSchoolDetail["matriculation"]>["entries"] = [];
    const ambiguous: CollegeReview["names"] = [];
    const unmatched: CollegeReview["names"] = [];
    const seen = new Set<string>();
    for (const e of m.entries ?? []) {
      const name = e.name.replace(/\s+/g, " ").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const count = e.count?.trim() ? parseNum(e.count) : null;
      const ids = validIds(lines, e.lines);
      if (e.count?.trim() && (count === null || !Number.isInteger(count))) fail("matriculation", "quote", `${name}: count "${e.count}" isn't a whole number`);
      else if (count !== null && (!ids.length || !onLines(count, lines, ids))) fail("matriculation", "quote", `${name}: ${count} isn't on its cited line(s)`);
      else if (count !== null && bound !== null && count > bound) fail("matriculation", "count-bound", `${name}: ${count} enrolled exceeds the class size ${bound}`);
      const r = matchCollege(ctx.index, name);
      match.listed++;
      if (r.kind === "matched") match.matched++;
      else if (r.kind === "ambiguous") {
        match.ambiguous++;
        ambiguous.push({ name, candidates: r.candidates });
      } else {
        match.unmatched++;
        unmatched.push({ name });
      }
      entries.push({ name, unit_id: r.kind === "matched" ? r.unit_id : null, count });
    }
    if (!entries.length) fail("matriculation", "empty", "no colleges listed");
    if (failures.length === before) {
      const ids = validIds(lines, m.lines);
      const page = pageOf(lines, ids.length ? ids : validIds(lines, m.entries?.[0]?.lines));
      detail.matriculation = {
        classes: normalizeClasses(m.classes || ed.edition),
        entries,
        ...(ids.length ? { quote: quoteFromNumberedLines(lines, ids) ?? undefined } : {}),
        ...(page !== undefined ? { page } : {}),
      };
      if (ambiguous.length) colleges.push({ check: "college-ambiguous", names: ambiguous });
      if (unmatched.length) colleges.push({ check: "college-unmatched", names: unmatched });
    }
    field("matriculation", failures.length === before);
  }

  const any = passed.length > 0;
  return { detail: any ? detail : null, failures, passed, withheld, colleges, match, edition: ed.edition };
}
