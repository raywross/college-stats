/**
 * CDS student body and outcomes (specs/data-expansion/cds-student-body-and-outcomes.md; the spec's `lib/cds-b.ts`):
 * from a college's CDS records, the newest passed value set for each newest group (lib/newest-groups.ts), with
 * lineage: enrollment, gender, and part-time share from B1; race from B2 column 2; retention from B22; graduation by
 * Pell group, and the new 4- and 5-year shares, from the B4–B11 grid.
 *
 * The section-B checks live here too (`checkB1`, `checkB2`, `checkRetention`, `checkGrid`), with the spec's check ids,
 * so the value set and its checks can't disagree; a group is offered only when its record items passed and every
 * check here passes, including agreement with the federal value one fall or one cohort older (`federal-disagrees`),
 * which sends the item to review instead. Federal comparisons are always made against the federal baseline
 * (`restoreFederal(school)`), never a school that already shows a CDS value.
 *
 * Pure module: type-only imports plus other pure lib modules.
 */
import type { CdsCode, CollegeRecord, DocumentRecord, ItemResult } from "../cds-sections.ts";
import { compareDocuments, editionFallYear, lineageFromItem } from "../cds-records.ts";
import { MIN_GROUP_COHORT } from "../graduation-groups.ts";
import type { FieldPath } from "../fields";
import type { FoundGroup, FoundValues, NewestGroupKey } from "../newest-groups.ts";
import type { GradAidGroup, LineageRecord, School } from "../types";

/** One failed check: the spec's check id and what was wrong. */
export interface StudentBodyProblem {
  group: NewestGroupKey | "B2.first_year" | "B2.all";
  check:
    | "missing"
    | "item-failed"
    | "rows-add-up"
    | "unknown-gender-share"
    | "column-1-not-first-years"
    | "column-2-not-degree-seeking"
    | "column-3-not-all-undergrads"
    | "count-not-integer"
    | "rate-mismatch"
    | "previous-cohort-disagrees"
    | "federal-disagrees"
    | "edition-mismatch"
    | "order";
  detail: string;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;
const code = (n: number) => `B.${n}` as CdsCode;

/* ------------------------------------------------------------------ */
/* Reading cells                                                       */
/* ------------------------------------------------------------------ */

/** A cell as the checks see it: a number, blank, or unusable (failed, not read, text). */
type Cell = { kind: "number"; v: number } | { kind: "blank" } | { kind: "bad"; why: string };

function cell(doc: DocumentRecord, c: CdsCode): Cell {
  const it: ItemResult | undefined = doc.items[c];
  if (!it || it.status === "not-read" || it.status === "not-found") return { kind: "bad", why: `${c} ${it?.status ?? "missing"}` };
  if (it.status === "blank") return { kind: "blank" };
  if (it.status === "failed") return { kind: "bad", why: `${c} failed (${(it.failures ?? []).map((f) => f.check).join(", ")})` };
  return typeof it.v === "number" ? { kind: "number", v: it.v } : { kind: "bad", why: `${c} is not a number` };
}

class Unreadable extends Error {}

/** The number in a cell, null when blank; throws `Unreadable` for a failed or unread cell. */
function n(doc: DocumentRecord, c: CdsCode): number | null {
  const x = cell(doc, c);
  if (x.kind === "bad") throw new Unreadable(x.why);
  return x.kind === "number" ? x.v : null;
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

/**
 * A rate as a 0–1 share, from any of the forms colleges print: "88.6%" and "91%" (÷ 100), a bare number above 1 and at
 * most 100 (Loyola 63.73, Howard 88: a percent), or 0–1 (a fraction). A bare 1 is ambiguous: 100% only when `counts`
 * (the rate the counts give) confirm it, else null. Null for anything else.
 */
export function parseRate(raw: number | string | null | undefined, counts?: number | null): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    const m = t.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    if (m) return fromPercent(Number(m[1]));
    const v = Number(t.replace(/,/g, ""));
    return Number.isFinite(v) && t !== "" ? parseRate(v, counts) : null;
  }
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return null;
  if (raw === 1) return counts != null && Math.abs(counts - 1) <= 0.005 ? 1 : null;
  return raw > 1 ? fromPercent(raw) : raw;
}

/** 88.6 → 0.886 (rounded past float noise: 88.6 / 100 is 0.8859999…). */
const fromPercent = (v: number) => Math.round(v * 1e6) / 1e8;

/* ------------------------------------------------------------------ */
/* B1: enrollment                                                      */
/* ------------------------------------------------------------------ */

/** Row offsets of B1's undergraduate block for one sex (men start at B.101, women B.126, unknown B.151). */
const SEX_BASE = { men: 101, women: 126, unknown: 151 } as const;
type Sex = keyof typeof SEX_BASE;

export interface B1Values {
  /** Degree-seeking undergraduates (full- and part-time) by sex; unknown is null when the column is blank. */
  degree: Record<Sex, number | null>;
  partTime: Record<Sex, number | null>;
  firstTime: number;
  total: number;
  /** B.176, all undergraduates incl. non-degree. */
  allUndergrads: number | null;
}

/** B1's rows-add-up check and its degree-seeking totals. Blank totals with parts are computed from the parts; parts are never filled from totals. */
export function checkB1(doc: DocumentRecord): { values: B1Values | null; problems: StudentBodyProblem[] } {
  const problems: StudentBodyProblem[] = [];
  const fail = (check: StudentBodyProblem["check"], detail: string) => problems.push({ group: "enrollment", check, detail });
  try {
    const degree = {} as Record<Sex, number | null>;
    const partTime = {} as Record<Sex, number | null>;
    const sexTotals: (number | null)[] = [];
    let firstTime = 0;
    for (const sex of Object.keys(SEX_BASE) as Sex[]) {
      const b = SEX_BASE[sex];
      const half: { deg: number | null; tot: number | null }[] = [];
      for (const o of [0, 6]) {
        const parts = [n(doc, code(b + o)), n(doc, code(b + o + 1)), n(doc, code(b + o + 2))];
        let deg = n(doc, code(b + o + 3));
        if (deg === null && parts.some((p) => p !== null)) deg = sum(parts);
        if (deg !== null && parts.some((p) => p !== null) && !near(sum(parts), deg)) fail("rows-add-up", `${sex} ${o ? "part" : "full"}-time: first-time + other first-year + all other = ${sum(parts)}, total degree-seeking ${deg}`);
        const non = n(doc, code(b + o + 4));
        let tot = n(doc, code(b + o + 5));
        if (tot === null && (deg !== null || non !== null)) tot = (deg ?? 0) + (non ?? 0);
        if (tot !== null && (deg !== null || non !== null) && !near((deg ?? 0) + (non ?? 0), tot)) fail("rows-add-up", `${sex} ${o ? "part" : "full"}-time: degree-seeking + other = ${(deg ?? 0) + (non ?? 0)}, total ${tot}`);
        half.push({ deg, tot });
        firstTime += parts[0] ?? 0;
      }
      const total = n(doc, code(b + 12)) ?? (half.some((h) => h.tot !== null) ? sum(half.map((h) => h.tot)) : null);
      if (total !== null && half.some((h) => h.tot !== null) && !near(sum(half.map((h) => h.tot)), total)) fail("rows-add-up", `${sex}: full-time + part-time = ${sum(half.map((h) => h.tot))}, total ${total}`);
      sexTotals.push(total);
      degree[sex] = half.some((h) => h.deg !== null) ? sum(half.map((h) => h.deg)) : null;
      partTime[sex] = half[1].deg;
    }
    const all = n(doc, code(176));
    if (all !== null && !near(sum(sexTotals), all)) fail("rows-add-up", `total all undergraduates ${all}, the sexes' totals ${sum(sexTotals)}`);
    const grad = n(doc, code(177));
    const grand = n(doc, code(178));
    if (all !== null && grad !== null && grand !== null && !near(all + grad, grand)) fail("rows-add-up", `grand total ${grand}, undergraduates + graduate ${all + grad}`);
    if (degree.men === null || degree.women === null) {
      problems.push({ group: "enrollment", check: "missing", detail: "no degree-seeking men or women" });
      return { values: null, problems };
    }
    const total = degree.men + degree.women + (degree.unknown ?? 0);
    if (total <= 0) problems.push({ group: "enrollment", check: "missing", detail: "no degree-seeking undergraduates" });
    if ((degree.unknown ?? 0) > total * 0.05) fail("unknown-gender-share", `unknown ${degree.unknown} of ${total} degree-seeking (over 5%)`);
    return { values: { degree, partTime, firstTime, total, allUndergrads: all ?? sum(sexTotals) }, problems };
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e;
    problems.push({ group: "enrollment", check: "item-failed", detail: e.message });
    return { values: null, problems };
  }
}

/* ------------------------------------------------------------------ */
/* B2: race and ethnicity, three columns                               */
/* ------------------------------------------------------------------ */

/** B2 row order within a column: nonresidents, Hispanic, Black, White, AIAN, Asian, NHPI, two or more, unknown, TOTAL. */
const B2_COLUMNS = { first_year: 201, degree_seeking: 211, all: 221 } as const;

export type RaceShares = NonNullable<School["demographics"]["racial_diversity"]>;

function b2Column(doc: DocumentRecord, start: number): { groups: (number | null)[]; total: number | null } {
  const groups = Array.from({ length: 9 }, (_, i) => n(doc, code(start + i)));
  let total = n(doc, code(start + 9));
  if (total === null && groups.some((g) => g !== null)) total = sum(groups);
  return { groups, total };
}

/**
 * B2's three sub-items, each with its own checks, so a bad column 3 never blocks column 2 (the only one published):
 * columns add up; column 1 = B1's first-time first-years; column 2 = B1's degree-seeking total; column 3 = B.176 and
 * each group ≥ column 2's (Illinois fills column 3 with non-degree students only).
 */
export function checkB2(doc: DocumentRecord, b1: B1Values | null): { shares: RaceShares | null; problems: StudentBodyProblem[] } {
  const problems: StudentBodyProblem[] = [];
  const cols: Partial<Record<keyof typeof B2_COLUMNS, ReturnType<typeof b2Column>>> = {};
  const group = { first_year: "B2.first_year", degree_seeking: "race", all: "B2.all" } as const;
  for (const [k, start] of Object.entries(B2_COLUMNS) as [keyof typeof B2_COLUMNS, number][]) {
    try {
      const c = b2Column(doc, start);
      cols[k] = c;
      if (c.total === null) problems.push({ group: group[k], check: "missing", detail: `B2 ${k} has no total` });
      else if (!near(sum(c.groups), c.total)) problems.push({ group: group[k], check: k === "degree_seeking" ? "column-2-not-degree-seeking" : k === "first_year" ? "column-1-not-first-years" : "column-3-not-all-undergrads", detail: `groups sum to ${sum(c.groups)}, TOTAL ${c.total}` });
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      problems.push({ group: group[k], check: "item-failed", detail: e.message });
    }
  }
  const within1pct = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01);
  const c1 = cols.first_year;
  if (c1?.total != null && b1 && !within1pct(c1.total, b1.firstTime)) problems.push({ group: "B2.first_year", check: "column-1-not-first-years", detail: `column 1 TOTAL ${c1.total}, B1 first-time first-years ${b1.firstTime}` });
  const c2 = cols.degree_seeking;
  if (c2?.total != null && b1 && !within1pct(c2.total, b1.total)) problems.push({ group: "race", check: "column-2-not-degree-seeking", detail: `column 2 TOTAL ${c2.total}, B1 degree-seeking ${b1.total}` });
  if (c2?.total != null && !b1) problems.push({ group: "race", check: "column-2-not-degree-seeking", detail: "B1 has no degree-seeking total to check column 2 against" });
  const c3 = cols.all;
  if (c3?.total != null && b1?.allUndergrads != null && (!within1pct(c3.total, b1.allUndergrads) || (c2 && c3.groups.some((g, i) => (g ?? 0) < (c2.groups[i] ?? 0))))) {
    problems.push({ group: "B2.all", check: "column-3-not-all-undergrads", detail: `column 3 TOTAL ${c3.total}, B1 all undergraduates ${b1.allUndergrads}` });
  }
  if (!c2 || c2.total === null || c2.total <= 0 || problems.some((p) => p.group === "race")) return { shares: null, problems };
  const g = c2.groups.map((v) => v ?? 0);
  const t = c2.total;
  const shares: RaceShares = {
    asian: round4(g[5] / t),
    black: round4(g[2] / t),
    hispanic: round4(g[1] / t),
    white: round4(g[3] / t),
    two_or_more: round4(g[7] / t),
    international: round4(g[0] / t),
    other: round4((g[4] + g[6] + g[8]) / t),
  };
  return { shares, problems };
}

/* ------------------------------------------------------------------ */
/* B22: retention                                                      */
/* ------------------------------------------------------------------ */

/** Every "Fall YYYY" a quote names must be the edition's fall or the one before (B22's entering fall). */
function editionMismatch(doc: DocumentRecord, codes: CdsCode[], allowed: number[]): string | null {
  for (const c of codes) {
    for (const m of doc.items[c]?.quote?.matchAll(/Fall (\d{4})/gi) ?? []) {
      if (!allowed.includes(Number(m[1]))) return `${c} names fall ${m[1]}`;
    }
  }
  return null;
}

export interface RetentionValue {
  rate: number;
  cohort: number | null;
  retained: number | null;
  /** Derived from the counts, or the stated rate alone when the document gives no counts. */
  method: "derived" | "extracted";
}

/** B22: counts are whole numbers with retained ≤ cohort; the rate is computed from them, the stated rate only checked (±0.5 point). */
export function checkRetention(doc: DocumentRecord): { value: RetentionValue | null; problems: StudentBodyProblem[] } {
  const problems: StudentBodyProblem[] = [];
  const fail = (check: StudentBodyProblem["check"], detail: string) => problems.push({ group: "retention", check, detail });
  const raw = (c: CdsCode) => doc.items[c];
  const count = (c: CdsCode): number | null | "bad" => {
    const it = raw(c);
    if (!it || it.status === "blank" || it.status === "not-found" || it.status === "not-read") return null;
    if (typeof it.v !== "number" || !Number.isInteger(it.v) || it.v < 0) {
      fail("count-not-integer", `${c} is ${JSON.stringify(it.v)}, not a whole number of students`);
      return "bad";
    }
    if (it.status === "passed") return it.v;
    fail("item-failed", `${c} failed (${(it.failures ?? []).map((f) => f.check).join(", ")})`);
    return "bad";
  };
  const cohort = count("B.2201");
  const retained = count("B.2202");
  const stated = raw("B.2203")?.status === "passed" ? parseRate(raw("B.2203")!.v as number | string) : null;
  const start = editionFallYear(doc.edition);
  const mismatch = start === null ? "no edition" : editionMismatch(doc, ["B.2201", "B.2202", "B.2203"], [start - 1, start]);
  if (mismatch) fail("edition-mismatch", mismatch);
  if (cohort === "bad" || retained === "bad") return { value: null, problems };
  if (cohort !== null && retained !== null) {
    if (cohort <= 0 || retained > cohort) {
      fail("count-not-integer", `retained ${retained} of a cohort of ${cohort}`);
      return { value: null, problems };
    }
    const rate = retained / cohort;
    if (stated !== null && Math.abs(stated - rate) > 0.005) fail("rate-mismatch", `stated ${stated}, counts give ${round4(rate)}`);
    return problems.length ? { value: null, problems } : { value: { rate: round4(rate), cohort, retained, method: "derived" }, problems };
  }
  if (stated === null) {
    fail("missing", "no counts and no stated rate");
    return { value: null, problems };
  }
  return problems.length ? { value: null, problems } : { value: { rate: round4(stated), cohort: null, retained: null, method: "extracted" }, problems };
}

/* ------------------------------------------------------------------ */
/* B4–B11: the graduation grid                                         */
/* ------------------------------------------------------------------ */

const COLUMNS: readonly GradAidGroup[] = ["pell", "loan_no_pell", "no_pell_no_loan", "total"];
/** Line letter → its first code in the current grid (B.401 …); the previous grid is +100. Columns are +0…+3. */
const LINES = { A: 401, B: 405, C: 409, D: 413, E: 417, F: 421, G: 425, H: 429 } as const;
type Line = keyof typeof LINES;

export interface GridLines {
  /** Line → [pell, loan_no_pell, no_pell_no_loan, total]. */
  A: number[];
  B: number[];
  C: number[];
  D: number[];
  E: number[];
  F: number[];
  G: number[];
  /** Stated six-year rates (after parseRate), null when not printed. */
  H: (number | null)[];
}

function readGrid(doc: DocumentRecord, offset: number): GridLines | null {
  const get = (l: Line, i: number) => n(doc, code(LINES[l] + offset + i));
  const filled = COLUMNS.some((_, i) => get("A", i) !== null || get("C", i) !== null || get("G", i) !== null);
  if (!filled) return null;
  const lines = {} as GridLines;
  for (const l of ["A", "B", "D", "E", "F"] as const) lines[l] = COLUMNS.map((_, i) => get(l, i) ?? 0);
  lines.C = COLUMNS.map((_, i) => get("C", i) ?? lines.A[i] - lines.B[i]);
  lines.G = COLUMNS.map((_, i) => get("G", i) ?? lines.D[i] + lines.E[i] + lines.F[i]);
  lines.H = COLUMNS.map((_, i) => {
    const it = doc.items[code(LINES.H + offset + i)];
    return it?.status === "passed" ? parseRate(it.v as number | string, lines.C[i] > 0 ? lines.G[i] / lines.C[i] : null) : null;
  });
  return lines;
}

/** The grid's arithmetic: C = A − B, G = D + E + F, G ≤ C, non-negative lines, groups sum to the total, H = G ÷ C. */
function gridArithmetic(g: GridLines, label: string): StudentBodyProblem[] {
  const out: StudentBodyProblem[] = [];
  const fail = (check: StudentBodyProblem["check"], detail: string) => out.push({ group: "graduation", check, detail: `${label}: ${detail}` });
  COLUMNS.forEach((col, i) => {
    if (!near(g.A[i] - g.B[i], g.C[i])) fail("rows-add-up", `${col}: A − B = ${g.A[i] - g.B[i]}, C ${g.C[i]}`);
    if (!near(g.D[i] + g.E[i] + g.F[i], g.G[i])) fail("rows-add-up", `${col}: D + E + F = ${g.D[i] + g.E[i] + g.F[i]}, G ${g.G[i]}`);
    if (g.G[i] > g.C[i]) fail("rows-add-up", `${col}: ${g.G[i]} finished of a cohort of ${g.C[i]}`);
    if ([g.D[i], g.E[i], g.F[i]].some((v) => v < 0)) fail("order", `${col}: negative completers`);
    const h = g.H[i];
    if (h !== null && g.C[i] > 0 && Math.abs(h - g.G[i] / g.C[i]) > 0.005) fail("rate-mismatch", `${col}: stated ${h}, G ÷ C ${round4(g.G[i] / g.C[i])}`);
  });
  for (const l of ["A", "B", "C", "D", "E", "F", "G"] as const) {
    const v = g[l];
    if (!near(v[0] + v[1] + v[2], v[3])) fail("rows-add-up", `line ${l}: the three groups sum to ${v[0] + v[1] + v[2]}, total ${v[3]}`);
  }
  return out;
}

const shown = (cohort: number) => cohort >= MIN_GROUP_COHORT;
const rateOf = (num: number, cohort: number) => (shown(cohort) ? round4(num / cohort) : null);

export interface GridValues {
  /** The entering fall the grid describes (edition − 6; edition − 7 when it holds the previous cohort). */
  entering_year: number;
  holdsPrevious: boolean;
  cohorts: Record<GradAidGroup, number>;
  six: Record<GradAidGroup, number | null>;
  within_4: Record<GradAidGroup, number | null>;
  within_5: Record<GradAidGroup, number | null>;
}

const byCol = <T>(f: (i: number) => T) => Object.fromEntries(COLUMNS.map((c, i) => [c, f(i)])) as Record<GradAidGroup, T>;

/** The federal graduation values a grid is compared with (the baseline school's IPEDS GR class). */
type FederalGrad = Pick<NonNullable<School["outcomes"]>, "grad_rate_pell" | "grad_rate_loan_no_pell" | "grad_rate_no_pell_no_loan" | "grad_rate_ftft" | "grad_cohorts">;
const federalRate = (f: FederalGrad | undefined, col: GradAidGroup) =>
  col === "pell" ? f?.grad_rate_pell : col === "loan_no_pell" ? f?.grad_rate_loan_no_pell : col === "no_pell_no_loan" ? f?.grad_rate_no_pell_no_loan : f?.grad_rate_ftft;

/**
 * B4–B11, all or nothing: the arithmetic of both grids; the previous grid (where filled) against IPEDS GR's class
 * (cohorts within 2%, rates within 1 point: `previous-cohort-disagrees`); a current grid equal to the previous one or
 * to IPEDS GR's class is `holds-previous-cohort` (passed, but one class older, so not newer); and the current class
 * against federal one cohort older (rates ±5 points, cohorts ±10%, shown groups only: `federal-disagrees`).
 */
export function checkGrid(doc: DocumentRecord, federal?: FederalGrad): { value: GridValues | null; problems: StudentBodyProblem[] } {
  const problems: StudentBodyProblem[] = [];
  const start = editionFallYear(doc.edition);
  let cur: GridLines | null;
  let prev: GridLines | null;
  try {
    cur = readGrid(doc, 0);
    prev = readGrid(doc, 100);
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e;
    return { value: null, problems: [{ group: "graduation", check: "item-failed", detail: e.message }] };
  }
  if (!cur || start === null) return { value: null, problems: [{ group: "graduation", check: "missing", detail: "no current grid" }] };
  problems.push(...gridArithmetic(cur, "current grid"));
  if (prev) problems.push(...gridArithmetic(prev, "previous grid"));
  const fc = federal?.grad_cohorts ?? null;
  if (prev && fc) {
    COLUMNS.forEach((col, i) => {
      const fcoh = fc[col];
      if (fcoh != null && fcoh > 0 && Math.abs(prev.C[i] - fcoh) > fcoh * 0.02) problems.push({ group: "graduation", check: "previous-cohort-disagrees", detail: `${col}: previous grid cohort ${prev.C[i]}, IPEDS GR ${fcoh}` });
      const fr = federalRate(federal, col);
      if (fr != null && prev.C[i] > 0 && Math.abs(prev.G[i] / prev.C[i] - fr) > 0.01) problems.push({ group: "graduation", check: "previous-cohort-disagrees", detail: `${col}: previous grid rate ${round4(prev.G[i] / prev.C[i])}, IPEDS GR ${fr}` });
    });
  }
  const sameAsPrevious = !!prev && COLUMNS.every((_, i) => cur.C[i] === prev.C[i] && cur.G[i] === prev.G[i]);
  const sameAsFederal =
    !!fc &&
    COLUMNS.every((col, i) => {
      const r = federalRate(federal, col);
      return fc[col] === cur.C[i] && (r == null ? !shown(cur.C[i]) : rateOf(cur.G[i], cur.C[i]) === r);
    });
  const holdsPrevious = sameAsPrevious || sameAsFederal;
  if (!holdsPrevious && federal) {
    COLUMNS.forEach((col, i) => {
      if (!shown(cur.C[i])) return;
      const fr = federalRate(federal, col);
      const r = cur.G[i] / cur.C[i];
      if (fr != null && Math.abs(r - fr) > 0.05) problems.push({ group: "graduation", check: "federal-disagrees", detail: `${col}: ${round4(r)} against federal ${fr} (over 5 points)` });
      const fcoh = fc?.[col];
      if (fcoh != null && fcoh > 0 && Math.abs(cur.C[i] - fcoh) > fcoh * 0.1) problems.push({ group: "graduation", check: "federal-disagrees", detail: `${col}: cohort ${cur.C[i]} against federal ${fcoh} (over 10%)` });
    });
  }
  const value: GridValues = {
    entering_year: start - (holdsPrevious ? 7 : 6),
    holdsPrevious,
    cohorts: byCol((i) => cur.C[i]),
    six: byCol((i) => rateOf(cur.G[i], cur.C[i])),
    within_4: byCol((i) => rateOf(cur.D[i], cur.C[i])),
    within_5: byCol((i) => rateOf(cur.D[i] + cur.E[i], cur.C[i])),
  };
  for (const col of COLUMNS) {
    const [a, b, c] = [value.within_4[col], value.within_5[col], value.six[col]];
    if (a !== null && b !== null && c !== null && !(a <= b && b <= c)) problems.push({ group: "graduation", check: "order", detail: `${col}: 4-year ${a}, 5-year ${b}, 6-year ${c}` });
  }
  return { value: problems.length ? null : value, problems };
}

/* ------------------------------------------------------------------ */
/* The value set, with lineage                                         */
/* ------------------------------------------------------------------ */

const QUOTE_MAX = 160;
const joinQuotes = (doc: DocumentRecord, codes: CdsCode[]) => {
  const q = codes.map((c) => doc.items[c]?.quote).filter(Boolean).join(" / ");
  return q.length <= QUOTE_MAX ? q : `${q.slice(0, QUOTE_MAX - 1)}…`;
};
/** A derived value's record: the first code's location and document, the quotes of the printed figures it was computed from. */
const derivedRecord = (doc: DocumentRecord, codes: CdsCode[], year: string, path: FieldPath): LineageRecord => ({
  ...lineageFromItem(doc, codes[0], { year, method: "derived", path }),
  quote: joinQuotes(doc, codes),
});

/** The degree-seeking total cells (full- and part-time, by sex), whose quotes cite B1. */
const B1_TOTAL_CODES = [104, 129, 154, 110, 135, 160].map(code);

/** Every problem found while building a college's value set, for the review queue and the build's report. */
export interface StudentBodyResult {
  found: FoundValues;
  problems: (StudentBodyProblem & { edition: string })[];
}

/**
 * The newest passed value set per group from a college's records (newest document first; a group comes from the
 * newest document where it passes), for `applyNewestGroups`. `federal` is the college's federal baseline
 * (`restoreFederal(school)`): every federal comparison is made against it.
 */
export function studentBodyFromRecord(record: CollegeRecord, federal: School): StudentBodyResult {
  const groups: FoundValues["groups"] = {};
  let graduation: FoundValues["graduation"];
  const problems: StudentBodyResult["problems"] = [];
  const fd = federal.demographics;
  const fo = federal.outcomes;
  for (const doc of [...record.documents].sort(compareDocuments)) {
    const start = editionFallYear(doc.edition);
    if (start === null) continue;
    const note = (ps: StudentBodyProblem[]) => problems.push(...ps.map((p) => ({ ...p, edition: doc.edition })));
    const fall = doc.years.fall ?? `Fall ${start}`;

    const b1 = checkB1(doc);
    if (!groups.enrollment) {
      const ps = [...b1.problems];
      const v = b1.values;
      if (v && !ps.length) {
        const men = v.degree.men!;
        const women = v.degree.women!;
        const menShare = round4(men / (men + women));
        const pt = sum([v.partTime.men, v.partTime.women, v.partTime.unknown]);
        const values = {
          "demographics.undergrad_enrollment": v.total,
          "demographics.men_share": menShare,
          "demographics.women_share": round4(1 - menShare),
          "demographics.part_time_share": round4(pt / v.total),
        };
        if (Math.abs(v.total - fd.undergrad_enrollment) > fd.undergrad_enrollment * 0.1) ps.push({ group: "enrollment", check: "federal-disagrees", detail: `${v.total} degree-seeking against federal ${fd.undergrad_enrollment} (over 10%)` });
        if (fd.men_share != null && Math.abs(menShare - fd.men_share) > 0.05) ps.push({ group: "enrollment", check: "federal-disagrees", detail: `men ${menShare} against federal ${fd.men_share}` });
        if (fd.part_time_share != null && Math.abs(values["demographics.part_time_share"] - fd.part_time_share) > 0.05) ps.push({ group: "enrollment", check: "federal-disagrees", detail: `part-time ${values["demographics.part_time_share"]} against federal ${fd.part_time_share}` });
        if (!ps.length) {
          const lineage: FoundGroup["lineage"] = {};
          lineage["demographics.undergrad_enrollment"] = derivedRecord(doc, B1_TOTAL_CODES, fall, "demographics.undergrad_enrollment");
          lineage["demographics.men_share"] = derivedRecord(doc, [code(104), code(110), code(129), code(135)], fall, "demographics.men_share");
          lineage["demographics.women_share"] = derivedRecord(doc, [code(129), code(135), code(104), code(110)], fall, "demographics.women_share");
          lineage["demographics.part_time_share"] = derivedRecord(doc, [code(110), code(135), code(160), code(104), code(129)], fall, "demographics.part_time_share");
          groups.enrollment = { key: "enrollment", year: start, values, lineage };
        }
      }
      note(ps);
    }

    if (!groups.race) {
      const b2 = checkB2(doc, b1.values);
      const ps = [...b2.problems];
      if (b2.shares && fd.racial_diversity) {
        for (const [k, v] of Object.entries(b2.shares) as [keyof RaceShares, number][]) {
          if (Math.abs(v - fd.racial_diversity[k]) > 0.05) ps.push({ group: "race", check: "federal-disagrees", detail: `${k} ${v} against federal ${fd.racial_diversity[k]}` });
        }
      }
      if (b2.shares && !ps.some((p) => p.group === "race")) {
        const shareCodes = [211, 212, 213, 214, 215, 216, 217, 218, 219, 220].map(code);
        groups.race = { key: "race", year: start, values: { "demographics.racial_diversity": b2.shares }, lineage: { "demographics.racial_diversity": derivedRecord(doc, [code(220), ...shareCodes.slice(0, 9)], fall, "demographics.racial_diversity") } };
      }
      note(ps);
    }

    if (!groups.retention && fo) {
      const r = checkRetention(doc);
      const ps = [...r.problems];
      if (r.value && fo.retention_rate != null && Math.abs(r.value.rate - fo.retention_rate) > 0.05) ps.push({ group: "retention", check: "federal-disagrees", detail: `${r.value.rate} against federal ${fo.retention_rate}` });
      if (r.value && !ps.length) {
        const year = `Entered fall ${start - 1}`;
        const rec = r.value.method === "derived" ? derivedRecord(doc, [code(2202), code(2201)], year, "outcomes.retention_rate") : lineageFromItem(doc, code(2203), { year, path: "outcomes.retention_rate" });
        groups.retention = { key: "retention", year: start - 1, values: { "outcomes.retention_rate": r.value.rate }, lineage: { "outcomes.retention_rate": rec } };
      }
      note(ps);
    }

    if (!groups.graduation && fo) {
      const g = checkGrid(doc, fo);
      note(g.problems);
      const v = g.value;
      if (v) {
        const year = `Entered fall ${v.entering_year}`;
        groups.graduation = {
          key: "graduation",
          year: v.entering_year,
          values: {
            "outcomes.grad_cohorts": v.cohorts,
            "outcomes.grad_rate_pell": v.six.pell,
            "outcomes.grad_rate_loan_no_pell": v.six.loan_no_pell,
            "outcomes.grad_rate_no_pell_no_loan": v.six.no_pell_no_loan,
            "outcomes.grad_rate_ftft": v.six.total,
          },
          lineage: { "outcomes.grad_cohorts": lineageFromItem(doc, code(412), { year, path: "outcomes.grad_cohorts" }) },
        };
        if (!graduation) {
          graduation = {
            value: { entering_year: v.entering_year, within_4: v.within_4, within_5: v.within_5 },
            lineage: derivedRecord(doc, [code(416), code(420), code(412)], year, "reported.outcomes.graduation"),
          };
        }
      }
    }
  }
  return { found: { groups, ...(graduation ? { graduation } : {}) }, problems };
}
