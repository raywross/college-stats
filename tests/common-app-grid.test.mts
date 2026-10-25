/**
 * Common App Requirements Grid parser, member reader, and name join (specs/data-expansion/common-app.md;
 * common-app-build/brief.md, unit U1a): scripts/lib/common-app/{grid,members,names,edition-file}.mts.
 *
 * Fixtures (tests/fixtures/common-app/) are layout text cut from the 2026-27 grid (updated 2026-09-25), with blank
 * lines between rows (the layout-text format spaces every line 12 pt, so blank lines keep each wrapped line nearest its
 * own row, as the real 22 pt rows do). Two cells are made up to cover what the edition doesn't print: Worcester
 * Polytechnic's Writing "Y" (no 2026-27 row has one) and Albizu's Courses & Grades, COL, I, OE, and "N" cells. The
 * Vanderbilt page data is trimmed, and its transfer-guarantee URL is swapped for a commonapp.org one to prove it is
 * dropped. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pagesFromLayoutText } from "../scripts/lib/college-reported/layout.mts";
import { cycleWindow, editionFromHeader, gridProblems, gridWarnings, parseFee, parseGrid, parseGridDate } from "../scripts/lib/common-app/grid.mts";
import { fetchMember, memberFromPageData, membersFileText, ownSiteUrl, slugsFromSitemap, splitAlternateNames } from "../scripts/lib/common-app/members.mts";
import { joinNames, normalizeTitle } from "../scripts/lib/common-app/names.mts";
import { editionFileText, newestEdition } from "../scripts/lib/common-app/edition-file.mts";
import type { GridEdition, GridRow, Member } from "../lib/common-app/types.ts";

const FIX = join(import.meta.dirname, "fixtures", "common-app");
const pages = (file: string) => pagesFromLayoutText(readFileSync(join(FIX, file), "utf8"));
const grid = parseGrid([...pages("grid-page.txt"), ...pages("grid-notes.txt")]);
const row = (name: string) => {
  const r = grid.rows.find((x) => x.name === name);
  assert.ok(r, `no row "${name}" in ${grid.rows.map((x) => x.name).join(" | ")}`);
  return r;
};

/* ---------------------------------------------------------------- */
/* Grid                                                              */
/* ---------------------------------------------------------------- */

test("edition comes from the page header, never typed", () => {
  assert.deepEqual(editionFromHeader(pages("grid-page.txt")), { cycle: "2026-27", updated: "2026-09-25" });
  assert.equal(grid.cycle, "2026-27");
  assert.equal(grid.updated, "2026-09-25");
  assert.equal(grid.pages, 2);
  assert.throws(() => editionFromHeader(pagesFromLayoutText("=== Page 1 ===\n@21 Some College | @85 Coed")), /stamp/);
});

test("one row per School-type cell; header rows and the notes page never become rows", () => {
  assert.deepEqual(
    grid.rows.map((r) => r.name),
    [
      "Aberystwyth University",
      "Abilene Christian University",
      "Agnes Scott College",
      "College of Saint Benedict",
      "Harvard University",
      "Worcester Polytechnic Institute",
      "Woodbury University – now University of Redlands, Los Angeles",
      "Winthrop University",
      "American University in Bulgaria",
      "Simmons University",
      "Albizu University-Miami",
    ]
  );
  assert.equal(grid.school_type_cells, 11);
  assert.deepEqual(grid.issues, []);
  assert.deepEqual(parseGrid(pages("grid-notes.txt")).rows, []);
  assert.deepEqual(gridProblems(grid), []);
});

test("a wrapped name joins its lines above and below the row with one space", () => {
  const r = row("Abilene Christian University");
  assert.equal(r.page, 1);
  assert.deepEqual(r.deadlines, { ed: null, ed2: null, ea: "2026-11-01", ea2: null, rea: null, regular: "2027-02-01" });
  assert.equal(r.test_policy.tests_used, "SAT without essay or ACT with science");
  assert.deepEqual(r.test_policy.english_tests, ["D", "I", "T"]);
  assert.ok(grid.rows.some((x) => x.name === "Woodbury University – now University of Redlands, Los Angeles"));
});

test('"See website" is kept as text; wrapped "tests used" and English cells join', () => {
  const a = row("Aberystwyth University");
  assert.equal(a.test_policy.code, "F");
  assert.equal(a.test_policy.tests_used, "See website");
  assert.deepEqual(a.test_policy.english_tests, []);
  assert.equal(a.deadlines.regular, "rolling");
  assert.deepEqual(a.fee, { us: 0, international: 20 });
  assert.equal(row("Winthrop University").test_policy.tests_used, "SAT without essay or ACT without science or writing");
  assert.deepEqual(row("American University in Bulgaria").test_policy.english_tests, ["C", "D", "I", "T", "P"]);
});

test("a Coordinate college, a women's college, and a U.S.-only waiver", () => {
  const sb = row("College of Saint Benedict");
  assert.equal(sb.school_type, "coordinate");
  assert.deepEqual(sb.deadlines, { ed: null, ed2: null, ea: "2026-11-01", ea2: "2026-12-01", rea: null, regular: "2027-01-15" });
  const agnes = row("Agnes Scott College");
  assert.equal(agnes.school_type, "women");
  assert.equal(agnes.fee_waiver, "us_only");
  assert.deepEqual(agnes.deadlines, { ed: "2026-11-01", ed2: null, ea: "2026-11-15", ea2: "2027-01-15", rea: null, regular: "2027-03-15" });
});

test("every round lands in its own column (ED, EDII, EA, EAII; REA)", () => {
  const wpi = row("Worcester Polytechnic Institute");
  assert.deepEqual(wpi.deadlines, { ed: "2026-11-01", ed2: "2027-01-05", ea: "2026-11-01", ea2: "2027-01-05", rea: null, regular: "2027-02-01" });
  assert.equal(wpi.writing_supplement, true, "the narrow Writing column has its own window");
  assert.equal(wpi.portfolio, null);
  assert.deepEqual(wpi.recommendations, { teacher: 1, other: 0, counselor: true, mid_year_report: true });
  const h = row("Harvard University");
  assert.deepEqual(h.deadlines, { ed: null, ed2: null, ea: null, ea2: null, rea: "2026-11-01", regular: "2027-01-01" });
  assert.equal(h.portfolio, "slideroom");
  assert.equal(h.essay_required, true);
  assert.equal(h.courses_grades_required, false);
  assert.equal(h.writing_supplement, false);
  assert.equal(h.saves_forms, true);
  assert.deepEqual(h.recommendations, { teacher: 2, other: 0, counselor: true, mid_year_report: true });
});

test("codes, blanks, and the not-accepted waiver", () => {
  const al = row("Albizu University-Miami");
  assert.equal(al.fee_waiver, "not_accepted");
  assert.equal(al.courses_grades_required, true);
  assert.equal(al.essay_required, false);
  assert.equal(al.portfolio, "own");
  assert.equal(al.test_policy.code, "I");
  assert.deepEqual(al.test_policy.english_tests, ["N"]);
  assert.equal(al.recommendations.other, 1);
  assert.equal(al.saves_forms, false);
  assert.equal(row("Aberystwyth University").fee_waiver, "accepted");
  assert.equal(row("College of Saint Benedict").fee_waiver, null);
});

test('a "#ERROR!" cell (a spreadsheet error in the grid) reads as blank with a warning', () => {
  assert.equal(row("Simmons University").test_policy.tests_used, null);
  assert.ok(grid.warnings.some((w) => /Simmons University.*#ERROR!/.test(w)));
});

test("dates, fees, and the cycle window", () => {
  assert.equal(parseGridDate("11/1/2026"), "2026-11-01");
  assert.equal(parseGridDate("02/01/2027"), "2027-02-01");
  assert.equal(parseGridDate("2/30/2027"), null);
  assert.equal(parseGridDate("Rolling"), null);
  assert.equal(parseFee("$0"), 0);
  assert.equal(parseFee("$1,000"), 1000);
  assert.equal(parseFee("free"), null);
  assert.deepEqual(cycleWindow("2026-27"), ["2026-09-01", "2027-08-31"]);
});

test("gridProblems fails a date outside the window, a header row, a row read twice, and a fee over $250", () => {
  const bad = parseGrid(pages("grid-bad.txt"));
  const problems = gridProblems(bad);
  assert.ok(problems.some((p) => /Late Deadline College.*2027-09-15 is outside the 2026-27 cycle/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /"Common App member": header or notes text/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /"twice read college" appears 2 times/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /Dear College.*us fee 300 is outside/.test(p)), problems.join("\n"));
});

test("gridProblems fails a row count more than 2% from the School-type cells, and parse issues", () => {
  assert.deepEqual(gridProblems({ ...grid, school_type_cells: 11 }), []);
  assert.ok(gridProblems({ ...grid, school_type_cells: 13 }).some((p) => /more than 2% apart/.test(p)));
  assert.ok(gridProblems({ ...grid, rows: [] }).some((p) => /no rows/.test(p)));
  assert.ok(gridProblems({ ...grid, issues: ["page 3: stray"] }).includes("page 3: stray"));
  const badCode = { ...grid.rows[0], test_policy: { ...grid.rows[0].test_policy, code: "X" as never } };
  assert.ok(gridProblems({ ...grid, rows: [badCode], school_type_cells: 1 }).some((p) => /test policy "X"/.test(p)));
});

test("text far from every row is an issue, not silently dropped", () => {
  const text = readFileSync(join(FIX, "grid-page.txt"), "utf8").replace("@380 Page 1", "\n\n\n@300 stray note");
  const g = parseGrid(pagesFromLayoutText(text));
  assert.ok(g.issues.some((i) => /stray note.*from any row/.test(i)), g.issues.join("\n"));
  assert.ok(gridProblems(g).length > 0);
});

test("a name printed on several differing rows is a warning and is never joined", () => {
  const a = row("Harvard University");
  const rows: GridRow[] = [
    { ...a, name: "Siena University" },
    { ...a, name: "Siena University", deadlines: { ...a.deadlines, regular: "2027-02-15" } },
  ];
  assert.deepEqual(gridProblems({ ...grid, rows, school_type_cells: 2 }), []);
  assert.equal(gridWarnings(rows).length, 1);
  const m = member({ slug: "siena-university", title: "Siena University", ipeds: "195544" });
  const j = joinNames(rows, [m], [], {}, [{ unit_id: "195544" }]);
  assert.deepEqual(j.unmatched, ["Siena University", "Siena University"]);
  assert.ok(j.rows.every((r) => r.slug === null && r.unit_id === null));
});

/* ---------------------------------------------------------------- */
/* Members                                                           */
/* ---------------------------------------------------------------- */

function member(over: Partial<Member> & Pick<Member, "slug" | "title">): Member {
  return {
    member_id: null,
    ipeds: null,
    state: null,
    alternate_names: [],
    aid: { need: null, merit: null, international: null },
    links: { daca_aid: null, transfer_guarantee: null, first_year_admissions: null, financial_aid: null },
    first_year: { essay: false, test_optional: false, fee_waiver: false, self_reported_scores: false, recommendations_required: false },
    retrieved: "2026-10-25",
    ...over,
  };
}

const vandyBody = JSON.parse(readFileSync(join(FIX, "page-data-vanderbilt.json"), "utf8"));

test("a member record keeps only the Member fields", () => {
  const m = memberFromPageData("vanderbilt-university", vandyBody, "2026-10-25");
  assert.deepEqual(m, {
    slug: "vanderbilt-university",
    title: "Vanderbilt University",
    member_id: "277",
    ipeds: "221999",
    state: "TN",
    alternate_names: ["VU", "Vandy"],
    aid: { need: true, merit: true, international: false },
    links: {
      daca_aid: "https://www.vanderbilt.edu/financialaid/undergraduate/international/",
      transfer_guarantee: null,
      first_year_admissions: "https://admissions.vanderbilt.edu/",
      financial_aid: "http://www.vanderbilt.edu/financialaid/undergraduate/index.php",
    },
    first_year: { essay: true, test_optional: true, fee_waiver: false, self_reported_scores: true, recommendations_required: true },
    retrieved: "2026-10-25",
  });
  const text = JSON.stringify(m);
  assert.ok(!/admissions@|322-2561|heart of Nashville|love it here/.test(text), "no emails, phones, marketing text, or quotes");
  assert.equal(memberFromPageData("x", { result: { data: {} } }, "2026-10-25"), null);
});

test("member helpers: sitemap slugs, own-site URLs, alternate names, non-US state", () => {
  const xml =
    "<urlset><url><loc>https://www.commonapp.org/explore/vanderbilt-university</loc></url><url><loc>https://www.commonapp.org/plan/why-college-matters</loc></url>" +
    "<url><loc>https://www.commonapp.org/explore/austin-college</loc></url><url><loc>https://www.commonapp.org/explore/austin-college</loc></url></urlset>";
  assert.deepEqual(slugsFromSitemap(xml), ["austin-college", "vanderbilt-university"]);
  assert.equal(ownSiteUrl("https://www.commonapp.org/explore/x"), null);
  assert.equal(ownSiteUrl("https://apply.commonapp.org/"), null);
  assert.equal(ownSiteUrl("mailto:a@b.edu"), null);
  assert.equal(ownSiteUrl("https://www.wpi.edu/admissions"), "https://www.wpi.edu/admissions");
  assert.deepEqual(splitAlternateNames("K-State, KSU,  Dub Dub U "), ["K-State", "KSU", "Dub Dub U"]);
  const abroad = structuredClone(vandyBody);
  abroad.result.data.nodeSchool.relationships.field_site_update.field_su_addr_country = "United Kingdom";
  abroad.result.data.nodeSchool.relationships.field_site_update.field_su_ipeds = null;
  const m = memberFromPageData("aberystwyth-university", abroad, "2026-10-25");
  assert.equal(m?.state, null);
  assert.equal(m?.ipeds, null);
});

test("fetchMember makes one request through the given client; a 404 is null", async () => {
  const urls: string[] = [];
  const http = {
    get: async (url: string) => {
      urls.push(url);
      return url.includes("gone") ? new Response("", { status: 404 }) : new Response(JSON.stringify(vandyBody), { status: 200 });
    },
  };
  const m = await fetchMember(http as never, "vanderbilt-university", "2026-10-25");
  assert.equal(m?.ipeds, "221999");
  assert.equal(await fetchMember(http as never, "gone", "2026-10-25"), null);
  assert.deepEqual(urls, ["https://www.commonapp.org/page-data/explore/vanderbilt-university/page-data.json", "https://www.commonapp.org/page-data/explore/gone/page-data.json"]);
  const bad = { get: async () => new Response("", { status: 500 }) };
  await assert.rejects(fetchMember(bad as never, "x", "2026-10-25"), /HTTP 500/);
});

test("members file text: sorted by slug, one member per line, parses back", () => {
  const a = member({ slug: "b-college", title: "B" });
  const b = member({ slug: "a-college", title: "A" });
  const text = membersFileText({ retrieved: "2026-10-25", sitemap_url: "https://www.commonapp.org/sitemap-0.xml", members: [a, b] });
  const back = JSON.parse(text);
  assert.deepEqual(back.members.map((m: Member) => m.slug), ["a-college", "b-college"]);
  assert.equal(text.split("\n").filter((l) => l.includes('"slug"')).length, 2);
});

/* ---------------------------------------------------------------- */
/* Name join                                                         */
/* ---------------------------------------------------------------- */

test("normalized titles: case and the spaces and dashes around a hyphen", () => {
  assert.equal(normalizeTitle("University of Michigan- Dearborn"), normalizeTitle("University of Michigan-Dearborn"));
  assert.equal(normalizeTitle("Marian University - Indiana"), normalizeTitle("Marian University-Indiana"));
  assert.equal(normalizeTitle("Marian University – Indiana"), normalizeTitle("marian university-indiana"));
  assert.equal(normalizeTitle("Saint Mary’s College"), normalizeTitle("Saint Mary's College"));
  assert.notEqual(normalizeTitle("Marian University Indiana"), normalizeTitle("Marian University-Indiana"));
});

test("joinNames: exact, normalized, alias, name map; a member without IPEDS joins to its slug only", () => {
  const base = row("Harvard University");
  const r = (name: string): GridRow => ({ ...base, name });
  const members = [
    member({ slug: "harvard-university", title: "Harvard University", ipeds: "166027" }),
    member({ slug: "university-of-michigan-dearborn", title: "University of Michigan-Dearborn", ipeds: "171137" }),
    member({ slug: "wheaton-college-ma", title: "Wheaton College (MA)", ipeds: "168281" }),
    member({ slug: "bard-college-berlin", title: "Bard College Berlin", ipeds: null }),
    member({ slug: "community-college-x", title: "Community College X", ipeds: "999999" }),
    member({ slug: "texas-am", title: "Texas A&M University", ipeds: "228723" }),
  ];
  const aliases = [{ unit_id: "168281", key: "wheatoncollegemassachusetts" }];
  const schools = [{ unit_id: "166027" }, { unit_id: "171137" }, { unit_id: "168281" }, { unit_id: "228723" }];
  const j = joinNames(
    [r("Harvard University"), r("University of Michigan- Dearborn"), r("Wheaton College, Massachusetts"), r("Bard College Berlin"), r("Community College X"), r("Texas A & M"), r("Nowhere College")],
    members,
    aliases,
    { "Texas A & M": "texas-am" },
    schools
  );
  assert.deepEqual(j.rule, ["title", "normalized", "alias", "title", "title", "name-map", null]);
  assert.deepEqual(
    j.rows.map((x) => [x.slug, x.unit_id]),
    [
      ["harvard-university", "166027"],
      ["university-of-michigan-dearborn", "171137"],
      ["wheaton-college-ma", "168281"],
      ["bard-college-berlin", null],
      ["community-college-x", null],
      ["texas-am", "228723"],
      [null, null],
    ]
  );
  assert.deepEqual(j.unmatched, ["Nowhere College"]);
  assert.equal(j.stats.matched, 4);
  assert.equal(j.stats.member_without_ipeds, 1);
  assert.equal(j.stats.ipeds_not_carried, 1);
});

test("joinNames never guesses: near names, ambiguous aliases, and stale map entries stay unmatched", () => {
  const base = row("Harvard University");
  const r = (name: string): GridRow => ({ ...base, name });
  const members = [
    member({ slug: "harvard-university", title: "Harvard University", ipeds: "166027" }),
    member({ slug: "saint-johns-mn", title: "Saint John's University (MN)", ipeds: "174792" }),
    member({ slug: "st-johns-ny", title: "St. John's University (NY)", ipeds: "195809" }),
  ];
  // "sju" belongs to two members: an alias that names two colleges joins neither.
  const aliases = [
    { unit_id: "174792", key: "sju" },
    { unit_id: "195809", key: "sju" },
    { unit_id: "100000", key: "harvarduniv" }, // not a member's id
  ];
  const j = joinNames([r("Harvard Univ"), r("Harvard University Extension"), r("SJU"), r("Saint Johns University")], members, aliases, { "Gone College": "gone-college" }, [{ unit_id: "166027" }]);
  assert.deepEqual(j.unmatched, ["Harvard Univ", "Harvard University Extension", "SJU", "Saint Johns University"]);
  assert.ok(j.rows.every((x) => x.slug === null));
  assert.deepEqual(j.staleMap, ["Gone College → gone-college (not a member)"]);
});

/* ---------------------------------------------------------------- */
/* Edition file                                                      */
/* ---------------------------------------------------------------- */

test("edition file: stable text, one row per line, newest by stamp", () => {
  const edition: GridEdition = { cycle: grid.cycle, updated: grid.updated, source_url: "https://content.commonapp.org/Files/ReqGrid.pdf", retrieved: "2026-10-25", pages: 2, rows: grid.rows, unmatched: ["Nowhere College"] };
  const text = editionFileText(edition);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(edition)));
  assert.equal(text.split("\n").filter((l) => l.startsWith('    {"name"')).length, grid.rows.length);
  const dir = mkdtempSync(join(tmpdir(), "common-app-"));
  try {
    assert.equal(newestEdition(dir), null);
    writeFileSync(join(dir, "2026-27_2026-09-25.json"), text);
    writeFileSync(join(dir, "2026-27_2026-08-01.json"), editionFileText({ ...edition, updated: "2026-08-01" }));
    writeFileSync(join(dir, "2025-26_2026-01-10.json"), editionFileText({ ...edition, cycle: "2025-26", updated: "2026-01-10" }));
    const n = newestEdition(dir);
    assert.equal(n?.cycle, "2026-27");
    assert.equal(n?.updated, "2026-09-25");
    assert.equal(n?.file.rows.length, grid.rows.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
