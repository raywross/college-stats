/**
 * The school profile pilot (phase 3; scripts/sync-hs-profiles.mts, scripts/lib/high-schools/profiles/*): pilot
 * selection, the hs-profile schema mapping to HighSchoolDetail, every check (each proven to fail on a broken
 * extraction), college-name matching, the spend cap, discovery with robots refusals, scoring against the answer key,
 * and the committed pilot files. No network, no model: fakes stand in for both. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { HighSchool, HighSchoolDetail } from "../lib/high-school-types.ts";
import { blankHighSchool, validateHighSchoolDetail } from "../lib/high-school-core.ts";
import type { NumberedLine } from "../lib/cds-quotes.ts";
import { PILOT_METROS, eligible, quotas, selectMetro, selectPilot, sizeBand, type Metro } from "../scripts/lib/high-schools/profiles/select.mts";
import { buildCollegeIndex, matchCollege, matchList, nameKeys, stateHint } from "../scripts/lib/high-schools/profiles/match.mts";
import { SpendCap, SpendCapReached, worstCaseUsd } from "../scripts/lib/high-schools/profiles/budget.mts";
import { assessProfile, coursesInDocument, normalizeClasses, parseEdition, parseNum, verbatim, type AssessContext } from "../scripts/lib/high-schools/profiles/checks.mts";
import { buildProfileRequest, extractProfile, parseProfileResponse, PROFILE_MODELS, type ProfileAnswer } from "../scripts/lib/high-schools/profiles/extract.mts";
import { linesFromHtml, looksLikeProfile, nameCoverage } from "../scripts/lib/high-schools/profiles/document.mts";
import { discoverProfile, embeddedDocuments, hostKind, isProfileLink, isStrictProfile, isWebsiteLink, registrable, type DiscoverHttp } from "../scripts/lib/high-schools/profiles/discover.mts";
import { answerValues, escalatableFields, measure, mergeAnswers, runProfiles, type RunSchool } from "../scripts/lib/high-schools/profiles/run.mts";
import { f1, scoreAgainstKey, scoreField, type AnswerKeyFile, type KeyValues } from "../scripts/lib/high-schools/profiles/score.mts";
import { mergeQueue } from "../scripts/lib/high-schools/profiles/store.mts";
import type { ModelClient } from "../scripts/lib/college-reported/models.mts";

const ROOT = join(import.meta.dirname, "..");
const DATA = join(ROOT, "data", "high-schools");
const TODAY = "2026-10-05";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const COLLEGES = [
  { unit_id: "123961", name: "University of Southern California", state: "CA" },
  { unit_id: "218663", name: "University of South Carolina-Columbia", state: "SC" },
  { unit_id: "190415", name: "Cornell University", state: "NY" },
  { unit_id: "110662", name: "University of California-Los Angeles", state: "CA" },
  { unit_id: "243780", name: "Purdue University-Main Campus", state: "IN" },
  { unit_id: "204024", name: "Miami University-Oxford", state: "OH" },
  { unit_id: "135726", name: "University of Miami", state: "FL" },
  { unit_id: "166027", name: "Harvard University", state: "MA" },
  { unit_id: "111111", name: "Westminster College", state: "PA" },
  { unit_id: "222222", name: "Westminster College", state: "MO" },
];
const ALIASES = [
  { unit_id: "123961", key: "usc", weight: 4 },
  { unit_id: "218663", key: "usc", weight: 4 },
  { unit_id: "110662", key: "ucla", weight: 4 },
  { unit_id: "135726", key: "miami", weight: 4 },
  { unit_id: "204024", key: "miami", weight: 4 },
];
const INDEX = buildCollegeIndex(COLLEGES, ALIASES);

/** A small profile as numbered lines (dense ids, the way numberLines makes them). */
function profileLines(): NumberedLine[] {
  const rows: [number, string][] = [
    [1, "@40 Fixture Hills High School | @400 CEEB 051234"],
    [1, "@40 School Profile 2025-2026"],
    [1, "@40 Class of 2026: 412 seniors"],
    [1, "@40 Grading: A = 4.0, B = 3.0, C = 2.0. Honors and AP courses earn one additional point."],
    [1, "@40 Weighted GPA reported on a 4.0 scale"],
    [1, "@40 GPA Distribution (weighted)"],
    [1, "@40 4.0 and above | @300 22%"],
    [1, "@40 3.5-3.99 | @300 31%"],
    [1, "@40 3.0-3.49 | @300 27%"],
    [1, "@40 Below 3.0 | @300 20%"],
    [2, "@40 Advanced Placement courses: AP Biology, AP Calculus AB, AP Calculus BC, AP U.S. History"],
    [2, "@40 SAT middle 50%: 1150-1350 | @300 ACT middle 50%: 24-31"],
    [2, "@40 Where the Class of 2025 enrolled"],
    [2, "@40 UCLA | @300 12"],
    [2, "@40 Cornell University | @300 3"],
    [2, "@40 USC | @300 9"],
    [2, "@40 Oxford Brookes University | @300 1"],
  ];
  return rows.map(([page, text], i) => ({ id: i + 1, page, text }));
}

function goodAnswer(): ProfileAnswer {
  return {
    school_name: { text: "Fixture Hills High School", lines: [1] },
    edition: { text: "2025-2026", lines: [2] },
    class_size: { v: "412", lines: [3] },
    gpa_scale: { kind: "unweighted-4", max: "4.0", weighted: true, lines: [5], rule_lines: [4] },
    gpa_distribution: {
      basis: "percent",
      bands: [
        { band: "4.0 and above", v: "22", lines: [7] },
        { band: "3.5-3.99", v: "31", lines: [8] },
        { band: "3.0-3.49", v: "27", lines: [9] },
        { band: "Below 3.0", v: "20", lines: [10] },
      ],
    },
    ap_courses: { names: ["AP Biology", "AP Calculus AB", "AP Calculus BC", "AP U.S. History"], lines: [11] },
    sat_mid50: { low: "1150", high: "1350", lines: [12] },
    act_mid50: { low: "24", high: "31", lines: [12] },
    matriculation: {
      classes: "Class of 2025",
      lines: [13],
      entries: [
        { name: "UCLA", count: "12", lines: [14] },
        { name: "Cornell University", count: "3", lines: [15] },
        { name: "USC", count: "9", lines: [16] },
        { name: "Oxford Brookes University", count: "1", lines: [17] },
      ],
    },
  };
}

function ctx(over: Partial<AssessContext> = {}): AssessContext {
  return {
    school: { id: "060000100001", name: "Fixture Hills High", grade12: 420 },
    lines: profileLines(),
    url: "https://fixturehills.example.org/profile-2025-26.pdf",
    retrieved: TODAY,
    index: INDEX,
    ...over,
  };
}

const COLLEGE_IDS = new Set(COLLEGES.map((c) => c.unit_id));

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

function row(id: string, o: { kind?: "public" | "private"; state?: string; lat?: number; lng?: number; total?: number; g12?: number | null; type?: string | null; virtual?: boolean }): HighSchool {
  const r = blankHighSchool(id, o.kind ?? "public", `School ${id}`, o.state ?? "CA");
  r.lat = o.lat ?? 34.05;
  r.lng = o.lng ?? -118.25;
  r.enrollment.total = o.total ?? 1000;
  r.enrollment.by_grade = { "12": o.g12 === undefined ? 100 : o.g12 };
  r.school_type = o.type ?? (r.kind === "public" ? "Regular School" : null);
  r.status.virtual = o.virtual ?? false;
  return r;
}

test("pilot quotas: two thirds public, bands even, totals add up", () => {
  for (const take of [33, 34, 9, 100]) {
    const q = quotas(take);
    const sum = Object.values(q.public).reduce((a, b) => a + b, 0) + Object.values(q.private).reduce((a, b) => a + b, 0);
    assert.equal(sum, take);
    assert.equal(Object.values(q.public).reduce((a, b) => a + b, 0), Math.round((take * 2) / 3));
  }
});

test("eligibility: needs a 12th grade of 10+; public alternative, special education, virtual are out", () => {
  assert.equal(eligible(row("060000000001", {})), true);
  assert.equal(eligible(row("060000000002", { g12: 5 })), false);
  assert.equal(eligible(row("060000000003", { g12: null })), false);
  assert.equal(eligible(row("060000000004", { type: "Alternative School" })), false);
  assert.equal(eligible(row("060000000005", { type: "Special Education School" })), false);
  assert.equal(eligible(row("060000000006", { virtual: true })), false);
  assert.equal(eligible(row("A0000001", { kind: "private", type: null })), true);
});

test("selectMetro: in-metro rows only, deterministic, kinds and size bands mixed, shortfall carried", () => {
  const m: Metro = { key: "los-angeles", label: "LA", state: "CA", center: { lat: 34.05, lng: -118.25 }, radius_km: 40, take: 9 };
  const rows: HighSchool[] = [];
  for (let i = 0; i < 12; i++) rows.push(row(`0600000001${String(i).padStart(2, "0")}`, { total: [300, 900, 2000][i % 3] }));
  for (let i = 0; i < 6; i++) rows.push(row(`A00000${String(i).padStart(2, "0")}`, { kind: "private", total: [100, 500, 1000][i % 3] }));
  rows.push(row("060000000999", { lat: 37.77, lng: -122.42 })); // San Francisco: out of the metro
  rows.push(row("480000000999", { state: "TX" })); // right place, wrong state
  const a = selectMetro(rows, m);
  const b = selectMetro([...rows].reverse(), m);
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id), "order of input doesn't matter");
  assert.equal(a.length, 9);
  assert.equal(a.filter((s) => s.kind === "public").length, 6);
  assert.ok(!a.some((s) => s.id === "060000000999" || s.id === "480000000999"));
  assert.deepEqual(new Set(a.filter((s) => s.kind === "public").map((s) => s.size)), new Set(["small", "medium", "large"]));
  // No large public schools: the large quota moves to the other bands.
  const noLarge = rows.filter((r) => !(r.kind === "public" && sizeBand(r) === "large"));
  assert.equal(selectMetro(noLarge, m).filter((s) => s.kind === "public").length, 6);
});

/* ------------------------------------------------------------------ */
/* Schema mapping                                                      */
/* ------------------------------------------------------------------ */

test("a good extraction maps to a valid HighSchoolDetail with verbatim quotes, pages, shares, and matched ids", () => {
  const a = assessProfile(goodAnswer(), ctx());
  assert.deepEqual(a.failures, []);
  assert.ok(a.detail);
  const d = a.detail!;
  assert.deepEqual(validateHighSchoolDetail(d, { collegeIds: COLLEGE_IDS }), []);
  assert.equal(d.profile.edition, "2025–26");
  assert.deepEqual(d.class_size, { v: 412, quote: "Class of 2026: 412 seniors", page: 1 });
  assert.equal(d.gpa_scale?.kind, "unweighted-4");
  assert.equal(d.gpa_scale?.weighted, true);
  assert.equal(d.gpa_scale?.conversion, "Grading: A = 4.0, B = 3.0, C = 2.0. Honors and AP courses earn one additional point.");
  assert.deepEqual(d.gpa_distribution?.map((b) => b.share), [0.22, 0.31, 0.27, 0.2]);
  assert.deepEqual(d.ap_courses, ["AP Biology", "AP Calculus AB", "AP Calculus BC", "AP U.S. History"]);
  assert.deepEqual(d.scores?.sat_mid50, [1150, 1350]);
  assert.deepEqual(d.scores?.act_mid50, [24, 31]);
  assert.equal(d.matriculation?.classes, "2025");
  assert.equal(d.matriculation?.page, 2);
  const byName = Object.fromEntries(d.matriculation!.entries.map((e) => [e.name, e.unit_id]));
  assert.equal(byName["UCLA"], "110662");
  assert.equal(byName["Cornell University"], "190415");
  assert.equal(byName["USC"], null, "ambiguous: never guessed");
  assert.equal(byName["Oxford Brookes University"], null);
  assert.deepEqual(a.match, { listed: 4, matched: 2, ambiguous: 1, unmatched: 1 });
  assert.deepEqual(a.colleges.map((c) => c.check), ["college-ambiguous", "college-unmatched"]);
  assert.deepEqual(a.colleges[0].names[0], { name: "USC", candidates: ["123961", "218663"] });
});

test("count-basis distributions become shares of their total", () => {
  const ans = goodAnswer();
  const lines = profileLines().map((l) => (l.id >= 7 && l.id <= 10 ? { ...l, text: l.text.replace(/(\d+)%/, (_, n) => String(Number(n) * 2)) } : l));
  ans.gpa_distribution = { basis: "count", bands: ans.gpa_distribution!.bands.map((b) => ({ ...b, v: String(Number(b.v) * 2) })) };
  const a = assessProfile(ans, ctx({ lines }));
  assert.deepEqual(a.failures, []);
  assert.deepEqual(a.detail!.gpa_distribution!.map((b) => b.share), [0.22, 0.31, 0.27, 0.2]);
});

test("parsers: numbers, editions, classes, verbatim rules, course names", () => {
  assert.equal(parseNum("1,234"), 1234);
  assert.equal(parseNum("21.5%"), 21.5);
  assert.equal(parseNum(""), null);
  assert.equal(parseNum("about 400"), null);
  assert.deepEqual(parseEdition("School Profile 2025-2026"), { edition: "2025–26", start: 2025 });
  assert.deepEqual(parseEdition("2025–26"), { edition: "2025–26", start: 2025 });
  assert.deepEqual(parseEdition("College Profile for the Class of 2026"), { edition: "2025–26", start: 2025 });
  assert.deepEqual(parseEdition("Fall 2024"), { edition: "2024–25", start: 2024 });
  assert.equal(parseEdition("Our school profile"), null);
  assert.equal(normalizeClasses("Classes of 2022-25"), "2022–2025");
  assert.equal(normalizeClasses("Class of 2025"), "2025");
  assert.equal(normalizeClasses("last four years"), "last four years");
  assert.equal(verbatim(profileLines(), [4, 5]), "Grading: A = 4.0, B = 3.0, C = 2.0. Honors and AP courses earn one additional point. Weighted GPA reported on a 4.0 scale");
  const { found, missing } = coursesInDocument(["AP Biology", "AP Basket Weaving", "AP Biology"], "Advanced Placement: AP Biology");
  assert.deepEqual(found, ["AP Biology"]);
  assert.deepEqual(missing, ["AP Basket Weaving"]);
});

/* ------------------------------------------------------------------ */
/* Every check fails on a broken extraction                            */
/* ------------------------------------------------------------------ */

function fails(mutate: (a: ProfileAnswer) => void, over: Partial<AssessContext> = {}) {
  const ans = goodAnswer();
  mutate(ans);
  return assessProfile(ans, ctx(over));
}

test("document check: wrong school → nothing written", () => {
  const a = fails((x) => (x.school_name = { text: "Some Other Academy", lines: [1] }), { school: { id: "060000100001", name: "Lincoln Heights High", grade12: 400 } });
  assert.equal(a.detail, null);
  assert.equal(a.failures[0].check, "wrong-school");
});

test("document check: no edition, or a stale edition → nothing written", () => {
  assert.equal(fails((x) => delete x.edition).failures[0].check, "edition");
  const stale = fails((x) => (x.edition = { text: "2021-2022", lines: [2] }));
  assert.equal(stale.detail, null);
  assert.match(stale.failures[0].detail, /older than 2023–24/);
});

test("quote check: a number not on its cited line withholds only that field", () => {
  const a = fails((x) => (x.class_size = { v: "415", lines: [3] }));
  assert.deepEqual(a.failures.map((f) => [f.field, f.check]), [["class_size", "quote"]]);
  assert.equal(a.detail!.class_size, null);
  assert.ok(a.detail!.gpa_scale, "other fields still publish");
  assert.deepEqual(a.withheld, ["class_size"]);
  assert.equal(fails((x) => (x.class_size = { v: "412", lines: [999] })).failures[0].check, "quote", "a cited line that doesn't exist");
});

test("distribution check: shares must sum to 1 ± 0.02", () => {
  const a = fails((x) => {
    x.gpa_distribution!.bands.pop();
  });
  assert.equal(a.failures[0].check, "distribution-sum");
  assert.equal(a.detail!.gpa_distribution, null);
  // 99% passes (inside ± 0.02); 97% fails.
  const lines99 = profileLines().map((l) => (l.id === 10 ? { ...l, text: "@40 Below 3.0 | @300 19%" } : l));
  assert.deepEqual(fails((x) => (x.gpa_distribution!.bands[3].v = "19"), { lines: lines99 }).failures, []);
  const lines97 = profileLines().map((l) => (l.id === 10 ? { ...l, text: "@40 Below 3.0 | @300 17%" } : l));
  assert.equal(fails((x) => (x.gpa_distribution!.bands[3].v = "17"), { lines: lines97 }).failures[0].check, "distribution-sum");
  assert.equal(fails((x) => (x.gpa_distribution!.bands = x.gpa_distribution!.bands.slice(0, 1))).failures[0].check, "distribution-sum", "one band is no distribution");
});

test("count-bound check: a matriculation count above the class size withholds the list", () => {
  const lines = profileLines().map((l) => (l.id === 14 ? { ...l, text: "@40 UCLA | @300 500" } : l));
  const a = fails((x) => (x.matriculation!.entries[0].count = "500"), { lines });
  assert.deepEqual(a.failures.map((f) => f.check), ["count-bound"]);
  assert.equal(a.detail!.matriculation, null);
  // Without a class size the CCD 12th grade bounds it.
  const b = fails((x) => {
    delete x.class_size;
    x.matriculation!.entries[0].count = "500";
  }, { lines, school: { id: "060000100001", name: "Fixture Hills High", grade12: 300 } });
  assert.equal(b.failures[0].check, "count-bound");
});

test("scale-kind check: the kind must agree with the printed maximum", () => {
  const lines = profileLines().map((l) => (l.id === 5 ? { ...l, text: "@40 Weighted GPA reported on a 5.0 scale" } : l));
  const a = fails((x) => (x.gpa_scale!.max = "5.0"), { lines });
  assert.equal(a.failures[0].check, "scale-kind");
  assert.equal(a.detail!.gpa_scale, null);
});

test("range check: SAT 400-1600, ACT 1-36, low ≤ high", () => {
  assert.equal(fails((x) => (x.sat_mid50 = { low: "1350", high: "1150", lines: [12] })).failures[0].check, "range");
  assert.equal(fails((x) => (x.act_mid50 = { low: "24", high: "40", lines: [12] })).failures[0].check, "range");
  const a = fails((x) => (x.sat_mid50 = { low: "1100", high: "1350", lines: [12] }));
  assert.equal(a.failures[0].check, "quote");
  assert.deepEqual(a.detail!.scores?.act_mid50, [24, 31], "ACT still publishes");
  assert.equal(a.detail!.scores?.sat_mid50, undefined);
});

test("names check: invented AP courses withhold the list", () => {
  const a = fails((x) => x.ap_courses!.names.push("AP Chinese", "AP Latin"));
  assert.equal(a.failures[0].check, "names");
  assert.equal(a.detail!.ap_courses, null);
  // One unknown name in five (20%) is tolerated and dropped.
  const b = fails((x) => x.ap_courses!.names.push("AP Latin"));
  assert.deepEqual(b.failures, []);
  assert.deepEqual(b.detail!.ap_courses, ["AP Biology", "AP Calculus AB", "AP Calculus BC", "AP U.S. History"]);
});

test("plausible check: total enrollment read as the class size fails", () => {
  const lines = profileLines().map((l) => (l.id === 3 ? { ...l, text: "@40 Class of 2026: 412 seniors; 2,950 students" } : l));
  const a = fails((x) => (x.class_size = { v: "2950", lines: [3] }), { lines });
  assert.equal(a.failures[0].check, "plausible");
});

test("the foundation validator agrees: a broken detail is refused at the lineage check", () => {
  const d = assessProfile(goodAnswer(), ctx()).detail!;
  const broken: HighSchoolDetail = structuredClone(d);
  broken.gpa_distribution = [{ band: "x", share: 0.5 }, { band: "y", share: 0.3 }];
  assert.ok(validateHighSchoolDetail(broken).some((p) => /not 1 ± 0.02/.test(p)));
  const fake: HighSchoolDetail = structuredClone(d);
  fake.matriculation!.entries[0].unit_id = "999999";
  assert.ok(validateHighSchoolDetail(fake, { collegeIds: COLLEGE_IDS }).some((p) => /isn't in data\/schools.json/.test(p)));
});

/* ------------------------------------------------------------------ */
/* Name matching                                                       */
/* ------------------------------------------------------------------ */

test("matching: official name variants, aliases, campus suffix, state hint; ambiguity is never guessed", () => {
  assert.deepEqual(matchCollege(INDEX, "University of California, Los Angeles"), { kind: "matched", unit_id: "110662", rule: 1 });
  assert.deepEqual(matchCollege(INDEX, "UCLA"), { kind: "matched", unit_id: "110662", rule: 2 });
  assert.deepEqual(matchCollege(INDEX, "The Cornell University*"), { kind: "matched", unit_id: "190415", rule: 1 });
  assert.deepEqual(matchCollege(INDEX, "Purdue University"), { kind: "matched", unit_id: "243780", rule: 3 });
  assert.deepEqual(matchCollege(INDEX, "Harvard"), { kind: "matched", unit_id: "166027", rule: 4 });
  assert.deepEqual(matchCollege(INDEX, "USC"), { kind: "ambiguous", candidates: ["123961", "218663"], rule: 2 });
  assert.deepEqual(matchCollege(INDEX, "Miami"), { kind: "ambiguous", candidates: ["135726", "204024"], rule: 2 });
  assert.deepEqual(matchCollege(INDEX, "Miami (OH)"), { kind: "matched", unit_id: "204024", rule: 2 });
  assert.deepEqual(matchCollege(INDEX, "Westminster College"), { kind: "ambiguous", candidates: ["111111", "222222"], rule: 1 });
  assert.deepEqual(matchCollege(INDEX, "Westminster College, PA"), { kind: "matched", unit_id: "111111", rule: 1 });
  assert.deepEqual(matchCollege(INDEX, "Santa Monica College"), { kind: "none" });
  assert.deepEqual(matchCollege(INDEX, ""), { kind: "none" });
  assert.deepEqual(stateHint("Miami University (OH)"), { name: "Miami University", state: "OH" });
  assert.deepEqual(stateHint("Columbia College (Chicago)"), { name: "Columbia College (Chicago)", state: null });
  assert.ok(nameKeys("Texas A&M University").includes("texasaandmuniversity"));
  const l = matchList(INDEX, ["UCLA", "USC", "Nowhere College"]);
  assert.equal(l.match_rate, 0.333);
  assert.deepEqual([l.matched, l.ambiguous, l.unmatched], [1, 1, 1]);
});

test("matching against the real data: every matched id is a real unit_id", () => {
  const colleges = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as { unit_id: string; name: string; location: { state: string } }[];
  const aliases = JSON.parse(readFileSync(join(ROOT, "data", "aliases.json"), "utf8")) as { unit_id: string; key: string; weight: number }[];
  const idx = buildCollegeIndex(colleges.map((c) => ({ unit_id: c.unit_id, name: c.name, state: c.location.state })), aliases);
  const ids = new Set(colleges.map((c) => c.unit_id));
  for (const n of ["UCLA", "University of Southern California", "New York University", "Texas Christian University", "Cornell University", "Purdue University"]) {
    const r = matchCollege(idx, n);
    assert.equal(r.kind, "matched", n);
    if (r.kind === "matched") assert.ok(ids.has(r.unit_id));
  }
  assert.equal(matchCollege(idx, "USC").kind, "ambiguous");
});

/* ------------------------------------------------------------------ */
/* The spend cap                                                       */
/* ------------------------------------------------------------------ */

const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output }) as Anthropic.Usage;

function fakeClient(answer: ProfileAnswer | ((n: number) => ProfileAnswer), u = usage(10_000, 2_000)): ModelClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    messages: {
      async create(body) {
        calls.push(body);
        const a = typeof answer === "function" ? answer(calls.length) : answer;
        return { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(a), citations: null }], stop_reason: "end_turn", stop_sequence: null, usage: u } as unknown as Anthropic.Message;
      },
      stream() {
        throw new Error("no search in this test");
      },
    },
  };
}

test("spend cap: a call whose worst case doesn't fit is never made; actual cost replaces the reservation", async () => {
  const cap = new SpendCap(0.05);
  let called = 0;
  await assert.rejects(cap.run({ school: "x", job: "extraction", model: "claude-haiku-4-5", worst: 0.06 }, async () => (called++, { usage: usage(1, 1) })), SpendCapReached);
  assert.equal(called, 0);
  const { cost } = await cap.run({ school: "x", job: "extraction", model: "claude-haiku-4-5", worst: 0.05 }, async () => ({ usage: usage(10_000, 1_000) }));
  assert.equal(Math.round(cost * 1e6) / 1e6, 0.015); // 10K × $1/M + 1K × $5/M
  assert.equal(cap.spent, 0.015);
  assert.equal(cap.bySchool.get("x"), 0.015);
  assert.ok(cap.canSpend(0.035) && !cap.canSpend(0.036));
  assert.throws(() => new SpendCap(-1));
  assert.equal(worstCaseUsd("claude-haiku-4-5", 1_000_000, 0), 1);
});

test("spend cap: a run stops before the cap and records the schools left as not run", async () => {
  const lines = profileLines().map((l) => l.text.replace(/@\d+ /g, "")).join("<br>");
  const html = `<html><body><p>${lines}</p></body></html>`;
  const http: DiscoverHttp = { get: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }) };
  const schools: RunSchool[] = ["060000100001", "060000100002", "060000100003"].map((id) => ({ id, name: "Fixture Hills High", city: "LA", state: "CA", district: null, kind: "public", grade12: 420 }));
  const recipes = Object.fromEntries(schools.map((s) => [s.id, { id: s.id, name: s.name, tried: [], profile: { url: `https://fixturehills.example.org/${s.id}.html`, format: "html" as const, hash: "old", checked: "2026-01-01" } }]));
  const client = fakeClient({ ...goodAnswer() }, usage(20_000, 3_000)); // $0.035 a call
  // Each extraction reserves its worst case (~$0.07 for this small document): $0.09 covers one school, not two.
  const cap = new SpendCap(0.09);
  const out = await runProfiles(schools, recipes, { http, client, cap, index: INDEX, today: TODAY, run: "test", log: () => {} });
  assert.equal(client.calls.length, 1);
  assert.equal(out.results[0].status === "published" || out.results[0].status === "failed-checks", true);
  assert.deepEqual(out.results.slice(1).map((r) => r.status), ["not-run", "not-run"]);
  assert.ok(out.stopped && /spend cap/.test(out.stopped));
  assert.ok(cap.spent <= cap.cap);
});

/* ------------------------------------------------------------------ */
/* Extraction calls, escalation                                        */
/* ------------------------------------------------------------------ */

test("the request: cheap model by default, structured output, every line numbered", () => {
  const { params } = buildProfileRequest({ school: { id: "060000100001", name: "Fixture Hills High", city: "LA", state: "CA" }, lines: profileLines(), url: "https://x.example/p.pdf" });
  assert.equal(params.model, PROFILE_MODELS.extraction);
  assert.equal(params.model, "claude-haiku-4-5");
  assert.equal((params.output_config as { format: { type: string } }).format.type, "json_schema");
  const user = params.messages[0].content as string;
  assert.match(user, /--- Page 2 ---/);
  assert.match(user, /\n17\| @40 Oxford Brookes University/);
  assert.throws(() => buildProfileRequest({ school: { id: "1", name: "x", city: null, state: "CA" }, lines: [], url: "u", model: "gpt-unpriced" }));
});

test("parse: malformed or cut answers are empty, refusals throw", () => {
  const msg = (text: string, stop: Anthropic.Message["stop_reason"] = "end_turn") => ({ content: [{ type: "text", text, citations: null }] as Anthropic.ContentBlock[], stop_reason: stop });
  assert.deepEqual(parseProfileResponse(msg('{"class_size":{"v":"12","lines":[3]}}')).answer.class_size, { v: "12", lines: [3] });
  assert.deepEqual(parseProfileResponse(msg('{"class_size":', "max_tokens")), { answer: {}, truncated: true });
  assert.throws(() => parseProfileResponse(msg("", "refusal")));
});

test("escalation: only fields a re-read can fix, and the re-read replaces only those", async () => {
  const bad = goodAnswer();
  bad.class_size = { v: "415", lines: [3] };
  const a = assessProfile(bad, ctx());
  assert.deepEqual(escalatableFields(a), ["class_size"]);
  const merged = mergeAnswers(bad, { class_size: { v: "412", lines: [3] }, ap_courses: { names: ["X"], lines: [1] } }, ["class_size"]);
  assert.equal(merged.class_size?.v, "412");
  assert.deepEqual(merged.ap_courses, bad.ap_courses);
  assert.deepEqual(escalatableFields(assessProfile(goodAnswer(), ctx())), []);
  // The runner escalates once, with the stronger model, and publishes the fixed field.
  const lines = profileLines().map((l) => l.text.replace(/@\d+ /g, "")).join("<br>");
  const http: DiscoverHttp = { get: async () => new Response(`<html><body><p>${lines}</p></body></html>`, { status: 200, headers: { "content-type": "text/html" } }) };
  const client = fakeClient((n) => (n === 1 ? bad : goodAnswer()));
  const s: RunSchool = { id: "060000100001", name: "Fixture Hills High", city: "LA", state: "CA", district: null, kind: "public", grade12: 420 };
  const out = await runProfiles([s], { [s.id]: { id: s.id, name: s.name, tried: [], profile: { url: "https://fixturehills.example.org/p.html", format: "html", hash: "old", checked: "2026-01-01" } } }, { http, client, cap: new SpendCap(5), index: INDEX, today: TODAY, run: "t", log: () => {} });
  assert.deepEqual(client.calls.map((c) => c.model), ["claude-haiku-4-5", "claude-sonnet-5"]);
  assert.equal(out.results[0].escalated, true);
  assert.equal(out.results[0].status, "published");
  assert.equal(out.details[0].class_size?.v, 412);
  assert.equal(out.review.filter((r) => r.check === "college-ambiguous").length, 1);
});

test("extractProfile records the call's real cost under the cap", async () => {
  const cap = new SpendCap(1);
  const r = await extractProfile(fakeClient(goodAnswer(), usage(10_000, 2_000)), cap, { school: { id: "s", name: "x", city: null, state: "CA" }, lines: profileLines(), url: "u" });
  assert.equal(Math.round(r.cost * 1e6) / 1e6, 0.02);
  assert.equal(cap.byJob.get("extraction")?.calls, 1);
});

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

const PROFILE_HTML = `<html><body><h1>Fixture Hills High School</h1><p>School Profile 2025-2026. CEEB 051234. Class of 2026: 412 seniors. GPA weighted. AP Biology, AP Calculus AB, AP U.S. History. SAT middle 50% 1150-1350. Grading: A = 4.0, B = 3.0, C = 2.0; honors and AP courses earn one additional point.</p></body></html>`;

function siteHttp(pages: Record<string, { body: string; type?: string; status?: number } | null>): DiscoverHttp & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async get(url) {
      asked.push(url);
      if (!(url in pages)) return new Response("not found", { status: 404 });
      const p = pages[url];
      if (p === null) return null; // robots.txt disallows
      return new Response(p.body, { status: p.status ?? 200, headers: { "content-type": p.type ?? "text/html" } });
    },
  };
}

const SCHOOL = { id: "060000100001", name: "Fixture Hills High", city: "Los Angeles", state: "CA", district: "Fixture Unified", kind: "public" as const };

test("discovery: a seed page's profile link is followed, gated, and recorded with how it was found", async () => {
  const http = siteHttp({
    "https://fhhs.example.org/counseling": { body: `<a href="/docs/school-profile-2025-26.html">School Profile 2025-26</a><a href="/staff">Staff profiles</a>` },
    "https://fhhs.example.org/docs/school-profile-2025-26.html": { body: PROFILE_HTML },
  });
  const r = await discoverProfile(SCHOOL, undefined, { http, log: () => {}, today: TODAY, seeds: ["https://fhhs.example.org/counseling"], free: true });
  assert.equal(r.found?.via, "seed");
  assert.equal(r.recipe.profile?.url, "https://fhhs.example.org/docs/school-profile-2025-26.html");
  assert.equal(r.recipe.found_via, "seed");
  assert.equal(r.recipe.site, "https://fhhs.example.org/");
  assert.deepEqual(r.recipe.pages, ["https://fhhs.example.org/counseling"]);
  assert.ok(!http.asked.includes("https://fhhs.example.org/staff"), "staff profiles are not school profiles");
});

test("discovery: robots.txt refusals are located but never fetched another way", async () => {
  const http = siteHttp({
    "https://fhhs.example.org/counseling": { body: `<a href="https://files.example.net/fhhs-school-profile-2025.pdf">School Profile</a>` },
    "https://files.example.net/fhhs-school-profile-2025.pdf": null,
  });
  const r = await discoverProfile(SCHOOL, undefined, { http, log: () => {}, today: TODAY, seeds: ["https://fhhs.example.org/counseling"], free: true });
  assert.equal(r.found, null);
  assert.deepEqual(r.blocked, ["https://files.example.net/fhhs-school-profile-2025.pdf"]);
  assert.match(r.recipe.notes ?? "", /robots.txt disallows/);
  assert.equal(http.asked.filter((u) => u.includes("files.example.net")).length, 1, "asked once, through the polite client");
});

test("discovery: another school's profile is refused by the gate", async () => {
  const http = siteHttp({ "https://other.example.org/school-profile.html": { body: PROFILE_HTML.replace(/Fixture Hills/g, "Lincoln Heights") } });
  const r = await discoverProfile(SCHOOL, undefined, { http, log: () => {}, today: TODAY, seeds: ["https://other.example.org/x"], free: true });
  assert.equal(r.found, null);
  const doc = { lines: linesFromHtml(PROFILE_HTML.replace(/Fixture Hills/g, "Lincoln Heights")), chars: 300, pageCount: 1, format: "html" as const };
  assert.equal(looksLikeProfile(doc, "Fixture Hills High").reason, "doesn't name this school");
  assert.equal(looksLikeProfile({ ...doc, lines: linesFromHtml(PROFILE_HTML) }, "Fixture Hills High").ok, true);
  assert.equal(nameCoverage("FORT HAMILTON HIGH SCHOOL", "Fort Hamilton H.S. profile"), 1);
});

test("discovery: an unchanged known profile skips the model (304 or same bytes)", async () => {
  const recipe = { id: SCHOOL.id, name: SCHOOL.name, tried: [], profile: { url: "https://fhhs.example.org/p.html", format: "html" as const, hash: "h", etag: '"e1"', checked: "2026-01-01" } };
  const http: DiscoverHttp = { get: async (_u, cond) => (cond?.etag === '"e1"' ? new Response(null, { status: 304 }) : new Response("x")) };
  const r = await discoverProfile(SCHOOL, recipe, { http, log: () => {}, today: TODAY, free: true });
  assert.equal(r.unchanged, true);
  assert.equal(r.recipe.profile?.checked, TODAY);
});

test("discovery helpers: profile links, website links, embedded documents, host kinds", () => {
  assert.equal(isProfileLink({ url: "https://x.org/files/2025-26-School-Profile.pdf", text: "" }), true);
  assert.equal(isProfileLink({ url: "https://x.org/athletics/profile", text: "Athlete profile" }), false);
  assert.equal(isStrictProfile("https://drive.google.com/file/d/1/view School Profile"), true);
  assert.equal(isStrictProfile("https://x.org/profile Edit your profile"), false);
  assert.equal(isWebsiteLink({ url: "https://www.wcbhs.org/", text: "School Website" }, "https://www.schools.nyc.gov/schools/Q445"), true);
  assert.equal(isWebsiteLink({ url: "https://www.schools.nyc.gov/x", text: "School Website" }, "https://www.schools.nyc.gov/schools/Q445"), false);
  const emb = embeddedDocuments(`<iframe src="https://drive.google.com/file/d/ABC/preview"></iframe><a href="/p.pdf">Profile</a><a href="https://docs.google.com/document/d/XYZ/edit">Doc</a>`, "https://s.example.org/page");
  assert.deepEqual(emb.map((e) => e.url), ["https://drive.google.com/file/d/ABC/preview", "https://s.example.org/p.pdf", "https://docs.google.com/document/d/XYZ/export?format=pdf"]);
  assert.equal(registrable("fhs.fortworthisd.net"), "fortworthisd.net");
  assert.equal(hostKind("https://drive.google.com/file/d/1/view", { kind: "public" }), "file-host");
  assert.equal(hostKind("https://www.lausd.org/x.pdf", { kind: "public" }), "district-site");
  assert.equal(hostKind("https://www.fwcd.org/p.pdf", { kind: "private" }), "school-site");
});

/* ------------------------------------------------------------------ */
/* Scoring, measurements, the queue                                    */
/* ------------------------------------------------------------------ */

const KEY: KeyValues = {
  class_size: 412,
  gpa_scale: { kind: "unweighted-4", max: 4, weighted: true },
  gpa_distribution: [{ band: "a", share: 0.5 }, { band: "b", share: 0.5 }],
  ap_courses: ["AP Biology", "AP Calculus AB"],
  ib_courses: null,
  sat_mid50: [1150, 1350],
  act_mid50: null,
  matriculation: { classes: "2025", entries: [{ name: "UCLA", count: 12 }] },
};

test("scoring: correct, both-null, wrong, missed, spurious", () => {
  assert.equal(scoreField("class_size", KEY, { ...KEY }), "correct");
  assert.equal(scoreField("ib_courses", KEY, { ...KEY }), "both-null");
  assert.equal(scoreField("class_size", KEY, { ...KEY, class_size: 400 }), "wrong");
  assert.equal(scoreField("sat_mid50", KEY, { ...KEY, sat_mid50: null }), "missed");
  assert.equal(scoreField("act_mid50", KEY, { ...KEY, act_mid50: [20, 30] }), "spurious");
  assert.equal(scoreField("ap_courses", KEY, { ...KEY, ap_courses: ["Biology", "Calculus AB"] }), "correct", "AP prefixes don't matter");
  assert.equal(f1(["a", "b"], ["a"]), 2 / 3);
  const rep = scoreAgainstKey([{ id: "s", name: "S", url: "u", edition: "2025–26", ...KEY }], new Map([["s", answerValues(goodAnswer())]]));
  assert.equal(rep.schools, 1);
  assert.equal(rep.fields.class_size.correct, 1);
  assert.equal(rep.fields.act_mid50.spurious, 1);
  assert.equal(rep.fields.matriculation.wrong, 1, "four names extracted vs one in the key");
});

test("measurements: findability, located, match rate, cost and time per school", () => {
  const m = measure(
    [{ id: "a", kind: "public" }, { id: "b", kind: "private" }, { id: "c", kind: "public" }],
    [
      { id: "a", status: "published", url: "u", found_via: "seed", host_kind: "school-site", passed: ["class_size", "matriculation"], match: { listed: 10, matched: 8, ambiguous: 1, unmatched: 1 }, cost_usd: 0.02, ms: 3000, requests: 4 },
      { id: "b", status: "blocked", blocked: ["x"], cost_usd: 0, ms: 1000, requests: 3 },
      { id: "c", status: "not-found", cost_usd: 0, ms: 2000, requests: 5 },
    ],
  );
  assert.equal(m.found, 1);
  assert.equal(m.findability, 0.333);
  assert.equal(m.blocked, 1);
  assert.equal(m.located, 2);
  assert.equal(m.matriculation.match_rate, 0.8);
  assert.equal(m.cost_per_school, 0.0067);
  assert.equal(m.ms_per_school, 2000);
  assert.equal(m.by_kind.public.published, 1);
});

test("review queue: a rerun replaces only the schools it ran", () => {
  const item = (id: string, check: string) => ({ id, name: id, url: null, edition: null, field: "document" as const, check: check as "edition", detail: "", queued: TODAY, run: "r" });
  const q = mergeQueue({ updated: "x", items: [item("a", "edition"), item("b", "edition")] }, new Set(["a"]), [item("a", "wrong-school")], TODAY);
  assert.deepEqual(q.items.map((i) => [i.id, i.check]), [["a", "wrong-school"], ["b", "edition"]]);
});

/* ------------------------------------------------------------------ */
/* Committed files                                                     */
/* ------------------------------------------------------------------ */

test("profile-pilot.json: 100 schools across the three metros, as the selection rule picks them", () => {
  const pilot = JSON.parse(readFileSync(join(DATA, "profile-pilot.json"), "utf8"));
  assert.equal(pilot.schools.length, 100);
  assert.deepEqual(new Set(pilot.schools.map((s: { metro: string }) => s.metro)), new Set(PILOT_METROS.map((m) => m.key)));
  assert.ok(pilot.schools.filter((s: { kind: string }) => s.kind === "private").length >= 30);
  const rows = ["CA", "TX", "NY"].flatMap((st) => (JSON.parse(readFileSync(join(DATA, "schools", `${st}.json`), "utf8")).schools as HighSchool[]));
  assert.deepEqual(selectPilot(rows).map((s) => s.id), pilot.schools.map((s: { id: string }) => s.id), "rerunning the rule on the shards gives the committed list");
  if (pilot.latest) assert.equal(pilot.latest.results.length, 100);
});

test("answer key: hand-read schools exist in the shards, shares sum to 1, counts are whole", () => {
  const file = join(ROOT, "data", "reference", "hs-profile-answer-key.json");
  assert.ok(existsSync(file));
  const key = JSON.parse(readFileSync(file, "utf8")) as AnswerKeyFile;
  assert.ok(key.schools.length >= 10);
  const ids = new Set(["CA", "TX", "NY"].flatMap((st) => (JSON.parse(readFileSync(join(DATA, "schools", `${st}.json`), "utf8")).schools as HighSchool[]).map((r) => r.id)));
  for (const s of key.schools) {
    assert.ok(ids.has(s.id), `${s.id} in shards`);
    assert.match(s.edition, /^20\d\d–\d\d$/);
    if (s.gpa_distribution) assert.ok(Math.abs(s.gpa_distribution.reduce((a, b) => a + b.share, 0) - 1) <= 0.02, s.id);
    for (const e of s.matriculation?.entries ?? []) assert.ok(e.count === null || Number.isInteger(e.count), `${s.id} ${e.name}`);
  }
});
