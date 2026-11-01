/**
 * The Common App block on the dataset (specs/data-expansion/common-app.md "Store"; scripts/lib/common-app/merge.mts):
 * members with and without a grid row, a non-member untouched, a stale block removed, the code map, the test-policy
 * newest-wins against a CDS policy (earlier and later as-of dates) and against federal only, the aliases rows, the
 * lineage guard, and the present-only citation rule. Hand-written edition and members fixtures on real schools from
 * data/schools.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { FieldPath } from "../lib/fields";
import type { GridEdition, GridRow, Member, MembersFile } from "../lib/common-app/types";
import { GRID_POLICY, cdsPolicyAsOf, gridCycleFall, gridPolicyVerdict } from "../lib/common-app/test-policy.ts";
import { lineageFor, shortSource, sourcesForFields, validateLineage, validateRegistry, validateSchool } from "../lib/lineage.ts";
import { COMMON_APP_HOME, addCommonAppMeta, applyBlock, applyCommonApp, gridVintage, membersVintage, ownSiteLink } from "../scripts/lib/common-app/merge.mts";
import { commonAppAliasRows } from "../scripts/lib/aliases-sync.mts";

import { miniMeta, miniSchools } from "./helpers/snapshot.mts";

const META: DatasetMeta = miniMeta();
const ALL: School[] = miniSchools();

const VU = "221999"; // a CDS policy (2025–26 C8, read 2026-10-03) already replaced the federal one
// ACU and ADELPHI stand for a real baseline school with federal-only test policy, and a real baseline school, used
// only as a foundation for this file's own hand-built grid/members fixtures (the mini fixture lacks the real
// Common App IDs this test originally picked: Abilene Christian 222178, Adelphi 188429).
const ACU = "186131"; // Princeton: federal policy only, no CDS override (a member with a grid row)
const ABAC = "138558"; // a member with no grid row
const ADELPHI = "100654"; // not a member (Alabama A&M)
const TODAY = "2026-10-25";

/**
 * The committed data carries the real Common App block, so the fixtures start from the data with Common App taken
 * out: meta without the source and its vintages, and each school with its block, Explore facts, and grid policy
 * removed by `applyCommonApp` with no members (which also settles the test policy back to the CDS or federal one).
 */
const BASE_META: DatasetMeta = (() => {
  const m = structuredClone(META);
  delete (m.sources as Record<string, unknown>)["common-app"];
  delete (m.vintages as Record<string, unknown>)["common-app-grid"];
  delete (m.vintages as Record<string, unknown>)["common-app-members"];
  return m;
})();
const NO_MEMBERS: MembersFile = { retrieved: TODAY, sitemap_url: "https://example.org/sitemap.xml", members: [] };
const BASE = new Map(
  applyCommonApp(ALL.filter((s) => [VU, ACU, ABAC, ADELPHI].includes(s.unit_id)), edition(), NO_MEMBERS, TODAY).schools.map((s) => [s.unit_id, s]),
);
/** The school before any Common App block (see BASE). */
const base = (id: string): School => BASE.get(id)!;
const SCHOOLS = [VU, ACU, ABAC, ADELPHI].map((id) => structuredClone(base(id)));
/** The school carrying a grid row with test code `code` from edition `e`: `gridPolicyVerdict` reads the school alone. */
const withApply = (school: School, e: GridEdition, code: GridRow["test_policy"]["code"] = "N"): School => ({
  ...school,
  apply: applyBlock(member("x", school.unit_id), row(school.name, school.unit_id, code), e),
});

const APPLY_PATHS: FieldPath[] = [
  "apply.common_app",
  "apply.deadlines",
  "apply.fee",
  "apply.fee_waiver",
  "apply.essay_required",
  "apply.courses_grades_required",
  "apply.writing_supplement",
  "apply.portfolio",
  "apply.test_policy",
  "apply.recommendations",
  "apply.school_type",
  "apply.saves_forms",
  "aid.international_offered",
  "links.transfer_guarantee",
  "links.daca_aid",
];

function row(name: string, unit_id: string, code: GridRow["test_policy"]["code"], over: Partial<GridRow> = {}): GridRow {
  return {
    name,
    page: 1,
    unit_id,
    slug: name.toLowerCase().replace(/\W+/g, "-"),
    school_type: "coed",
    deadlines: { ed: "2026-11-01", ed2: "2027-01-01", ea: null, ea2: null, rea: null, regular: "2027-01-01" },
    fee: { us: 50, international: 50 },
    fee_waiver: "accepted",
    essay_required: true,
    courses_grades_required: false,
    portfolio: null,
    writing_supplement: true,
    test_policy: { code, tests_used: "See website", english_tests: ["D", "I", "T"] },
    recommendations: { teacher: 2, other: 0, counselor: true, mid_year_report: true },
    saves_forms: false,
    ...over,
  };
}

function edition(over: Partial<GridEdition> = {}): GridEdition {
  return {
    cycle: "2026-27",
    updated: "2026-09-25",
    source_url: "https://example.org/ReqGrid.pdf",
    retrieved: "2026-10-25",
    pages: 55,
    rows: [row("Vanderbilt University", VU, "N"), row("Abilene Christian University", ACU, "S", { deadlines: { ed: null, ed2: null, ea: "2026-11-01", ea2: null, rea: null, regular: "rolling" } })],
    unmatched: [],
    ...over,
  };
}

function member(slug: string, ipeds: string | null, over: Partial<Member> = {}): Member {
  return {
    slug,
    title: slug,
    member_id: `M-${slug}`,
    ipeds,
    state: "TN",
    alternate_names: [],
    aid: { need: true, merit: true, international: null },
    links: { daca_aid: null, transfer_guarantee: null, first_year_admissions: null, financial_aid: null },
    first_year: { essay: true, test_optional: true, fee_waiver: true, self_reported_scores: false, recommendations_required: true },
    retrieved: "2026-10-25",
    ...over,
  };
}

function membersFile(extra: Member[] = []): MembersFile {
  return {
    retrieved: "2026-10-25",
    sitemap_url: "https://example.org/sitemap.xml",
    members: [
      member("vanderbilt-university", VU, {
        alternate_names: ["VU", "Vandy", "Vanderbilt University"],
        aid: { need: true, merit: true, international: true },
        links: { daca_aid: "https://www.vanderbilt.edu/financialaid/daca", transfer_guarantee: null, first_year_admissions: null, financial_aid: null },
      }),
      member("abilene-christian-university", ACU, {
        aid: { need: true, merit: true, international: false },
        links: { daca_aid: "https://www.commonapp.org/explore/abilene", transfer_guarantee: "https://www.princeton.edu/transfer-guarantee", first_year_admissions: null, financial_aid: null },
      }),
      member("abraham-baldwin", ABAC),
      member("nowhere-college", null),
      member("not-in-dataset", "999999"),
      ...extra,
    ],
  };
}

const meta = (): DatasetMeta => {
  const m = structuredClone(META);
  addCommonAppMeta(m, edition(), membersFile());
  return m;
};
const run = (schools = SCHOOLS, e = edition(), mf = membersFile()) => applyCommonApp(schools, e, mf, TODAY);
const get = (schools: School[], id: string) => schools.find((s) => s.unit_id === id)!;

/* ---- Code map ---- */

test("code map: N, I, A, F, S to the site's vocabulary; cycle 2026-27 enters fall 2027", () => {
  assert.deepEqual(GRID_POLICY, { N: "considered", I: "not-considered", A: "required", F: "required", S: "required-some" });
  assert.equal(gridCycleFall("2026-27"), 2027);
  assert.equal(gridCycleFall("next year"), null);
});

/* ---- The block ---- */

test("a member with a grid row gets every apply.* key; Explore facts land on aid and links", () => {
  const { schools, summary } = run();
  const acu = get(schools, ACU);
  assert.deepEqual(acu.apply!.common_app, { member: true, member_id: "M-abilene-christian-university", slug: "abilene-christian-university", cycle: "2026-27", updated: "2026-09-25", retrieved: "2026-10-25" });
  assert.equal(acu.apply!.deadlines!.regular, "rolling");
  assert.deepEqual(acu.apply!.fee, { us: 50, international: 50 });
  assert.equal(acu.apply!.test_policy!.code, "S");
  assert.equal(acu.apply!.writing_supplement, true);
  assert.equal(acu.apply!.courses_grades_required, false);
  assert.equal(acu.aid!.international_offered, false);
  assert.equal(acu.links!.transfer_guarantee, "https://www.princeton.edu/transfer-guarantee");
  // A commonapp.org link is never stored.
  assert.equal(acu.links!.daca_aid, undefined);
  assert.equal(summary.links.offSite, 1);
  // `apply` sits before the keys later pipelines own.
  const keys = Object.keys(acu);
  assert.equal(keys.indexOf("apply"), keys.indexOf("directories") - 1);
  assert.equal(summary.membersWithoutIpeds, 1);
  assert.equal(summary.membersNotInDataset, 1);
  assert.equal(summary.applied, 3);
});

test("a member without a grid row: common_app with cycle null, every other key null", () => {
  const abac = get(run().schools, ABAC);
  assert.equal(abac.apply!.common_app.cycle, null);
  assert.equal(abac.apply!.common_app.updated, null);
  assert.equal(abac.apply!.common_app.retrieved, null);
  for (const [k, v] of Object.entries(abac.apply!)) if (k !== "common_app") assert.equal(v, null, k);
  // An unanswered international-aid question leaves the key absent.
  assert.equal("international_offered" in abac.aid!, false);
  // No grid row, no policy change.
  assert.deepEqual(abac.admissions, base(ABAC).admissions);
});

test("a non-member is untouched (same object); a stale block is removed and the school put back exactly", () => {
  const first = run();
  assert.equal(get(first.schools, ADELPHI), SCHOOLS[3]);
  // ACU leaves Common App: its block, Explore facts, and grid policy go; the school is byte-identical to before.
  const mf = membersFile();
  mf.members = mf.members.filter((m) => m.ipeds !== ACU);
  const second = run(first.schools, edition(), mf);
  assert.equal(second.summary.removed, 1);
  assert.deepEqual(JSON.stringify(get(second.schools, ACU)), JSON.stringify(base(ACU)));
});

test("re-applying is a no-op", () => {
  const first = run();
  const second = run(first.schools);
  assert.equal(JSON.stringify(second.schools), JSON.stringify(first.schools));
  for (let i = 0; i < first.schools.length; i++) assert.equal(second.schools[i], first.schools[i]);
});

/* ---- Newest wins for the test policy ---- */

test("against federal only, the grid's policy wins; the federal one is kept and cited in the ⓘ", () => {
  const acu = get(run().schools, ACU);
  assert.equal(acu.admissions.test_policy, "required-some");
  assert.deepEqual(acu.admissions.federal_tests, { policy: { year: null, test_policy: base(ACU).admissions.test_policy } });
  assert.deepEqual(acu.lineage!["admissions.test_policy"], { source: "common-app", year: "2026-27 cycle, updated September 25, 2026", url: COMMON_APP_HOME, retrieved: "2026-10-25" });
  const c = lineageFor("admissions.test_policy", acu, meta());
  assert.equal(c.key, "common-app");
  assert.equal(c.label, "Common App");
  assert.equal(c.year, "2026-27 cycle, updated September 25, 2026");
  assert.equal(c.replaces?.text, "Test-optional");
});

/** An edition stamped before the CDS edition's as-of date (2026-01-01), so the CDS is the newer statement. */
const earlyEdition = (over: Partial<GridEdition> = {}) => edition({ updated: "2025-12-01", ...over });

test("the CDS as-of date is its edition's (January 1 of the second year), never the day Quad read it", () => {
  const vu = base(VU);
  assert.equal(vu.lineage!["reported.test_policy"]!.retrieved, "2026-10-03");
  assert.equal(cdsPolicyAsOf(vu), "2026-01-01");
  const noEdition = structuredClone(vu);
  delete noEdition.lineage!["reported.test_policy"]!.edition;
  assert.equal(cdsPolicyAsOf(noEdition), null);
});

test("same cycle, CDS edition older than the grid's stamp: the grid wins; the federal block stays as the CDS kept it", () => {
  const vu = base(VU);
  // Read 2026-10-03, after the grid's 2026-09-25 stamp: the read date doesn't matter, the 2025–26 edition does.
  assert.equal(gridPolicyVerdict(withApply(vu, edition())), "grid");
  const { schools, summary } = run(SCHOOLS, edition({ rows: [row("Vanderbilt University", VU, "A")] }));
  const out = get(schools, VU);
  assert.equal(out.admissions.test_policy, "required");
  assert.equal(out.lineage!["admissions.test_policy"]!.source, "common-app");
  assert.deepEqual(out.admissions.federal_tests, vu.admissions.federal_tests, "the federal block is kept, never the CDS value");
  assert.equal(summary.testPolicy.overCds, 1);
  // An edition the CDS beats puts the CDS policy back, byte for byte (the same as never having applied the grid's).
  const back = get(run(schools, earlyEdition()).schools, VU);
  assert.equal(JSON.stringify(back), JSON.stringify(get(run(SCHOOLS, earlyEdition()).schools, VU)));
  assert.deepEqual(back.admissions, vu.admissions);
  assert.deepEqual(Object.keys(back.lineage!), Object.keys(vu.lineage!));
});

test("a grid stamped before the CDS edition's as-of date leaves the CDS policy", () => {
  const vu = base(VU);
  assert.equal(gridPolicyVerdict(withApply(vu, earlyEdition())), "cds-newer");
  const { schools, summary } = run(SCHOOLS, earlyEdition());
  const out = get(schools, VU);
  assert.deepEqual(out.admissions, vu.admissions);
  assert.equal(out.lineage!["admissions.test_policy"]!.source, "college-site");
  assert.equal(summary.testPolicy.cdsNewer, 1);
});

test("a 2026–27 CDS stating the policy for fall 2028 applicants beats the grid by cycle", () => {
  const vu = structuredClone(base(VU));
  vu.reported!.test_policy!.cycle = 2028;
  vu.lineage!["reported.test_policy"]!.edition = "2026–27";
  assert.equal(cdsPolicyAsOf(vu), "2027-01-01");
  assert.equal(gridPolicyVerdict(withApply(vu, edition())), "cds-newer");
  // The cycle check comes first: even a grid stamped after the edition's as-of date loses.
  assert.equal(gridPolicyVerdict(withApply(vu, edition({ updated: "2027-02-01" }))), "cds-newer");
  // No grid row at all: nothing to judge.
  assert.equal(gridPolicyVerdict(vu), "no-grid");
});

/* ---- Lineage ---- */

test("validateLineage passes on the result, and the guard refuses broken grid policies", () => {
  const m = meta();
  const { schools } = run();
  assert.deepEqual(validateLineage(schools, m), []);
  const acu = get(schools, ACU);
  // A value that disagrees with the grid's code.
  const wrong = structuredClone(acu);
  wrong.admissions.test_policy = "required";
  assert.ok(validateSchool(wrong, m).some((e) => e.includes("disagrees with the grid's code S")));
  // A missing record: the replaced block is kept but the value cites nothing.
  const noRecord = structuredClone(acu);
  delete noRecord.lineage!["admissions.test_policy"];
  assert.ok(validateSchool(noRecord, m).some((e) => e.includes("inside a replaced policy block")));
  // An incomplete record.
  const partial = structuredClone(acu);
  delete partial.lineage!["admissions.test_policy"]!.retrieved;
  assert.ok(validateSchool(partial, m).some((e) => e.includes("lacks year, url, or retrieved")));
  // No grid row left to vouch for it.
  const noRow = structuredClone(acu);
  noRow.apply!.test_policy = null;
  assert.ok(validateSchool(noRow, m).some((e) => e.includes("has no apply.test_policy")));
  // The federal block not kept.
  const notKept = structuredClone(acu);
  delete notKept.admissions.federal_tests;
  assert.ok(validateSchool(notKept, m).some((e) => e.includes("doesn't keep the policy it replaced")));
});

test("meta may lack Common App until the merge runs; after that, the source and both vintages are required", () => {
  assert.deepEqual(validateRegistry(BASE_META).filter((e) => e.includes("common-app")), []);
  const m = meta();
  assert.deepEqual(validateRegistry(m), []);
  const noSource: DatasetMeta = { ...m, sources: { ...m.sources, "common-app": undefined } };
  assert.ok(validateRegistry(noSource).includes("meta.json: sources.common-app is missing"));
  const noVintage = structuredClone(m);
  delete (noVintage.vintages as Record<string, unknown>)["common-app-members"];
  assert.ok(validateRegistry(noVintage).includes("meta.json: vintages.common-app-members is missing"));
  // A school holding Common App values needs them even when meta never had the source.
  const acu = get(run().schools, ACU);
  assert.ok(validateSchool(acu, BASE_META).some((e) => e.includes("meta.json has no sources.common-app")));
});

test("vintages come from the files: grid edition and member pages", () => {
  const m = meta();
  assert.equal(m.vintages["common-app-grid"], gridVintage(edition()));
  assert.equal(m.vintages["common-app-grid"], "2026-27 cycle, updated September 25, 2026");
  assert.equal(m.vintages["common-app-members"], membersVintage(membersFile()));
  assert.equal(m.sources["common-app"]!.url, COMMON_APP_HOME);
  assert.equal(m.sources["common-app"]!.label, "Common App");
});

test("present-only: a non-member's footnotes skip Common App; a member's name it with the vintage text", () => {
  const m = meta();
  const { schools } = run();
  assert.deepEqual(sourcesForFields(APPLY_PATHS, get(schools, ADELPHI), m), []);
  // A member without a grid row has only common_app: still Common App, but its null grid values cite nothing extra.
  const abac = sourcesForFields(["apply.deadlines", "apply.fee"], get(schools, ABAC), m);
  assert.deepEqual(abac, []);
  const vu = sourcesForFields(APPLY_PATHS, get(schools, VU), m);
  const grid = vu.find((s) => s.key === "common-app" && s.year === m.vintages["common-app-grid"]);
  assert.ok(grid, "the grid is named");
  assert.equal(shortSource(grid!), "Common App 2026-27 cycle, updated September 25, 2026");
  assert.ok(vu.some((s) => s.key === "common-app" && s.year === m.vintages["common-app-members"]), "the member pages are named");
  const d = lineageFor("apply.deadlines", get(schools, VU), m);
  assert.equal(`${d.label}, ${d.year}`, "Common App, 2026-27 cycle, updated September 25, 2026");
  assert.equal(lineageFor("aid.international_offered", get(schools, VU), m).year, "Member pages read October 25, 2026");
});

/* ---- Links and aliases ---- */

test("links are kept only on the college's own site", () => {
  assert.equal(ownSiteLink("https://admissions.vanderbilt.edu/transfer", "https://www.vanderbilt.edu/"), "https://admissions.vanderbilt.edu/transfer");
  assert.equal(ownSiteLink("https://www.commonapp.org/explore/x", null), null);
  assert.equal(ownSiteLink("https://other.edu/daca", "https://www.vanderbilt.edu/"), null);
  assert.equal(ownSiteLink("not a url", null), null);
  assert.equal(ownSiteLink("https://www.aber.ac.uk/en/", "https://aber.ac.uk"), "https://www.aber.ac.uk/en/");
});

test("aliases: alternate names become common-app rows at weight 2; the official name is dropped", () => {
  const rows = commonAppAliasRows(SCHOOLS, membersFile());
  assert.deepEqual(
    rows.map((r) => [r.unit_id, r.alias, r.source, r.weight]),
    [
      [VU, "VU", "common-app", 2],
      [VU, "Vandy", "common-app", 2],
    ],
  );
  assert.deepEqual(commonAppAliasRows(SCHOOLS, null), []);
});

test("a grid stamp after today is refused", () => {
  assert.throws(() => applyCommonApp(SCHOOLS, edition({ updated: "2027-01-01" }), membersFile(), TODAY), /after today/);
});
