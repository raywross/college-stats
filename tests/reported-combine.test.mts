/**
 * Combine by term (lib/reported-combine.ts; specs/college-reported-fall-figures.md Decision 2): every document naming
 * the same entering term contributes to one funnel, each figure citing its own document; a CDS wins its term outright;
 * exact beats approximate; a rate is computed only from two exact counts; the class goal and deposits never become
 * the enrolled count. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatasetMeta, School } from "../lib/types";
import type { Extraction, StoredExtraction } from "../lib/reported";
import { combineByTerm, type Candidate } from "../lib/reported-combine.ts";
import { reportedToPatch, toReportedEntry } from "../lib/reported-checks.ts";
import { applyNewest } from "../lib/newest.ts";
import { validateSchool } from "../lib/lineage.ts";
import { miniMeta, miniSchools } from "./helpers/snapshot.mts";

const meta: DatasetMeta = miniMeta();
const schools: School[] = miniSchools();
const PRINCETON = "186131"; // federal Fall 2024: 40,468 applied, 1,868 admitted, 1,410 enrolled, 4.62%
const RUN = "run-2026-11-11";
const TODAY = "2026-11-11";

function school(): School {
  const s = structuredClone(schools.find((x) => x.unit_id === PRINCETON)!);
  delete s.reported;
  return s;
}

type Fig = "applicants" | "admitted" | "enrolled" | "acceptance_rate" | "enrollment_target" | "deposits";

/** An extraction for Fall 2026 stating `figs`; each quote prints the number (an approx one with "more than"/"about"). */
function ext(figs: Partial<Record<Fig, number>>, opts: { approx?: ("applicants" | "admitted" | "enrolled" | "acceptance_rate")[]; term?: string; cohort?: Extraction["cohort"] } = {}): Extraction {
  const e: Extraction = {
    cohort: opts.cohort ?? "first-year",
    scope: "all-rounds",
    entering_term: opts.term ?? "Fall 2026",
    applicants: null,
    admitted: null,
    enrolled: null,
    acceptance_rate: null,
    qualifiers: {},
    enrollment_target: null,
    deposits: null,
    quotes: {},
    page: null,
  };
  for (const [k, v] of Object.entries(figs) as [Fig, number][]) {
    e[k] = v;
    const approx = (opts.approx as string[] | undefined)?.includes(k);
    e.quotes[k] = k === "acceptance_rate" ? `${approx ? "about " : ""}${(v * 100).toFixed(0)}% were admitted` : `${approx ? "more than " : ""}${v.toLocaleString("en-US")} ${k.replace("_", " ")}`;
  }
  for (const k of opts.approx ?? []) e.qualifiers[k] = "approx";
  return e;
}

const MARCH = "https://news.princeton.edu/2026/03/27/princeton-offers-admission";
const JULY = "https://news.princeton.edu/2026/07/20/record-deposits";
const SEPT = "https://news.princeton.edu/2026/09/18/class-of-2030-arrives";
const CDS = "https://ir.princeton.edu/cds-2026-27.pdf";

const notice = (e: Extraction, url: string, published: string): Candidate => ({ e, url, kind: "notice", retrieved: TODAY, published });

/** The school with the entry merged in, as the sync does; validateSchool must accept it. */
function merged(entry: NonNullable<ReturnType<typeof combineByTerm>["entry"]>): School {
  const s = school();
  const { reported, lineage } = reportedToPatch(entry);
  s.reported = reported;
  s.lineage = { ...(s.lineage ?? {}), ...lineage };
  return s;
}

test("a passing CDS for the term supplies the whole funnel outright; notices for that term add nothing", () => {
  const cds: Candidate = { e: ext({ applicants: 46618, admitted: 1865, enrolled: 1500 }), url: CDS, kind: "cds", retrieved: "2027-03-01" };
  const later = notice(ext({ applicants: 46618, enrollment_target: 1400 }), SEPT, "2026-09-18");
  const { entry, failures, term } = combineByTerm([later, cds], school(), RUN, TODAY);
  assert.equal(term, "Fall 2026");
  assert.deepEqual(failures, []);
  assert.equal(entry!.admissions.source_kind, "cds");
  assert.equal(entry!.admissions.enrollment_target, undefined, "the notice's class goal isn't carried next to a CDS");
  for (const rec of Object.values(entry!.lineage)) assert.equal(rec!.url, CDS);
  assert.deepEqual(validateSchool(merged(entry!), meta), []);
});

test("two notices combine: applicants and admitted from March, enrolled from September, each citing its own page", () => {
  const march = notice(ext({ applicants: 46618, admitted: 1865 }), MARCH, "2026-03-27");
  const sept = notice(ext({ enrolled: 1500 }), SEPT, "2026-09-18");
  const { entry, failures } = combineByTerm([march, sept], school(), RUN, TODAY);
  assert.deepEqual(failures, []);
  const a = entry!.admissions;
  assert.deepEqual([a.entering_term, a.year, a.applicants, a.admitted, a.enrolled, a.source_kind], ["Fall 2026", 2026, 46618, 1865, 1500, "notice"]);
  assert.ok(Math.abs(a.acceptance_rate! - 1865 / 46618) < 1e-12, "computed from two exact counts");
  assert.equal(a.approx, undefined);
  const L = entry!.lineage;
  assert.equal(L["reported.admissions.applicants"]!.url, MARCH);
  assert.equal(L["reported.admissions.admitted"]!.url, MARCH);
  assert.equal(L["reported.admissions.enrolled"]!.url, SEPT);
  assert.equal(L["reported.admissions.enrolled"]!.quote, "1,500 enrolled");
  assert.equal(L["reported.admissions.entering_term"]!.url, MARCH, "the block cites the applicants' document");
  assert.equal(L["reported.admissions.year"]!.year, "Fall 2026");
  assert.deepEqual(new Set(Object.values(L).map((r) => r!.url)), new Set([MARCH, SEPT]));
  assert.deepEqual(validateSchool(merged(entry!), meta), []);
});

test("a rate from two documents is derived, citing both quotes", () => {
  const march = notice(ext({ applicants: 46618 }), MARCH, "2026-03-27");
  const sept = notice(ext({ admitted: 1865 }), SEPT, "2026-09-18");
  const { entry } = combineByTerm([march, sept], school(), RUN, TODAY);
  const rec = entry!.lineage["reported.admissions.acceptance_rate"]!;
  assert.equal(rec.method, "derived");
  assert.equal(rec.quote, "1,865 admitted / 46,618 applicants");
  assert.deepEqual(validateSchool(merged(entry!), meta), []);
});

test("an exact figure is preferred over a newer approximate one; an approximate one alone is kept, flagged", () => {
  const march = notice(ext({ applicants: 46618 }), MARCH, "2026-03-27");
  const sept = notice(ext({ applicants: 46000 }, { approx: ["applicants"] }), SEPT, "2026-09-18");
  const both = combineByTerm([march, sept], school(), RUN, TODAY).entry!;
  assert.equal(both.admissions.applicants, 46618);
  assert.equal(both.admissions.approx, undefined);
  assert.equal(both.lineage["reported.admissions.applicants"]!.url, MARCH);

  const alone = combineByTerm([sept], school(), RUN, TODAY).entry!;
  assert.equal(alone.admissions.applicants, 46000);
  assert.deepEqual(alone.admissions.approx, { applicants: true });
  assert.equal(alone.lineage["reported.admissions.applicants"]!.quote, "more than 46,000 applicants");
  assert.deepEqual(validateSchool(merged(alone), meta), []);

  // Two exact figures: the newer one wins (the rule is "exact first, then newest", not "oldest").
  const septExact = notice(ext({ applicants: 46620 }), SEPT, "2026-09-18");
  assert.equal(combineByTerm([march, septExact], school(), RUN, TODAY).entry!.admissions.applicants, 46620);
});

test("no rate is computed from an approximate count", () => {
  const e = ext({ applicants: 46000, admitted: 1865 }, { approx: ["applicants"] });
  const { entry } = combineByTerm([notice(e, MARCH, "2026-03-27")], school(), RUN, TODAY);
  assert.equal(entry!.admissions.acceptance_rate, null);
  assert.equal(entry!.lineage["reported.admissions.acceptance_rate"], undefined);
  // The same counts, both exact: computed.
  const exact = combineByTerm([notice(ext({ applicants: 46000, admitted: 1865 }), MARCH, "2026-03-27")], school(), RUN, TODAY);
  assert.ok(exact.entry!.admissions.acceptance_rate !== null);
});

test("a stated approximate rate is kept with its qualifier", () => {
  const e = ext({ applicants: 46000, acceptance_rate: 0.04 }, { approx: ["applicants", "acceptance_rate"] });
  const { entry, failures } = combineByTerm([notice(e, MARCH, "2026-03-27")], school(), RUN, TODAY);
  assert.deepEqual(failures, []);
  assert.equal(entry!.admissions.acceptance_rate, 0.04);
  assert.deepEqual(entry!.admissions.approx, { applicants: true, acceptance_rate: true });
  assert.equal(entry!.lineage["reported.admissions.acceptance_rate"]!.quote, "about 4% were admitted");
  // A rate stated alone, with no counts anywhere, is still the college's own words.
  const rateOnly = combineByTerm([notice(ext({ acceptance_rate: 0.04 }, { approx: ["acceptance_rate"] }), MARCH, "2026-03-27")], school(), RUN, TODAY);
  assert.equal(rateOnly.entry!.admissions.acceptance_rate, 0.04);
  assert.equal(rateOnly.entry!.admissions.source_kind, "notice");
});

test("cross-document funnel order: the later-published figure is dropped and queued as funnel-order", () => {
  const march = notice(ext({ applicants: 46618, admitted: 1865 }), MARCH, "2026-03-27");
  const sept = notice(ext({ enrolled: 1900 }), SEPT, "2026-09-18");
  const { entry, failures } = combineByTerm([march, sept], school(), RUN, TODAY);
  assert.equal(entry!.admissions.enrolled, null);
  assert.equal(entry!.admissions.admitted, 1865);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].url, SEPT);
  assert.equal(failures[0].failures[0].check, "funnel-order");
  assert.match(failures[0].failures[0].detail, /enrolled 1900 .* > admitted 1865/);
  // Published the other way round, the admitted figure is the later one and goes.
  const flipped = combineByTerm([notice(march.e, MARCH, "2026-10-01"), sept], school(), RUN, TODAY);
  assert.equal(flipped.entry!.admissions.admitted, null);
  assert.equal(flipped.entry!.admissions.enrolled, 1900);
  assert.equal(flipped.failures[0].url, MARCH);
  // In order: nothing dropped, nothing queued.
  const fine = combineByTerm([march, notice(ext({ enrolled: 1500 }), SEPT, "2026-09-18")], school(), RUN, TODAY);
  assert.deepEqual(fine.failures, []);
  assert.equal(fine.entry!.admissions.enrolled, 1500);
});

test("a class goal and deposits never become the enrolled count; the census count replaces deposits", () => {
  const july = notice(ext({ enrollment_target: 1450, deposits: 1600 }), JULY, "2026-07-20");
  const summer = combineByTerm([july], school(), RUN, TODAY).entry!;
  assert.equal(summer.admissions.enrolled, null);
  assert.equal(summer.admissions.enrollment_target, 1450);
  assert.equal(summer.admissions.deposits, 1600);
  assert.equal(summer.admissions.source_kind, "notice");
  assert.equal(summer.lineage["reported.admissions.enrollment_target"]!.quote, "1,450 enrollment target");
  assert.equal(summer.lineage["reported.admissions.deposits"]!.url, JULY);
  assert.equal(summer.lineage["reported.admissions.enrolled"], undefined);
  const s = merged(summer);
  assert.deepEqual(validateSchool(s, meta), []);
  // Nothing in the dataset's funnel moves.
  assert.strictEqual(applyNewest(s).admissions.enrolled, school().admissions.enrolled);
  assert.equal(applyNewest(s).admissions.federal, undefined);

  const sept = notice(ext({ enrolled: 1500 }), SEPT, "2026-09-18");
  const fall = combineByTerm([july, sept], school(), RUN, TODAY).entry!;
  assert.equal(fall.admissions.enrolled, 1500);
  assert.equal(fall.admissions.deposits, undefined, "the census count replaces deposits");
  assert.equal(fall.lineage["reported.admissions.deposits"], undefined);
  assert.equal(fall.admissions.enrollment_target, 1450, "the class goal stays, labeled");
  assert.deepEqual(validateSchool(merged(fall), meta), []);
});

test("a class goal or deposits without a quote that prints them fails check 2", () => {
  const e = ext({ enrollment_target: 1450 });
  e.quotes.enrollment_target = "a class of about fifteen hundred";
  const { entry, failures } = combineByTerm([notice(e, JULY, "2026-07-20")], school(), RUN, TODAY);
  assert.equal(entry, null);
  assert.equal(failures[0].failures[0].check, "quote-present");
});

test("an extraction stored before the fall-figures keys reads as all exact, with no goal or deposits", () => {
  const full = ext({ applicants: 46618, admitted: 1865, enrolled: 1500, acceptance_rate: 0.04 });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the new keys is the point
  const { qualifiers: _q, enrollment_target: _t, deposits: _d, ...old } = full;
  const stored: StoredExtraction = old;
  const src = { url: SEPT, kind: "class-profile" as const, retrieved: TODAY };
  const { entry, failures } = combineByTerm([{ ...src, e: stored as Extraction }], school(), RUN, TODAY);
  assert.deepEqual(failures, []);
  assert.equal(entry!.admissions.approx, undefined);
  assert.equal(entry!.admissions.enrollment_target, undefined);
  assert.equal(entry!.admissions.deposits, undefined);
  // The same shape toReportedEntry has always produced (no new keys on an exact entry).
  assert.deepEqual(entry, toReportedEntry(stored, school(), src, RUN));
  assert.deepEqual(Object.keys(entry!.admissions), ["entering_term", "year", "applicants", "admitted", "enrolled", "acceptance_rate", "source_kind"]);
});

test("the newest term with a passing candidate wins; failures for it are reported, a multi-campus total among them", () => {
  const old = notice(ext({ applicants: 44000, admitted: 1800 }, { term: "Fall 2025" }), "https://news.princeton.edu/2025/09/01/x", "2025-09-01");
  const sept = notice(ext({ enrolled: 1500 }), SEPT, "2026-09-18");
  const system = notice(ext({ applicants: 60000 }, { cohort: "multi-campus" }), "https://system.example.edu/fact-sheet.pdf", "2026-06-15");
  const { entry, term, failures } = combineByTerm([old, sept, system], school(), RUN, TODAY);
  assert.equal(term, "Fall 2026");
  assert.equal(entry!.admissions.applicants, null, "a newer term never borrows an older term's figures");
  assert.equal(entry!.admissions.enrolled, 1500);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failures[0].check, "cohort-and-scope");

  // Nothing passing: no entry, the failure still reported.
  const none = combineByTerm([system], school(), RUN, TODAY);
  assert.equal(none.entry, null);
  assert.equal(none.term, null);
  assert.equal(none.failures.length, 1);
});
