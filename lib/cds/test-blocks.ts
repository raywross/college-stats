/**
 * Newest everywhere for test policy and test scores (specs/data-expansion/cds-test-scores-and-policy.md, Decisions 1–2):
 * a college's newer C8 policy and C9 SAT and ACT blocks replace the dataset's own `admissions.*` values **a block at
 * a time** (never value by value, so a page never shows a federal median on a college-reported range), each replaced
 * value cited with a copy of the `reported.*` record it came from, and the previous blocks kept in
 * `admissions.federal_tests`. `restoreFederalTests` puts them back byte for byte.
 *
 * Called with one line each from `lib/newest.ts#applyNewest` and `#restoreFederal`. Also: the ⓘ's replaced value
 * (`replacedTest`), `derived.sat_total`'s inputs, and the lineage guard (`validateTests`). Pure: type-only imports plus
 * lib/score-bands.ts and lib/test-policy.ts.
 */
import type { FieldPath } from "../fields";
import type { ActBlock, FederalTests, KeptBlock, LineageRecord, PolicyBlock, SatBlock, School } from "../types";
import { MIN_SUBMITTERS, lineageFall, satTotalFromCds, submitters } from "../score-bands.ts";
import { POLICY_LABELS } from "../test-policy.ts";

type BlockKey = keyof FederalTests;
type AdmKey = keyof PolicyBlock | keyof SatBlock | keyof ActBlock;

/** Every dataset field each block replaces, in `school.admissions` order. */
export const TEST_BLOCKS: Record<BlockKey, readonly AdmKey[]> = {
  policy: ["test_policy"],
  sat: ["sat_reading_25_75", "sat_math_25_75", "sat_reading_median", "sat_math_median", "test_submission_rate_sat"],
  act: ["act_composite_25_75", "act_composite_median", "act_english_25_75", "act_math_25_75", "test_submission_rate_act"],
};

const adm = (k: AdmKey) => `admissions.${k}` as FieldPath;
const copy = (r: LineageRecord | undefined): LineageRecord | undefined => (r ? { ...r } : undefined);
const range = (p: { p25: number | null; p75: number | null } | null): [number, number] | null => (p && p.p25 !== null && p.p75 !== null ? [p.p25, p.p75] : null);

/** The fall a block's current values describe: its lineage year, else the dataset's federal admissions year. */
function currentFall(school: School, key: AdmKey): number | null {
  const rec = school.lineage?.[adm(key)];
  if (rec) return lineageFall(rec.year);
  return school.admissions.federal?.year ?? school.admissions.year;
}

/**
 * A newer block may replace the current one: newer than its fall, or the same class when the current one is a
 * hand-imported override of the same Common Data Set (the record is that document, read in full; the block then never
 * mixes the override's ranges with federal medians).
 */
function isNewer(school: School, key: AdmKey, fall: number): boolean {
  const cur = currentFall(school, key);
  if (cur === null || fall > cur) return true;
  return fall === cur && school.lineage?.[adm(key)]?.source === "cds";
}

interface Replacement {
  block: BlockKey;
  /** The new value of each field, and the `reported.*` path whose record it copies. */
  values: Partial<Record<AdmKey, unknown>>;
  from: Partial<Record<AdmKey, FieldPath>>;
  /** The record for a field with no value of its own in the CDS (a blank 50th, a blank row). */
  fallback: FieldPath;
}

/** The blocks this school's reported C8/C9 may replace now. */
function replacements(school: School): Replacement[] {
  const out: Replacement[] = [];
  const rp = school.reported?.test_policy;
  const t = school.reported?.tests;
  if (rp?.policy && isNewer(school, "test_policy", rp.cycle)) {
    out.push({ block: "policy", values: { test_policy: rp.policy }, from: { test_policy: "reported.test_policy" }, fallback: "reported.test_policy" });
  }
  if (!t) return out;
  const enrolled = school.reported?.admissions?.enrolled ?? school.admissions.enrolled;
  const sat = { r: range(t.sat_ebrw), m: range(t.sat_math), n: submitters(t.sat_submitters, t.sat_share, enrolled) };
  if (sat.r && sat.m && t.sat_share !== null && sat.n !== null && sat.n >= MIN_SUBMITTERS && isNewer(school, "sat_reading_25_75", t.year)) {
    out.push({
      block: "sat",
      values: { sat_reading_25_75: sat.r, sat_math_25_75: sat.m, sat_reading_median: t.sat_ebrw!.p50, sat_math_median: t.sat_math!.p50, test_submission_rate_sat: t.sat_share },
      from: { sat_reading_25_75: "reported.tests.sat_ebrw", sat_math_25_75: "reported.tests.sat_math", sat_reading_median: "reported.tests.sat_ebrw", sat_math_median: "reported.tests.sat_math", test_submission_rate_sat: "reported.tests.sat_share" },
      fallback: "reported.tests.sat_ebrw",
    });
  }
  const act = { c: range(t.act_composite), n: submitters(t.act_submitters, t.act_share, enrolled) };
  if (act.c && t.act_share !== null && act.n !== null && act.n >= MIN_SUBMITTERS && isNewer(school, "act_composite_25_75", t.year)) {
    out.push({
      block: "act",
      values: { act_composite_25_75: act.c, act_composite_median: t.act_composite!.p50, act_english_25_75: range(t.act_english), act_math_25_75: range(t.act_math), test_submission_rate_act: t.act_share },
      from: { act_composite_25_75: "reported.tests.act_composite", act_composite_median: "reported.tests.act_composite", act_english_25_75: "reported.tests.act_english", act_math_25_75: "reported.tests.act_math", test_submission_rate_act: "reported.tests.act_share" },
      fallback: "reported.tests.act_composite",
    });
  }
  return out;
}

/**
 * The school with its newer C8 policy and C9 SAT/ACT blocks in `admissions.*` (see the file comment). The same object
 * when nothing is newer, or when the blocks were already applied (`admissions.federal_tests` present).
 */
export function applyNewestTests(school: School): School {
  const a = school.admissions as unknown as Record<string, unknown>;
  if (school.admissions.federal_tests) return school;
  const reps = replacements(school);
  if (!reps.length) return school;

  const oldLineage = school.lineage ?? {};
  const lineage: Partial<Record<FieldPath, LineageRecord>> = { ...oldLineage };
  const values: Record<string, unknown> = {};
  const kept: FederalTests = {};
  let prevRecord: LineageRecord | undefined;

  for (const r of reps) {
    const block: Record<string, unknown> = {};
    const records: Record<string, LineageRecord> = {};
    for (const k of TEST_BLOCKS[r.block]) {
      const next = r.values[k] ?? null;
      // A field absent before stays absent when the CDS has nothing for it either.
      if (!(k in a) && next === null) continue;
      if (k in a) block[k] = a[k];
      const prev = oldLineage[adm(k)];
      if (prev) {
        records[k] = { ...prev };
        prevRecord ??= prev;
      }
      values[k] = next;
      const rec = copy(oldLineage[r.from[k]!]) ?? copy(oldLineage[r.fallback]);
      if (rec) lineage[adm(k)] = rec;
    }
    const year = (() => {
      const rec = oldLineage[adm(TEST_BLOCKS[r.block][0])];
      return rec ? lineageFall(rec.year) : null;
    })();
    (kept as Record<string, unknown>)[r.block] = { year, ...block, ...(Object.keys(records).length ? { records } : {}) };
  }

  const admissions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) admissions[k] = k in values ? values[k] : v;
  for (const [k, v] of Object.entries(values)) if (!(k in admissions)) admissions[k] = v;
  admissions.federal_tests = kept;
  if (prevRecord) lineage["admissions.federal_tests"] = { ...prevRecord };
  return { ...school, admissions: admissions as School["admissions"], lineage };
}

/** Undoes `applyNewestTests` exactly; the same object when there's nothing to undo. */
export function restoreFederalTests(school: School): School {
  const kept = school.admissions.federal_tests;
  if (!kept) return school;
  const admissions = { ...school.admissions } as Record<string, unknown>;
  delete admissions.federal_tests;
  const lineage: Partial<Record<FieldPath, LineageRecord>> = { ...(school.lineage ?? {}) };
  delete lineage["admissions.federal_tests"];
  for (const b of Object.keys(kept) as BlockKey[]) {
    const block = kept[b] as KeptBlock<Record<string, unknown>> | undefined;
    if (!block) continue;
    for (const k of TEST_BLOCKS[b]) {
      if (k in block) admissions[k] = block[k];
      else delete admissions[k];
      const rec = block.records?.[k];
      if (rec) lineage[adm(k)] = rec;
      else delete lineage[adm(k)];
    }
  }
  if (Object.keys(lineage).length) return { ...school, admissions: admissions as School["admissions"], lineage };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- no lineage left: drop the key, as before the apply
  const { lineage: _lineage, ...rest } = school;
  return { ...rest, admissions: admissions as School["admissions"] };
}

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

const BLOCK_OF: Partial<Record<FieldPath, [BlockKey, AdmKey]>> = Object.fromEntries(
  (Object.keys(TEST_BLOCKS) as BlockKey[]).flatMap((b) => TEST_BLOCKS[b].map((k) => [adm(k), [b, k]]))
);

function formatKept(k: AdmKey, v: unknown): string {
  if (v === null || v === undefined) return "not reported";
  if (k === "test_policy") return POLICY_LABELS[v as keyof typeof POLICY_LABELS] ?? String(v);
  if (Array.isArray(v)) return `${v[0]}–${v[1]}`;
  if (k.startsWith("test_submission_rate")) return `${Math.round((v as number) * 100)}%`;
  return String(v);
}

/**
 * For a test value a newer CDS replaced: the previous value, formatted, and the year it described (null = the dataset's
 * IPEDS ADM release; lineage.ts fills it in), for the ⓘ ("Federal data, fall 2024: Test-optional").
 */
export function replacedTest(path: FieldPath, school: School | undefined): { value: number | null; year: string | null; text: string } | null {
  const at = BLOCK_OF[path];
  const kept = at && school?.admissions.federal_tests?.[at[0]];
  if (!at || !kept || school?.lineage?.[path]?.source !== "college-site") return null;
  const block = kept as KeptBlock<Record<string, unknown>>;
  const v = block[at[1]];
  const rec = block.records?.[at[1]];
  // A value with no record of its own was the field's default source: the dataset's IPEDS ADM release (null here).
  return { value: typeof v === "number" ? v : null, year: rec?.year ?? null, text: formatKept(at[1], v) };
}

/** The inputs `derived.sat_total` used: the college's own total, or the sum of sections. */
export function satTotalInputs(school: School | undefined): FieldPath[] {
  return school && satTotalFromCds(school) ? ["reported.tests.sat_composite"] : ["derived.sat_composite"];
}

/* ------------------------------------------------------------------ */
/* Guard (validateSchool)                                              */
/* ------------------------------------------------------------------ */

/**
 * Lineage guard for the replaced blocks: every `admissions.*` test value cited to the college is extracted (or derived)
 * with quote, URL, date, and year; such a value means `admissions.federal_tests` holds its block; within a replaced
 * block every non-null value is cited to the college (no federal median inside a CDS block); the reported cycle is
 * after the replaced federal policy's fall; "required-some" appears only with a college-site record.
 */
export function validateTests(school: School, where: string): string[] {
  const errors: string[] = [];
  const a = school.admissions as unknown as Record<string, unknown>;
  const kept = school.admissions.federal_tests;
  for (const b of Object.keys(TEST_BLOCKS) as BlockKey[]) {
    for (const k of TEST_BLOCKS[b]) {
      const path = adm(k);
      const rec = school.lineage?.[path];
      if (rec?.source === "college-site") {
        if (rec.method !== "extracted" && rec.method !== "derived") errors.push(`${where}: ${path} cites the college's site, so it must be extracted or derived`);
        if (!rec.quote || !rec.url || !rec.retrieved || !rec.year) errors.push(`${where}: ${path} cites the college's site but lacks quote, url, retrieved, or year`);
        if (!kept?.[b]) errors.push(`${where}: ${path} cites the college's site, but admissions.federal_tests.${b} doesn't keep the block it replaced`);
      }
      if (kept?.[b] && a[k] !== null && a[k] !== undefined && rec?.source !== "college-site") {
        errors.push(`${where}: ${path} is inside a replaced ${b} block but isn't cited to the college's Common Data Set`);
      }
    }
  }
  const rp = school.reported?.test_policy;
  if (rp && kept?.policy) {
    const fall = kept.policy.year ?? school.admissions.federal?.year ?? school.admissions.year;
    if (fall !== null && rp.cycle <= fall) errors.push(`${where}: reported.test_policy.cycle ${rp.cycle} isn't after the federal policy's fall ${fall}`);
  }
  if (school.admissions.test_policy === "required-some" && school.lineage?.["admissions.test_policy"]?.source !== "college-site") {
    errors.push(`${where}: admissions.test_policy "required-some" comes only from a college's Common Data Set`);
  }
  return errors;
}
