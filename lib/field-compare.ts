/**
 * Compare "Your major" by broad field (specs/data-expansion/majors.md, field-of-study.md): one 2-digit CIP family
 * ("11", computer science) compared across colleges. Broad fields, not 4- or 6-digit programs, because colleges carve
 * up a field differently (one reports "Computer Science", another "Computer and Information Sciences, General"), so
 * the family is what compares like with like. Pure and client-safe: titles come in through `title` (lib/cip.ts on the
 * server).
 */
import type { School } from "./types";
import type { ProgramEarnings } from "./field-of-study";
import { programsFromRows, type MajorRows } from "./majors.ts";

type ShareSeries = { start: number; values: (number | null)[] } | undefined;

/** One college's numbers for the picked field. */
export interface FieldStat {
  /** First-major bachelor's in the field, newest year: 0 when the college awards none, null when majors aren't reported. */
  graduates: number | null;
  /** Share of the college's first-major bachelor's. */
  share: number | null;
  /** Second-major bachelor's in the field (double majors), from the detail file. */
  secondMajors: number | null;
  /** Programs (6-digit CIP) with at least one bachelor's in the field. */
  programCount: number | null;
  /** Largest programs by first majors (up to 3). */
  topPrograms: { title: string; graduates: number }[];
  /** Share of bachelor's 10 years earlier (or up to 2 years later when that year is missing) and now, from history. */
  shareChange: { from: { year: number; label: string; share: number }; to: { year: number; label: string; share: number } } | null;
  /**
   * Earnings and debt across the field's 4-digit programs with data, each program's median weighted by its graduates
   * (Scorecard reports medians per program, so this is a typical figure for the field, not a true median).
   */
  earnings: { y1: number | null; y4: number | null; y4National: number | null; debt: number | null; programsWithData: number; programsReported: number };
  /** The field's highest-earning program 4 years out (1 year when no 4-year figure), when 2+ programs report earnings. */
  topEarner: { title: string; value: number; years: 1 | 4 } | null;
}

const at = (s: ShareSeries, year: number): number | null => (s && year >= s.start && year < s.start + s.values.length ? s.values[year - s.start] : null);

/** Graduate-weighted mean of the non-null values (weight 1 when a program's graduate count is suppressed). */
function weighted(items: { v: number | null; w: number | null }[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const { v, w } of items) {
    if (v === null) continue;
    const ww = w && w > 0 ? w : 1;
    sum += v * ww;
    weight += ww;
  }
  return weight > 0 ? Math.round(sum / weight) : null;
}

/** Families any of these colleges award first-major bachelor's in, so the picker never offers a field none of them has. */
export function familiesOffered(schools: readonly Pick<School, "academics">[]): string[] {
  const out = new Set<string>();
  for (const s of schools) for (const [f, n] of Object.entries(s.academics?.bachelors_by_family ?? {})) if (n > 0) out.add(f);
  return [...out].sort();
}

export function fieldStat(
  family: string,
  school: Pick<School, "academics">,
  majors: MajorRows | null | undefined,
  programs: Record<string, ProgramEarnings> | null | undefined,
  series: Partial<Record<string, ShareSeries>> | null,
  window: [number, number] | null,
  title: (cip: string) => string | null,
  yearLabel: (year: number) => string = String,
): FieldStat {
  const a = school.academics;
  const reported = a?.bachelors_awarded != null && !!a.bachelors_by_family;
  const graduates = reported ? (a!.bachelors_by_family![family] ?? 0) : null;
  const share = graduates !== null && a!.bachelors_awarded ? graduates / a!.bachelors_awarded : null;

  const inField = majors ? programsFromRows(majors).filter((p) => p.cip.startsWith(`${family}.`)) : null;
  const secondMajors = inField ? inField.reduce((n, p) => n + p.second, 0) : null;
  const topPrograms = (inField ?? [])
    .filter((p) => p.first > 0)
    .sort((x, y) => y.first - x.first)
    .slice(0, 3)
    .map((p) => ({ title: title(p.cip) ?? p.cip, graduates: p.first }));

  let shareChange: FieldStat["shareChange"] = null;
  if (series && window) {
    const s = series[`major_${family}`];
    const [start, end] = window;
    const to = at(s, end);
    let from: number | null = null;
    for (let y = start; y <= start + 2 && y < end; y++) {
      if (at(s, y) !== null) {
        from = y;
        break;
      }
    }
    if (to !== null && from !== null) shareChange = { from: { year: from, label: yearLabel(from), share: at(s, from)! }, to: { year: end, label: yearLabel(end), share: to } };
  }

  const rows = Object.entries(programs ?? {}).filter(([cip4]) => cip4.startsWith(`${family}.`));
  const withData = rows.filter(([, p]) => p.earnings.y1 !== null || p.earnings.y4 !== null);
  const earnings = {
    y1: weighted(withData.map(([, p]) => ({ v: p.earnings.y1, w: p.graduates }))),
    y4: weighted(withData.map(([, p]) => ({ v: p.earnings.y4, w: p.graduates }))),
    y4National: weighted(withData.filter(([, p]) => p.earnings.y4 !== null).map(([, p]) => ({ v: p.earnings.y4_national, w: p.graduates }))),
    debt: weighted(rows.map(([, p]) => ({ v: p.debt_median, w: p.graduates }))),
    programsWithData: withData.length,
    programsReported: rows.length,
  };
  const ranked = withData
    .map(([cip4, p]) => ({ title: title(cip4) ?? p.title, value: (p.earnings.y4 ?? p.earnings.y1)!, years: (p.earnings.y4 !== null ? 4 : 1) as 1 | 4 }))
    .sort((x, y) => y.value - x.value);
  const topEarner = ranked.length >= 2 ? ranked[0] : null;

  return { graduates, share, secondMajors, programCount: inField ? inField.length : null, topPrograms, shareChange, earnings, topEarner };
}
