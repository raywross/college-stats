/**
 * The Requirements Grid's test policy, newest wins (specs/data-expansion/common-app.md "Store"). Driven entirely by
 * the `apply` block on the school, so it runs inside lib/cds/test-blocks.ts `applyNewestTests` right after the CDS
 * blocks: every path that restores and re-applies the newest test values (lib/newest.ts, lib/reported-merge.ts, so
 * `npm run merge-reported`, `npm run sync-data`, `npm run merge-common-app`) gets the same result, and
 * `restoreFederalTests` undoes it like any other replaced block. The lineage guard (`validateTests`) checks a value
 * cited to `common-app` against the stored grid code. Pure.
 */
import type { FieldPath } from "../fields";
import type { LineageRecord, School, TestPolicyAnswer } from "../types";
import type { GridTestCode } from "./types";

/** The only commonapp.org URL the site may show or cite (tests/common-app-guards.test.mts). */
export const COMMON_APP_HOME = "https://www.commonapp.org";

/**
 * N never required → considered (test-optional); I ignored → not-considered (test-blind); A always required and
 * F flexible → required (`apply.test_policy.code` keeps F, so the card can say "flexible"); S sometimes required →
 * required-some.
 */
export const GRID_POLICY: Record<GridTestCode, TestPolicyAnswer> = {
  N: "considered",
  I: "not-considered",
  A: "required",
  F: "required",
  S: "required-some",
};

/** The fall a grid cycle's applicants enter: "2026-27" → 2027. Null for text that isn't a cycle. */
export function gridCycleFall(cycle: string | null | undefined): number | null {
  const m = /^(\d{4})[-–](\d{2}|\d{4})$/.exec(cycle?.trim() ?? "");
  return m ? Number(m[1]) + 1 : null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** An ISO date in words: "September 25, 2026". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`common-app: "${iso}" isn't an ISO date`);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The grid vintage text, "{cycle} cycle, updated {Month D, YYYY}", from an edition's cycle and stamp. */
export function gridVintage(edition: { cycle: string; updated: string }): string {
  return `${edition.cycle} cycle, updated ${longDate(edition.updated)}`;
}

/**
 * The as-of date of a CDS edition ("2025–26" or "2025-26"): its publication date, taken as January 1 of the edition's
 * second year (an edition is published during its academic year); null for text that isn't an edition. Never a
 * record's `retrieved` date: that is when Quad read the CDS, which says nothing about which statement is newer. The
 * one rule for every grid-vs-CDS comparison (the test policy here, the regular deadline in lib/common-app/display.ts).
 */
export function cdsEditionAsOf(edition: string | null | undefined): string | null {
  const m = /^(\d{4})[–-](\d{2})/.exec(edition ?? "");
  return m ? `${Number(m[1]) + 1}-01-01` : null;
}

/** The as-of date of the college's CDS test policy (C8): its edition's (`cdsEditionAsOf`); null without an edition. */
export function cdsPolicyAsOf(school: School): string | null {
  return cdsEditionAsOf(school.lineage?.["reported.test_policy"]?.edition);
}

export type PolicyVerdict = "grid" | "cds-newer" | "no-grid";

/**
 * Whether the school's grid policy (`apply.test_policy`, from the edition `apply.common_app` names) is the newest
 * statement: against a CDS policy (`reported.test_policy.policy`), the grid's entering fall must be ≥ the CDS cycle,
 * then its stamp must be later than the CDS edition's as-of date (`cdsPolicyAsOf`); with no CDS policy the grid always
 * beats the federal (or hand-imported) value. "no-grid" without a grid row.
 */
export function gridPolicyVerdict(school: School): PolicyVerdict {
  const ca = school.apply?.common_app;
  const fall = gridCycleFall(ca?.cycle);
  if (!school.apply?.test_policy || !ca?.updated || !ca.retrieved || fall === null) return "no-grid";
  const rp = school.reported?.test_policy;
  if (!rp?.policy) return "grid";
  if (fall < rp.cycle) return "cds-newer";
  const asOf = cdsPolicyAsOf(school);
  return asOf === null || ca.updated > asOf ? "grid" : "cds-newer";
}

/** The lineage record on a test policy the grid supplied: the edition's vintage text, the homepage, the read date. */
export function gridPolicyRecord(edition: { cycle: string; updated: string; retrieved: string }): LineageRecord {
  return { source: "common-app", year: gridVintage(edition), url: COMMON_APP_HOME, retrieved: edition.retrieved };
}

/** Lineage records other steps pin to the front, then the identity records (lib/identity.ts placeIdentityLineage). */
const PINNED = (k: string) => k === "directories" || k === "lgbtq.policies" || /^(links|social|brand)\./.test(k);

/**
 * Lineage with `records` added: a key already there keeps its place; a new one goes right after the pinned front
 * records and the identity block, a place no other pipeline moves (the CCCU flag and `reported.*` records are
 * re-appended at the end by their merges), so every merge order leaves the same bytes.
 */
export function placeLineageRecords(lineage: Partial<Record<FieldPath, LineageRecord>>, records: [FieldPath, LineageRecord][]): Partial<Record<FieldPath, LineageRecord>> {
  const entries = Object.entries(lineage) as [FieldPath, LineageRecord][];
  const fresh = records.filter(([k]) => !(k in lineage));
  let at = 0;
  while (at < entries.length && PINNED(entries[at][0])) at++;
  const out = Object.fromEntries([...entries.slice(0, at), ...fresh, ...entries.slice(at)]) as Partial<Record<FieldPath, LineageRecord>>;
  for (const [k, v] of records) out[k] = v;
  return out;
}

/**
 * The school with its grid policy in `admissions.test_policy` when the grid is the newest statement (see
 * `gridPolicyVerdict`); the same object otherwise. The replaced block is kept in `admissions.federal_tests.policy`
 * the way applyNewestTests keeps it: when a CDS policy already replaced the federal one, that federal block is already
 * kept and stays; otherwise the current value and its record become the kept block (with `admissions.federal_tests`
 * appended last, as the CDS does), and the record also goes on `lineage["admissions.federal_tests"]`.
 */
export function applyGridPolicy(school: School): School {
  if (gridPolicyVerdict(school) !== "grid") return school;
  const { code } = school.apply!.test_policy!;
  const ca = school.apply!.common_app;
  const a = school.admissions as unknown as Record<string, unknown>;
  const oldLineage = school.lineage ?? {};
  const records: [FieldPath, LineageRecord][] = [];
  const kept = { ...(school.admissions.federal_tests ?? {}) };
  if (!kept.policy) {
    const prev = oldLineage["admissions.test_policy"];
    const fall = prev ? /(\d{4})/.exec(prev.year ?? "") : null;
    kept.policy = {
      year: fall ? Number(fall[1]) : null,
      ...("test_policy" in a ? { test_policy: school.admissions.test_policy } : {}),
      ...(prev ? { records: { test_policy: { ...prev } } } : {}),
    };
    if (prev && !oldLineage["admissions.federal_tests"]) records.push(["admissions.federal_tests", { ...prev }]);
  }
  records.unshift(["admissions.test_policy", gridPolicyRecord({ cycle: ca.cycle!, updated: ca.updated!, retrieved: ca.retrieved! })]);
  const admissions: Record<string, unknown> = { ...a, test_policy: GRID_POLICY[code] };
  delete admissions.federal_tests;
  admissions.federal_tests = kept;
  return { ...school, admissions: admissions as School["admissions"], lineage: placeLineageRecords(oldLineage, records) };
}
