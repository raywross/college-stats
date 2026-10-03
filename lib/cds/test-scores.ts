/**
 * CDS C8/C9 → `school.reported` (specs/data-expansion/cds-test-scores-and-policy.md, Store and Keep history?): the
 * coming cycle's test policy from C8, the entering class's C9 scores (composite and section percentiles, score bands,
 * share and number submitting), the policy events, each with an `extracted` lineage record. Only `passed` items reach
 * here. `mergeTestScores` is called once per school by `lib/reported-merge.ts#mergeReported`; the newest-everywhere
 * replacement of the dataset's own fields is `lib/cds/test-blocks.ts`.
 *
 * Pure module: type-only imports plus lib/cds-records.ts and lib/cds-sections.ts.
 */
import type { FieldPath } from "../fields";
import type { Bands6, BandTest, LineageRecord, Pct3, ReportedData, ReportedTestPolicy, ReportedTests, School, TestPolicy, TestPolicyAnswer } from "../types";
import type { CdsCode, CollegeRecord, DocumentRecord } from "../cds-sections.ts";
import { compareDocuments, editionFallYear, itemBoolean, itemNumber, itemShare, itemText, lineageFromItem, passedItem } from "../cds-records.ts";
import { headlinePolicy, policyFromText, testPolicyEvents, type CyclePolicy } from "../test-policy.ts";
import { lineageFall, normalizeBandColumn } from "../score-bands.ts";

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

export const C8 = { uses: "C.801", sat_or_act: "C.802", act_only: "C.803", sat_only: "C.804", note: "C.8F" } as const;
const GRID = [C8.uses, C8.sat_or_act, C8.act_only, C8.sat_only];

export const C9 = {
  sat_share: "C.901",
  act_share: "C.902",
  sat_submitters: "C.903",
  act_submitters: "C.904",
} as const;

/** Percentile rows: [25th, 50th, 75th] codes and the row's printed name (for the quote). */
export const PCT_ROWS = {
  sat_composite: { codes: ["C.905", "C.906", "C.907"], name: "SAT Composite" },
  sat_ebrw: { codes: ["C.908", "C.909", "C.910"], name: "SAT Evidence-Based Reading and Writing" },
  sat_math: { codes: ["C.911", "C.912", "C.913"], name: "SAT Math" },
  act_composite: { codes: ["C.914", "C.915", "C.916"], name: "ACT Composite" },
  act_math: { codes: ["C.917", "C.918", "C.919"], name: "ACT Math" },
  act_english: { codes: ["C.920", "C.921", "C.922"], name: "ACT English" },
  act_science: { codes: ["C.926", "C.927", "C.928"], name: "ACT Science" },
  act_reading: { codes: ["C.929", "C.930", "C.931"], name: "ACT Reading" },
} as const satisfies Record<string, { codes: readonly [CdsCode, CdsCode, CdsCode]; name: string }>;
type PctKey = keyof typeof PCT_ROWS;

/** Band columns: six codes, top band first, and the printed column name. Totals (C.938 …) are never stored. */
export const BAND_COLUMNS: Record<BandTest, { codes: readonly CdsCode[]; name: string }> = {
  sat_ebrw: { codes: ["C.932", "C.933", "C.934", "C.935", "C.936", "C.937"], name: "SAT Reading & Writing" },
  sat_math: { codes: ["C.939", "C.940", "C.941", "C.942", "C.943", "C.944"], name: "SAT Math" },
  sat_composite: { codes: ["C.946", "C.947", "C.948", "C.949", "C.950", "C.951"], name: "SAT Composite" },
  act_composite: { codes: ["C.953", "C.954", "C.955", "C.956", "C.957", "C.958"], name: "ACT Composite" },
  act_english: { codes: ["C.960", "C.961", "C.962", "C.963", "C.964", "C.965"], name: "ACT English" },
  act_math: { codes: ["C.967", "C.968", "C.969", "C.970", "C.971", "C.972"], name: "ACT Math" },
};
const BAND_NAMES: Record<BandTest, string[]> = {
  sat_ebrw: ["700–800", "600–699", "500–599", "400–499", "300–399", "200–299"],
  sat_math: ["700–800", "600–699", "500–599", "400–499", "300–399", "200–299"],
  sat_composite: ["1400–1600", "1200–1399", "1000–1199", "800–999", "600–799", "400–599"],
  act_composite: ["30–36", "24–29", "18–23", "12–17", "6–11", "below 6"],
  act_english: ["30–36", "24–29", "18–23", "12–17", "6–11", "below 6"],
  act_math: ["30–36", "24–29", "18–23", "12–17", "6–11", "below 6"],
};

/** C1's total enrolled (C.118): the number-submitting check needs the same document's passed C1. */
const C1_ENROLLED = "C.118";

const QUOTE_MAX = 160;
const trimQuote = (q: string) => (q.length <= QUOTE_MAX ? q : `${q.slice(0, QUOTE_MAX - 1)}…`);
const NOTE_MAX = 500;

/* ------------------------------------------------------------------ */
/* C8                                                                  */
/* ------------------------------------------------------------------ */

/** The C8 cycle a document states ("Fall 2027 applicants" → 2027), when it is the edition's start + 2 (Checks, Cycle). */
export function policyCycle(doc: DocumentRecord): number | null {
  const cycle = lineageFall(doc.years["test-policy-cycle"]);
  const start = editionFallYear(doc.edition);
  return cycle !== null && start !== null && cycle === start + 2 ? cycle : null;
}

function answer(doc: DocumentRecord, code: CdsCode): TestPolicyAnswer | null {
  return policyFromText(itemText(doc, code));
}

/** One document's C8 grid, or null when it has no passed grid or its cycle is wrong. */
export function policyFromDocument(doc: DocumentRecord): ReportedTestPolicy | null {
  const cycle = policyCycle(doc);
  if (cycle === null) return null;
  const g = { uses_tests: itemBoolean(doc, C8.uses), sat_or_act: answer(doc, C8.sat_or_act), act_only: answer(doc, C8.act_only), sat_only: answer(doc, C8.sat_only) };
  if (g.uses_tests === null && !g.sat_or_act && !g.act_only && !g.sat_only) return null;
  const policy = headlinePolicy(g);
  // C8A agrees with the grid: "says tests are used, marks them not considered" never publishes.
  if (g.uses_tests === true && policy === "not-considered") return null;
  if (!policy && !g.act_only && !g.sat_only) return null;
  return { cycle, ...g, policy };
}

/* ------------------------------------------------------------------ */
/* C9                                                                  */
/* ------------------------------------------------------------------ */

/** The C9 entering fall ("Fall 2025" → 2025), when it is the edition's start year. */
export function scoresYear(doc: DocumentRecord): number | null {
  const year = lineageFall(doc.years.fall);
  return year !== null && year === editionFallYear(doc.edition) ? year : null;
}

const fmt = (v: number | null) => (v === null ? "–" : String(v));

function pct3(doc: DocumentRecord, key: PctKey): Pct3 | null {
  const [a, b, c] = PCT_ROWS[key].codes;
  const p = { p25: itemNumber(doc, a), p50: itemNumber(doc, b), p75: itemNumber(doc, c) };
  // A row needs its 25th and 75th; order 25th ≤ 50th ≤ 75th (a missing 50th is allowed).
  if (p.p25 === null || p.p75 === null || p.p25 > p.p75) return null;
  if (p.p50 !== null && (p.p50 < p.p25 || p.p50 > p.p75)) return null;
  return p;
}

function bands(doc: DocumentRecord, test: BandTest): Bands6 | null {
  const codes = BAND_COLUMNS[test].codes;
  // A cell that failed its checks poisons the column; blanks in a filled column are 0.
  if (codes.some((c) => doc.items[c]?.status === "failed")) return null;
  return normalizeBandColumn(codes.map((c) => itemNumber(doc, c)));
}

/** True when a document has any passed C9 value. */
function hasScores(doc: DocumentRecord): boolean {
  return [...Object.values(C9), ...Object.values(PCT_ROWS).flatMap((r) => r.codes)].some((c) => passedItem(doc, c));
}

/** One document's C9 block (no lineage), or null when it has none or its year is wrong. */
export function testsFromDocument(doc: DocumentRecord): ReportedTests | null {
  const year = scoresYear(doc);
  if (year === null || !hasScores(doc)) return null;
  // Number submitting is shown only beside the same document's passed C1 enrolled, and never above it.
  const enrolled = itemNumber(doc, C1_ENROLLED);
  const count = (code: CdsCode) => {
    const n = itemNumber(doc, code);
    return n !== null && enrolled !== null && Number.isInteger(n) && n >= 0 && n <= enrolled ? n : null;
  };
  const share = (code: CdsCode) => {
    const s = itemShare(doc, code);
    return s === null ? null : Math.round(Math.min(1, s) * 10000) / 10000;
  };
  return {
    year,
    sat_share: share(C9.sat_share),
    act_share: share(C9.act_share),
    sat_submitters: count(C9.sat_submitters),
    act_submitters: count(C9.act_submitters),
    sat_composite: pct3(doc, "sat_composite"),
    sat_ebrw: pct3(doc, "sat_ebrw"),
    sat_math: pct3(doc, "sat_math"),
    act_composite: pct3(doc, "act_composite"),
    act_math: pct3(doc, "act_math"),
    act_english: pct3(doc, "act_english"),
    act_science: pct3(doc, "act_science"),
    act_reading: pct3(doc, "act_reading"),
    bands: {
      sat_ebrw: bands(doc, "sat_ebrw"),
      sat_math: bands(doc, "sat_math"),
      sat_composite: bands(doc, "sat_composite"),
      act_composite: bands(doc, "act_composite"),
      act_english: bands(doc, "act_english"),
      act_math: bands(doc, "act_math"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Lineage                                                             */
/* ------------------------------------------------------------------ */

type Lineage = Partial<Record<FieldPath, LineageRecord>>;

/** The record for a value read from one or more codes: the first passed one's place, with `quote` when given. */
function cite(doc: DocumentRecord, codes: readonly CdsCode[], year: string, quote?: string): LineageRecord {
  const first = codes.find((c) => passedItem(doc, c)?.quote) ?? codes.find((c) => passedItem(doc, c));
  if (!first) throw new Error(`${doc.url}: none of ${codes.join(", ")} passed`);
  const rec = lineageFromItem(doc, first, { year });
  return quote ? { ...rec, quote: trimQuote(quote) } : rec;
}

const pctOf = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Lineage for every stored C9 value: percentile rows quoted "SAT Composite | 1370 | 1460 | 1530", bands by column. */
function testsLineage(doc: DocumentRecord, t: ReportedTests): Lineage {
  const year = doc.years.fall!;
  const yearCodes: CdsCode[] = [...Object.values(C9), ...PCT_ROWS.sat_composite.codes, ...PCT_ROWS.act_composite.codes];
  const out: Lineage = { "reported.tests.year": cite(doc, yearCodes, year) };
  for (const k of ["sat_share", "act_share", "sat_submitters", "act_submitters"] as const) {
    if (t[k] !== null) out[`reported.tests.${k}`] = cite(doc, [C9[k]], year);
  }
  for (const k of Object.keys(PCT_ROWS) as PctKey[]) {
    const p = t[k];
    if (!p) continue;
    out[`reported.tests.${k}` as FieldPath] = cite(doc, PCT_ROWS[k].codes, year, `${PCT_ROWS[k].name} | ${fmt(p.p25)} | ${fmt(p.p50)} | ${fmt(p.p75)}`);
  }
  for (const k of Object.keys(BAND_COLUMNS) as BandTest[]) {
    const b = t.bands[k];
    if (!b) continue;
    const quote = `${BAND_COLUMNS[k].name}: ${b.map((v, i) => `${BAND_NAMES[k][i]} ${pctOf(v)}`).join(", ")}`;
    out[`reported.tests.bands.${k}` as FieldPath] = cite(doc, BAND_COLUMNS[k].codes, year, quote);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Record → school.reported                                            */
/* ------------------------------------------------------------------ */

export interface ReportedTestsPatch {
  reported: Pick<ReportedData, "test_policy" | "test_policy_note" | "test_policy_events" | "tests">;
  lineage: Lineage;
}

/**
 * A college's newest passed C8 and C9 (each from the newest document that has one), its C8F note, and its policy events
 * across every document plus the federal value (`federal`: the policy the dataset held before any CDS, and the fall it
 * describes). Null when the record has neither C8 nor C9.
 */
export function reportedTestsFromRecord(record: CollegeRecord, federal: { policy: TestPolicy; year: number | null } | null): ReportedTestsPatch | null {
  const docs = [...record.documents].sort(compareDocuments);
  const reported: ReportedTestsPatch["reported"] = {};
  const lineage: Lineage = {};

  const policies = docs.flatMap((doc) => {
    const p = policyFromDocument(doc);
    return p ? [{ doc, p }] : [];
  });
  const newest = policies[0];
  /** The grid as quoted: "For students applying for Fall 2027: SAT or ACT: Required to be considered for admission". */
  const gridRecord = (doc: DocumentRecord, p: ReportedTestPolicy) =>
    cite(
      doc,
      GRID,
      doc.years["test-policy-cycle"]!,
      `For students applying for Fall ${p.cycle}: ${[
        p.sat_or_act && `SAT or ACT: ${itemText(doc, C8.sat_or_act)}`,
        !p.sat_or_act && p.sat_only && `SAT Only: ${itemText(doc, C8.sat_only)}`,
        !p.sat_or_act && p.act_only && `ACT Only: ${itemText(doc, C8.act_only)}`,
        !p.sat_or_act && !p.sat_only && !p.act_only && `Uses SAT or ACT: ${p.uses_tests ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("; ")}`
    );
  if (newest) {
    const { doc, p } = newest;
    const year = doc.years["test-policy-cycle"]!;
    reported.test_policy = p;
    lineage["reported.test_policy"] = gridRecord(doc, p);
    const note = itemText(doc, C8.note)?.trim();
    if (note) {
      reported.test_policy_note = note.length <= NOTE_MAX ? note : `${note.slice(0, NOTE_MAX - 1)}…`;
      lineage["reported.test_policy_note"] = cite(doc, [C8.note], year);
    }
    const cycles: CyclePolicy[] = policies.flatMap(({ p: q }) => (q.policy ? [{ cycle: q.cycle, policy: q.policy }] : []));
    // Federal → CDS only when no earlier CDS edition was read: testPolicyEvents compares federal with the oldest one.
    const events = testPolicyEvents(cycles, federal);
    if (events.length) {
      reported.test_policy_events = events;
      // Cited to the newest event's newer document.
      const last = events[events.length - 1];
      const src = policies.find(({ p: q }) => q.cycle === last.cycle) ?? newest;
      lineage["reported.test_policy_events"] = gridRecord(src.doc, src.p);
    }
  }

  for (const doc of docs) {
    const t = testsFromDocument(doc);
    if (!t) continue;
    reported.tests = t;
    Object.assign(lineage, testsLineage(doc, t));
    break;
  }

  return reported.test_policy || reported.tests ? { reported, lineage } : null;
}

/**
 * The school with its record's C8/C9 in `school.reported` and their lineage (call on a stripped school, before
 * `applyNewest`, which then replaces the dataset's own blocks). `federalPolicyYear` is the fall the dataset's IPEDS ADM
 * release describes, for the federal → CDS event. The same object when the college has no record or nothing passed.
 */
export function mergeTestScores(school: School, record: CollegeRecord | undefined, federalPolicyYear: number | null): School {
  if (!record) return school;
  const rec = school.lineage?.["admissions.test_policy"];
  const federal = { policy: school.admissions.test_policy ?? null, year: rec ? lineageFall(rec.year) : federalPolicyYear };
  const patch = reportedTestsFromRecord(record, federal);
  if (!patch) return school;
  return {
    ...school,
    reported: { ...(school.reported ?? {}), ...patch.reported },
    lineage: { ...(school.lineage ?? {}), ...patch.lineage },
  };
}
