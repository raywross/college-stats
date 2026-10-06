/**
 * Field-level accuracy of profile extraction against the hand-read answer key
 * (data/reference/hs-profile-answer-key.json). Pure.
 *
 * Each field of each key school scores one of: correct (the extraction matches the key), both-null (neither has a
 * value: the model rightly left it out), wrong (both have a value and they differ), missed (the key has a value, the
 * extraction none), spurious (the extraction has a value the profile doesn't print). Accuracy = (correct + both-null)
 * ÷ scored. Matching rules: numbers exact; GPA scale by kind, max and weighting; a distribution by band count and every
 * share within 0.011; course lists and matriculation names by F1 ≥ 0.9 of normalized names (matriculation also needs
 * 90% of the shared names' counts equal).
 */
import type { GpaKind } from "./extract.mts";

export interface KeyValues {
  class_size: number | null;
  gpa_scale: { kind: GpaKind; max: number | null; weighted: boolean } | null;
  gpa_distribution: { band: string; share: number }[] | null;
  ap_courses: string[] | null;
  ib_courses: string[] | null;
  sat_mid50: [number, number] | null;
  act_mid50: [number, number] | null;
  matriculation: { classes: string; entries: { name: string; count: number | null }[] } | null;
}

export interface AnswerKeySchool extends KeyValues {
  id: string;
  name: string;
  url: string;
  edition: string;
  notes?: string;
}

export interface AnswerKeyFile {
  read: string;
  method: string;
  schools: AnswerKeySchool[];
}

export const SCORED_FIELDS = ["class_size", "gpa_scale", "gpa_distribution", "ap_courses", "ib_courses", "sat_mid50", "act_mid50", "matriculation"] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];
export type Outcome = "correct" | "both-null" | "wrong" | "missed" | "spurious";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(ap|ib|advanced placement|the|hl|sl)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function f1(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a.map(norm).filter(Boolean));
  const B = new Set(b.map(norm).filter(Boolean));
  if (!A.size && !B.size) return 1;
  const both = [...A].filter((x) => B.has(x)).length;
  if (!both) return 0;
  const p = both / B.size;
  const r = both / A.size;
  return (2 * p * r) / (p + r);
}

function same(field: ScoredField, key: KeyValues, got: KeyValues): boolean {
  switch (field) {
    case "class_size":
      return key.class_size === got.class_size;
    case "gpa_scale":
      return key.gpa_scale!.kind === got.gpa_scale!.kind && key.gpa_scale!.max === got.gpa_scale!.max && key.gpa_scale!.weighted === got.gpa_scale!.weighted;
    case "gpa_distribution": {
      const k = key.gpa_distribution!;
      const g = got.gpa_distribution!;
      return k.length === g.length && k.every((b, i) => Math.abs(b.share - g[i].share) <= 0.011);
    }
    case "ap_courses":
    case "ib_courses":
      return f1(key[field]!, got[field]!) >= 0.9;
    case "sat_mid50":
    case "act_mid50":
      return key[field]![0] === got[field]![0] && key[field]![1] === got[field]![1];
    case "matriculation": {
      const k = key.matriculation!.entries;
      const g = got.matriculation!.entries;
      if (f1(k.map((e) => e.name), g.map((e) => e.name)) < 0.9) return false;
      const gm = new Map(g.map((e) => [norm(e.name), e.count]));
      const shared = k.filter((e) => gm.has(norm(e.name)));
      const equal = shared.filter((e) => gm.get(norm(e.name)) === e.count).length;
      return shared.length > 0 && equal / shared.length >= 0.9;
    }
  }
}

export function scoreField(field: ScoredField, key: KeyValues, got: KeyValues): Outcome {
  const k = key[field];
  const g = got[field];
  const has = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
  if (!has(k) && !has(g)) return "both-null";
  if (!has(k)) return "spurious";
  if (!has(g)) return "missed";
  return same(field, key, got) ? "correct" : "wrong";
}

export interface FieldScore {
  scored: number;
  correct: number;
  both_null: number;
  wrong: number;
  missed: number;
  spurious: number;
  accuracy: number | null;
}

export interface AccuracyReport {
  schools: number;
  fields: Record<ScoredField, FieldScore>;
  overall: number | null;
  /** Mean F1 of the course lists and matriculation names where both sides list something. */
  mean_f1: { ap_courses: number | null; ib_courses: number | null; matriculation: number | null };
  per_school: { id: string; outcomes: Record<ScoredField, Outcome> }[];
}

export function scoreAgainstKey(key: readonly AnswerKeySchool[], extracted: ReadonlyMap<string, KeyValues>): AccuracyReport {
  const zero = (): FieldScore => ({ scored: 0, correct: 0, both_null: 0, wrong: 0, missed: 0, spurious: 0, accuracy: null });
  const fields = Object.fromEntries(SCORED_FIELDS.map((f) => [f, zero()])) as Record<ScoredField, FieldScore>;
  const f1s: Record<"ap_courses" | "ib_courses" | "matriculation", number[]> = { ap_courses: [], ib_courses: [], matriculation: [] };
  const per_school: AccuracyReport["per_school"] = [];
  for (const k of key) {
    const got = extracted.get(k.id);
    if (!got) continue;
    const outcomes = {} as Record<ScoredField, Outcome>;
    for (const f of SCORED_FIELDS) {
      const o = scoreField(f, k, got);
      outcomes[f] = o;
      const s = fields[f];
      s.scored++;
      if (o === "correct") s.correct++;
      else if (o === "both-null") s.both_null++;
      else if (o === "wrong") s.wrong++;
      else if (o === "missed") s.missed++;
      else s.spurious++;
    }
    for (const f of ["ap_courses", "ib_courses"] as const) if (k[f]?.length && got[f]?.length) f1s[f].push(f1(k[f]!, got[f]!));
    if (k.matriculation?.entries.length && got.matriculation?.entries.length) f1s.matriculation.push(f1(k.matriculation.entries.map((e) => e.name), got.matriculation.entries.map((e) => e.name)));
    per_school.push({ id: k.id, outcomes });
  }
  let num = 0;
  let den = 0;
  for (const f of SCORED_FIELDS) {
    const s = fields[f];
    s.accuracy = s.scored ? Math.round(((s.correct + s.both_null) / s.scored) * 1000) / 1000 : null;
    num += s.correct + s.both_null;
    den += s.scored;
  }
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);
  return {
    schools: per_school.length,
    fields,
    overall: den ? Math.round((num / den) * 1000) / 1000 : null,
    mean_f1: { ap_courses: mean(f1s.ap_courses), ib_courses: mean(f1s.ib_courses), matriculation: mean(f1s.matriculation) },
    per_school,
  };
}
