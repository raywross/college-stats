/**
 * College Board's AP Course Ledger (specs/product/high-school-data.md "AP Course Ledger"): the page parser and course
 * counting rule, the state file's writer, a resumable fetch against a fake site, name matching and its rules, the
 * adapter (patches, report, nothing-loaded), the merge for an adapter of any row kind, the row validator, and the
 * offering precedence (profile, then the Ledger, then pooled, marks, CRDC). No network. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HighSchool } from "../lib/high-school-types.ts";
import { blankHighSchool, validateHighSchoolRow } from "../lib/high-school-core.ts";
import { schoolOffering } from "../lib/chances/offering.ts";
import { offeringLines } from "../lib/chances/rigor-view.ts";
import { applyAdapterResults } from "../scripts/lib/high-schools/merge.mts";
import { createAdapterContext } from "../scripts/lib/high-schools/context.mts";
import {
  coursesInYear,
  currentLedgerYear,
  fetchLedgerState,
  formatLedgerStateFile,
  ledgerYearLabel,
  openLedgerSession,
  parseLedgerPage,
  readLedgerStateFile,
  writeLedgerStateFile,
  type LedgerSchoolRecord,
  type LedgerStateFile,
} from "../scripts/lib/high-schools/ledger-fetch.mts";
import { coreTokens, info, levelOf, load, matchLedgerSchools, nameScore, nameTokens } from "../scripts/lib/high-schools/ledger.mts";

const quiet = { log: () => {}, warn: () => {} };

function row(id: string, name: string, o: Partial<HighSchool> = {}): HighSchool {
  const kind = id.length === 12 ? "public" : "private";
  const state = id.startsWith("48") || id.startsWith("A") ? "TX" : "CA";
  return { ...blankHighSchool(id, kind, name, state), grades: { low: "9", high: "12" }, ...o };
}

function rec(ai: string, name: string, city: string | null, zip: string | null, courses: string[] = ["ap_biology"], other: string[] = []): LedgerSchoolRecord {
  return { ai, name, address: null, city, zip, courses, other };
}

const SUBJECTS = new Map(
  [
    [32, "Biology", 1],
    [34, "Calculus AB", 1],
    [40, "Seminar", 1],
    [27, "Physics B", 1],
    [99, "Quantum Computing", 1],
    [52, "Pre-AP Algebra 1", 2],
  ].map(([id, name, type]) => [id as number, { subject_id: id as number, subject_fullname: name as string, type: type as number }]),
);

/* ------------------------------------------------------------------ */
/* Page, years, counting                                               */
/* ------------------------------------------------------------------ */

const PAGE = `<html><head><meta name="csrf-token" content="tok123" /></head><body><script>
const AUDIT_SUBJECTS = [{"subject_id":32,"subject_fullname":"Biology","type":1},{"subject_id":52,"subject_fullname":"Pre-AP Algebra 1","type":2}];
const AUDIT_YEARS = [{"audit_year_id":19,"audit_year":"2025 - 2026","audit_year_active":0,"audit_year_ledger":1},{"audit_year_id":18,"audit_year":"2024 - 2025","audit_year_active":0,"audit_year_ledger":1}];
</script></body></html>`;

test("parseLedgerPage: the token, years, and subjects; the current year is the newest; labels read 2025–26", () => {
  const p = parseLedgerPage(PAGE);
  assert.equal(p.token, "tok123");
  assert.equal(p.years.length, 2);
  assert.equal(p.subjects[1].type, 2);
  assert.equal(currentLedgerYear(p.years).audit_year_id, 19);
  assert.equal(ledgerYearLabel({ audit_year: "2025 - 2026" }), "2025–26");
  assert.throws(() => parseLedgerPage("<html></html>"), /csrf-token/);
});

test("coursesInYear: a subject counts once in a year it's authorized; Pre-AP, retired, and other years are left out; unknown names go to other", () => {
  const resp = {
    ap: {
      "32": { subject_id: 32, years: [{ audit_year_id: 18, authorized_count: 1 }, { audit_year_id: 19, authorized_count: 3 }] },
      "34": { subject_id: 34, years: [{ audit_year_id: 18, authorized_count: 1 }] },
      "40": { subject_id: 40, years: [{ audit_year_id: 19, authorized_count: 1 }] },
      "27": { subject_id: 27, years: [{ audit_year_id: 19, authorized_count: 1 }] },
      "99": { subject_id: 99, years: [{ audit_year_id: 19, authorized_count: 1 }] },
      "52": { subject_id: 52, years: [{ audit_year_id: 19, authorized_count: 1 }] },
    },
  };
  assert.deepEqual(coursesInYear(resp, 19, SUBJECTS), { courses: ["ap_biology", "ap_seminar"], other: ["AP Quantum Computing"] });
  assert.deepEqual(coursesInYear(resp, 18, SUBJECTS), { courses: ["ap_biology", "ap_calculus_ab"], other: [] });
  // Laravel encodes an empty map as [].
  assert.deepEqual(coursesInYear({ ap: [] }, 19, SUBJECTS), { courses: [], other: [] });
});

test("state file: one school per line, sorted by AI code, round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  try {
    const file: LedgerStateFile = { state: "TX", year: "2025–26", year_id: 19, retrieved: "2026-10-11", complete: true, schools: [rec("440375", "Azle High School", "Azle", "76020"), rec("000001", "A School", "Austin", "78701")] };
    const text = formatLedgerStateFile(file);
    assert.match(text, /"schools": \[\n    \{"ai":"000001"/);
    assert.equal(text.split("\n").filter((l) => l.startsWith("    {")).length, 2);
    writeLedgerStateFile(dir, file);
    const back = readLedgerStateFile(dir, "tx")!;
    assert.equal(back.schools[0].ai, "000001");
    assert.equal(formatLedgerStateFile(back), text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Fetch against a fake site                                           */
/* ------------------------------------------------------------------ */

function fakeSite(opts: { fail?: Set<string> } = {}) {
  const calls: string[] = [];
  let throttled = false;
  const directory = [
    { id: 1, ai: "440375", org_id: 1, fullname: "Azle High School ", address_1: "1200 Boyd Rd", address_2: null, city: "Azle", state: "TX", zip: "76020-2522", country_code: "US", brick_mortar: 1, olp: 0 },
    { id: 2, ai: "440384", org_id: 2, fullname: "Azle Christian School", address_1: null, address_2: null, city: "Azle", state: "TX", zip: "76020", country_code: "US", brick_mortar: 1, olp: 0 },
    { id: 3, ai: "999999", org_id: 3, fullname: "Texas Virtual Provider", address_1: null, address_2: null, city: "Austin", state: "TX", zip: "78701", country_code: "US", brick_mortar: 0, olp: 1 },
    { id: 4, ai: null, org_id: 777, fullname: "No Code High School", address_1: null, address_2: null, city: "Waco", state: "TX", zip: "76701", country_code: "US", brick_mortar: 1, olp: 0 },
  ];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/ledger/")) return new Response(PAGE, { status: 200, headers: { "set-cookie": "_ap=abc; Path=/; HttpOnly" } });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    assert.equal((init?.headers as Record<string, string>)["X-CSRF-TOKEN"], "tok123");
    assert.equal((init?.headers as Record<string, string>).Cookie, "_ap=abc");
    if (url.endsWith("/api/ledger/search")) return Response.json({ results: directory.filter((d) => d.state === body.state) });
    if (url.endsWith("/api/ledger/school")) {
      if (opts.fail?.has(body.identifier)) return new Response("nope", { status: 500 });
      // The first request for Azle is throttled: the client waits (Retry-After) and asks again.
      if (body.identifier === "440375" && !throttled) {
        throttled = true;
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      // A school without an AI code is addressed by org id, as the page's /ledger/school/org/<id> route does.
      if (body.identifier === "777") assert.equal(body.type, "org");
      else assert.equal(body.type, "ai");
      const ap = body.identifier === "440375" ? { "32": { subject_id: 32, years: [{ audit_year_id: 19, authorized_count: 2 }] }, "34": { subject_id: 34, years: [{ audit_year_id: 18, authorized_count: 1 }] } } : [];
      return Response.json({ school: { id: 1, fullname: "x", address_1: null, city: null, state: null, zip: null }, ap, preap: [] });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("fetchLedgerState: the directory in one call, a course list per school (online providers skipped), then a rerun fetches nothing new", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  try {
    const site = fakeSite();
    const session = await openLedgerSession(site.fetchImpl);
    session.retryBaseMs = 1;
    assert.equal(session.cookie, "_ap=abc");
    const first = await fetchLedgerState({ state: "tx", outDir: dir, session, today: "2026-10-11", delayMs: 0 });
    assert.equal(first.fetched, 3);
    assert.equal(first.failed, 0);
    assert.equal(first.file.complete, true);
    assert.equal(first.file.year, "2025–26");
    assert.deepEqual(
      first.file.schools.map((s) => [s.ai, s.name, s.zip, s.courses]),
      [
        ["440375", "Azle High School", "76020", ["ap_biology"]],
        ["440384", "Azle Christian School", "76020", []],
        ["org-777", "No Code High School", "76701", []],
      ],
    );
    // Three schools, plus the one request the fake site throttled and the client repeated.
    assert.equal(site.calls.filter((u) => u.endsWith("/api/ledger/school")).length, 4);
    const second = await fetchLedgerState({ state: "TX", outDir: dir, session, today: "2026-10-12", delayMs: 0 });
    assert.equal(second.fetched, 0);
    assert.equal(second.kept, 3);
    assert.equal(site.calls.filter((u) => u.endsWith("/api/ledger/school")).length, 4);
    assert.equal(readLedgerStateFile(dir, "TX")!.retrieved, "2026-10-12");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchLedgerState: a failed school is counted, the file is incomplete, and the next run fetches just that one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  try {
    const failing = fakeSite({ fail: new Set(["440384"]) });
    const session = await openLedgerSession(failing.fetchImpl);
    session.retryBaseMs = 1;
    const first = await fetchLedgerState({ state: "TX", outDir: dir, session, today: "2026-10-11", delayMs: 0 });
    assert.equal(first.failed, 1);
    assert.equal(first.file.complete, false);
    assert.equal(first.file.schools.length, 2);
    const working = fakeSite();
    const workingSession = await openLedgerSession(working.fetchImpl);
    workingSession.retryBaseMs = 1;
    const again = await fetchLedgerState({ state: "TX", outDir: dir, session: workingSession, today: "2026-10-11", delayMs: 0 });
    assert.equal(again.fetched, 1);
    assert.equal(again.file.complete, true);
    assert.equal(working.calls.filter((u) => u.endsWith("/api/ledger/school")).length, 1);
    // --limit stops after N new schools.
    const limitedSession = await openLedgerSession(fakeSite().fetchImpl);
    limitedSession.retryBaseMs = 1;
    const limited = await fetchLedgerState({ state: "TX", outDir: dir, session: limitedSession, today: "2026-10-11", delayMs: 0, refresh: true, limit: 1 });
    assert.equal(limited.fetched, 1);
    assert.equal(limited.file.complete, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Name matching                                                       */
/* ------------------------------------------------------------------ */

test("nameTokens and coreTokens: abbreviations spelled out, punctuation gone, 'High School' set aside", () => {
  assert.deepEqual(nameTokens("Plano East Sr H S"), ["plano", "east", "senior", "high", "school"]);
  assert.deepEqual([...coreTokens("Plano East Sr H S")], ["plano", "east"]);
  assert.deepEqual([...coreTokens("St. Anthony's High School")], ["saint", "anthonys"]);
  assert.deepEqual([...coreTokens("Harmony Science Academy - Carrollton")], ["harmony", "science", "academy", "carrollton"]);
  // Nothing but stop words: the full name stands in.
  assert.deepEqual([...coreTokens("The High School")], ["the", "high", "school"]);
  // Level words are set aside from the core and compared on their own; a junior-senior high is a high school.
  assert.deepEqual([...coreTokens("Bryant Junior High School")], ["bryant"]);
  assert.equal(levelOf("Bryant Junior High School"), "junior");
  assert.equal(levelOf("Bryant High School"), "");
  assert.equal(levelOf("Des Arc Jr Sr High School"), "");
  assert.equal(levelOf("Orange Beach Middle High School"), "middle");
});

test("nameScore: the same school under two spellings scores 1; a sibling scores by its distinguishing words", () => {
  assert.equal(nameScore("Fairfax Senior High", "Fairfax High School"), 1);
  assert.equal(nameScore("New Tech High School at B F Darrell High School", "New Technical High School at BF Darrell"), 1);
  assert.equal(nameScore("Millikan High", "Robert Millikan High School"), 0.5);
  assert.equal(nameScore("Azle High School", "Azle Christian School"), 0.5);
  assert.equal(nameScore("North High School", "South High School"), 0);
});

test("matchLedgerSchools: exact by zip or city, weaker names need the zip, subsets by zip, ties and double claims are ambiguous", () => {
  const rows = [
    row("480000200001", "Azle High School", { city: "Azle", zip: "76020" }),
    row("480000200002", "Plano East Sr H S", { city: "Plano", zip: "75074" }),
    row("480000200003", "Millikan High", { city: "Long Beach", zip: "90815" }),
    row("480000200004", "Washington High School", { city: "Houston", zip: "77007" }),
    row("480000200005", "Lincoln High School", { city: "Dallas", zip: "75210" }),
    row("480000200006", "Nowhere High School", { city: "Nowhere", zip: null }),
    row("480000200007", "Harmony Science Academy Carrollton", { city: "Carrollton", zip: "75006" }),
    row("480000200008", "Bryant High School", { city: "Bryant", zip: "72022" }),
    row("480000200009", "Basis Tucson North", { city: "Tucson", zip: "85750" }),
    row("480000200010", "Har-Ber High School", { city: "Springdale", zip: "72765" }),
    row("480000200011", "Pea Ridge Junior High School", { city: "Pea Ridge", zip: "72751" }),
    row("480000200012", "Los Angeles Senior High", { city: "Los Angeles", zip: "90019" }),
    row("480000200013", "The School of Los Angeles", { city: "Los Angeles", zip: "90038" }),
    row("A9900001", "Saint Anthony High School", { city: "Long Beach", zip: "90813" }),
    row("A9900004", "Marymount High School Los Angeles", { city: "Los Angeles", zip: "90077" }),
    row("A9900005", "Rise Academy", { city: "San Jose", zip: "95134" }),
    row("A9900006", "Rise Academy", { city: "San Jose", zip: "95134" }),
    row("A9900002", "Jefferson Academy", { city: "Dallas", zip: "75201" }),
    row("A9900003", "Jefferson Academy", { city: "Dallas", zip: "75201" }),
    row("480000200014", "Haas Hall Academy", { city: "Springdale", zip: "72764" }),
    row("480000200015", "Dothan High School", { city: "Dothan", zip: "36301" }),
  ];
  const ledger = [
    rec("000001", "Azle High School", "Azle", "76020"),
    rec("000002", "Azle Christian School", "Azle", "76020"),
    rec("000003", "Plano East Senior High School", "Plano", "75074"),
    rec("000004", "Robert Millikan High School", "Long Beach", "90815"),
    rec("000005", "Washington Charter High School", "Houston", "77007"),
    rec("000006", "Lincoln High School", "Dallas", "75210"),
    rec("000007", "Lincoln Senior High", "Dallas", "75210"),
    rec("000008", "St. Anthony High School", "Long Beach", "90802"),
    rec("000009", "Jefferson Academy", "Dallas", "75201"),
    rec("000010", "Unlisted Prep", "Austin", "78701"),
    rec("000011", "Harmony Science Academy of Carrollton North", "Carrollton", "75007"),
    // A junior high beside the high school, same ZIP: the level word keeps them apart.
    rec("000012", "Bryant Junior High School", "Bryant", "72022", ["ap_biology"]),
    rec("000013", "Bryant High School", "Bryant", "72022", ["ap_biology", "ap_calculus_ab"]),
    // The Ledger's old, empty record beside the live one: the live one wins the tie.
    rec("000014", "BASIS Tucson North", "Tucson", "85750", []),
    rec("000015", "Basis Tucson North School", "Tucson", "85750", ["ap_biology"]),
    // One name inside the other, same city, different ZIP.
    rec("000016", "Springdale Har Ber High School", "Springdale", "72762"),
    // Only the high school is in the Ledger: the junior high row stays unmatched rather than taking it.
    rec("000017", "Pea Ridge High School", "Pea Ridge", "72751"),
    // A name that is its city's: only the row with the same words beyond "school" takes it, not "The School of Los
    // Angeles" or "Marymount High School Los Angeles".
    rec("000018", "Los Angeles Senior High School", "Los Angeles", "90019"),
    // One school the directory lists twice: both rows take it.
    rec("000019", "Rise Academy", "San Jose", "95134"),
    // Two Ledger records with one name, one ZIP, and the same courses: nothing tells them apart.
    rec("000020", "Dothan High School", "Dothan", "36301"),
    rec("000021", "Dothan High School", "Dothan", "36301"),
    // One name inside the other at 0.6, same city, different ZIP.
    rec("000022", "Haas Hall Academy Jones Center Annex", "Springdale", "72762"),
  ];
  const r = matchLedgerSchools(rows, ledger);
  assert.deepEqual(
    r.matches.map((m) => [m.id, m.ai, m.rule]),
    [
      ["480000200001", "000001", "exact"],
      ["480000200002", "000003", "exact"],
      ["480000200003", "000004", "subset"],
      ["480000200004", "000005", "subset"],
      // "Lincoln High School" and "Lincoln Senior High" in one ZIP: the whole name decides.
      ["480000200005", "000006", "exact"],
      ["480000200007", "000011", "city"],
      ["480000200008", "000013", "exact"],
      ["480000200009", "000015", "exact"],
      // The Ledger prefixed the city: "Springdale Har Ber" is "Har-Ber" once the city's words are set aside.
      ["480000200010", "000016", "exact"],
      ["480000200012", "000018", "exact"],
      ["480000200014", "000022", "subset-city"],
      ["A9900001", "000008", "exact"],
      ["A9900002", "000009", "exact"],
      ["A9900003", "000009", "exact"],
      ["A9900005", "000019", "exact"],
      ["A9900006", "000019", "exact"],
    ],
  );
  assert.deepEqual(r.ambiguousRows.map((a) => a.id), ["480000200015"]);
  assert.deepEqual(r.unmatchedRows, ["480000200006", "480000200011", "480000200013", "A9900004"]);
  assert.deepEqual(r.unusedLedger, ["000002", "000007", "000010", "000012", "000014", "000017", "000020", "000021"]);
});

/* ------------------------------------------------------------------ */
/* Adapter, merge, validation                                          */
/* ------------------------------------------------------------------ */

test("adapter: patches from the state files, the report, meta entries; nothing loaded without files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  try {
    const existing = new Map(
      [
        row("060000100001", "Fixture Hills High School", { city: "Los Angeles", zip: "90001" }),
        row("A9900001", "Fixture Academy", { state: "CA", city: "San Francisco", zip: "94110" }),
        row("480000200001", "Fixture Ridge High School", { city: "Dallas", zip: "75201" }),
      ].map((r) => [r.id, r]),
    );
    const ctx = createAdapterContext({ root: dir, outDir: dir, existing, now: new Date("2026-10-11T12:00:00Z"), ...quiet });
    const nothing = await load(ctx);
    assert.equal(nothing.patches, undefined);
    assert.match(nothing.notes![0], /no data\/high-schools\/ledger/);

    writeLedgerStateFile(dir, {
      state: "CA",
      year: "2025–26",
      year_id: 19,
      retrieved: "2026-10-10",
      complete: true,
      schools: [rec("100001", "Fixture Hills High School", "Los Angeles", "90001", ["ap_calculus_ab", "ap_biology"]), rec("100002", "Fixture Academy", "San Francisco", "94110", [], ["AP Quantum Computing"]), rec("100003", "Other Academy", "Fresno", "93701")],
    });
    const res = await load(ctx);
    assert.deepEqual(
      res.patches!.map((p) => [p.id, p.values.ap_ledger!.ledger_id, p.values.ap_ledger!.courses, p.values.ap_ledger!.other]),
      [
        ["060000100001", "100001", ["ap_biology", "ap_calculus_ab"], []],
        ["A9900001", "100002", [], ["AP Quantum Computing"]],
      ],
    );
    assert.equal(res.vintages["ap-ledger"], "2025–26");
    assert.equal(res.sources["ap-ledger"]!.retrieved, "2026-10-10");
    assert.match(res.sources["ap-ledger"]!.name, /AP Course Ledger, 2025–26/);
    assert.match(res.notes![0], /2 of 2 rows matched/);
    const report = JSON.parse(readFileSync(join(dir, "ledger", "report.json"), "utf8"));
    assert.equal(report.matched, 2);
    assert.deepEqual(report.unused.map((u: { ai: string }) => u.ai), ["100003"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merge: an adapter of any row kind fills public and private rows and resets the ones it didn't patch", () => {
  const pub = row("060000100001", "Fixture Hills High School", { ap_ledger: { year: "2024–25", ledger_id: "100001", ledger_name: "Old", courses: ["ap_art_history"], other: [] } });
  const priv = row("A9900001", "Fixture Academy");
  const stale = row("060000100002", "Fixture Canyon Continuation School", { ap_ledger: { year: "2024–25", ledger_id: "100009", ledger_name: "Gone", courses: [], other: [] } });
  const patch = { id: "A9900001", values: { ap_ledger: { year: "2025–26", ledger_id: "100002", ledger_name: "Fixture Academy", courses: ["ap_biology"], other: [] } } };
  const patch2 = { id: "060000100001", values: { ap_ledger: { year: "2025–26", ledger_id: "100001", ledger_name: "Fixture Hills High School", courses: ["ap_calculus_ab"], other: [] } } };
  const { rows, report } = applyAdapterResults([pub, priv, stale], [{ info, result: { patches: [patch, patch2], sources: {}, vintages: {} } }]);
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual(by.get("A9900001")!.ap_ledger!.courses, ["ap_biology"]);
  assert.equal(by.get("060000100001")!.ap_ledger!.year, "2025–26");
  assert.equal(by.get("060000100002")!.ap_ledger, null);
  assert.equal(report[0].updated, 3);
  assert.equal(report[0].unmatched, 0);
  // Private rows keep every other field (no CRDC block appears).
  assert.equal(by.get("A9900001")!.rigor, null);
  assert.deepEqual(validateHighSchoolRow(by.get("A9900001")!), []);
});

test("validateHighSchoolRow: a sound ap_ledger passes; a bad year, id, unsorted or non-key courses fail", () => {
  const good = row("480000200001", "Fixture Ridge High School", { ap_ledger: { year: "2025–26", ledger_id: "440375", ledger_name: "Fixture Ridge High School", courses: ["ap_biology", "ap_calculus_ab"], other: [] } });
  assert.deepEqual(validateHighSchoolRow(good), []);
  const broken = (f: (l: NonNullable<HighSchool["ap_ledger"]>) => void) => {
    const r = structuredClone(good);
    f(r.ap_ledger!);
    return validateHighSchoolRow(r).join("\n");
  };
  assert.match(broken((l) => (l.year = "2025-2026")), /ap_ledger\.year/);
  assert.match(broken((l) => (l.ledger_id = "12")), /six-digit/);
  assert.match(broken((l) => (l.courses = ["ap_calculus_ab", "ap_biology"])), /isn't sorted/);
  assert.match(broken((l) => (l.courses = ["Biology"])), /catalog keys/);
  assert.match(broken((l) => (l.other = ["AP X", "AP X"])), /twice/);
});

/* ------------------------------------------------------------------ */
/* The offering                                                        */
/* ------------------------------------------------------------------ */

test("schoolOffering: the Ledger's list beats pooled, marks, and the CRDC count, and yields to the profile; an empty list is zero", () => {
  const ledger = { year: "2025–26", ledger_id: "440375", ledger_name: "Azle High School", courses: ["ap_biology", "ap_calculus_ab", "not_a_course"], other: ["AP Quantum Computing"] };
  const school = { rigor: { ap_courses: 16, ap_enrolled: 300, ap_exam_takers: null, ap_passed_some: null, ib_enrolled: 0, dual_enrolled: 40, enrollment: 2000 }, ap_ledger: ledger };
  const o = schoolOffering({ school, studentMarks: ["ap_statistics"] }, ["ap_chemistry", "ap_physics_1", "ap_statistics"]);
  assert.equal(o.source, "ledger");
  assert.equal(o.field, "ap_ledger");
  assert.deepEqual(o.apKeys, ["ap_biology", "ap_calculus_ab"]);
  assert.equal(o.apCount, 3);
  assert.equal(o.ib, false);
  assert.equal(o.dual, true);
  assert.deepEqual(offeringLines(o), ["College Board lists 3 AP courses your school is authorized to offer.", "dual enrollment is offered too."]);

  const none = schoolOffering({ school: { ...school, ap_ledger: { ...ledger, courses: [], other: [] } } });
  assert.equal(none.apCount, 0);
  assert.equal(none.source, "ledger");
  assert.equal(offeringLines(none)[0], "College Board lists no AP courses for your school this year.");

  const profile = schoolOffering({ school, detail: { ap_courses: ["Calculus AB"], ib_courses: null } });
  assert.equal(profile.source, "profile");

  const crdc = schoolOffering({ school: { ...school, ap_ledger: null } });
  assert.equal(crdc.source, "crdc");
  assert.equal(crdc.apCount, 16);
});

test("the adapter's contract: enrichment of any kind, owning ap_ledger only", () => {
  assert.equal(info.role, "enrichment");
  assert.equal(info.rowKind, "any");
  assert.deepEqual(info.owns, ["ap_ledger"]);
  assert.equal(existsSync(join(import.meta.dirname, "..", "scripts", "sync-ap-ledger.mts")), true);
});
