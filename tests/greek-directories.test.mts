/**
 * Greek-life national directory adapters (specs/greek-life.md phase 4, specs/campus-directories.md): each
 * adapter's parser, tested on a short fixture string that reproduces the real page's shape — never a stored copy
 * of the page. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ninjaTableRequestUrl, ninjaTableRows } from "../scripts/lib/directories/adapters/_ninja-tables.mts";
import { wpgmpPlaces } from "../scripts/lib/directories/adapters/_wpgmp.mts";
import { textOf, decodeEntities } from "../scripts/lib/directories/adapters/_html.mts";
import { entriesFromRows as sigepRows } from "../scripts/lib/directories/adapters/sigep.mts";
import { entriesFromRows as kappaSigmaRows } from "../scripts/lib/directories/adapters/kappa-sigma.mts";
import { parseChaptersMapData, entriesFrom as lambdaChiEntries } from "../scripts/lib/directories/adapters/lambda-chi-alpha.mts";
import { splitTitle, entriesFrom as pikappEntries } from "../scripts/lib/directories/adapters/pi-kappa-phi.mts";
import { parseActiveTable, entriesFrom as sigmaNuEntries } from "../scripts/lib/directories/adapters/sigma-nu.mts";
import { parseTable as opbParseTable, entriesFrom as opbEntries } from "../scripts/lib/directories/adapters/omega-phi-beta.mts";
import { adapterProblems } from "../scripts/lib/directories/registry.mts";
import { groupListings, latestDirectoryRead, listingsFor, type DirectoryRows } from "../lib/directories.ts";
import { compareGreekCouncils, greekParticipationBlankOrZero, hasGreekCouncil, matchesGreekCouncils } from "../lib/cds/greek-display.ts";
import sigep from "../scripts/lib/directories/adapters/sigep.mts";
import kappaSigma from "../scripts/lib/directories/adapters/kappa-sigma.mts";
import lambdaChiAlpha from "../scripts/lib/directories/adapters/lambda-chi-alpha.mts";
import piKappaPhi from "../scripts/lib/directories/adapters/pi-kappa-phi.mts";
import sigmaNu from "../scripts/lib/directories/adapters/sigma-nu.mts";
import omegaPhiBeta from "../scripts/lib/directories/adapters/omega-phi-beta.mts";
import kappaAlphaPsi from "../scripts/lib/directories/adapters/kappa-alpha-psi.mts";

/* ------------------------------------------------------------------ */
/* Every adapter this track added is well-formed (registry checks)     */
/* ------------------------------------------------------------------ */

test("greek adapters: all seven are well-formed and classified under the right council", () => {
  const byKey: Record<string, { council: string }> = {
    sigep: { council: "nic" },
    "kappa-sigma": { council: "nic" },
    "lambda-chi-alpha": { council: "nic" },
    "pi-kappa-phi": { council: "nic" },
    "sigma-nu": { council: "nic" },
    "omega-phi-beta": { council: "nalfo" },
    "kappa-alpha-psi": { council: "nphc" },
  };
  for (const a of [sigep, kappaSigma, lambdaChiAlpha, piKappaPhi, sigmaNu, omegaPhiBeta, kappaAlphaPsi]) {
    assert.deepEqual(adapterProblems(a, `${a.key}.mts`), []);
    assert.equal(a.domain, "greek");
    assert.equal((a as { council: string }).council, byKey[a.key].council, a.key);
    assert.equal(a.tier, "D");
  }
});

/* ------------------------------------------------------------------ */
/* _html.mts, _ninja-tables.mts, _wpgmp.mts                             */
/* ------------------------------------------------------------------ */

test("_html: decodes entities and strips tags", () => {
  assert.equal(decodeEntities("Men&#8217;s &amp; Women&#8217;s"), "Men’s & Women’s");
  assert.equal(textOf("<td class=\"school\">Auburn &amp; <b>State</b></td>"), "Auburn & State");
});

test("_ninja-tables: extracts the ajax URL and unwraps { value } rows", () => {
  const html = `<script>{"data_request_url":"https:\\/\\/sigep.org\\/wp-admin\\/admin-ajax.php?action=wp_ajax_ninja_tables_public_action\\u0026table_id=18473\\u0026target_action=get-all-data\\u0026ninja_table_public_nonce=abc123"}</script>`;
  assert.equal(ninjaTableRequestUrl(html), "https://sigep.org/wp-admin/admin-ajax.php?action=wp_ajax_ninja_tables_public_action&table_id=18473&target_action=get-all-data&ninja_table_public_nonce=abc123");
  assert.equal(ninjaTableRequestUrl("<script>no ajax here</script>"), null);
  assert.deepEqual(ninjaTableRows([{ options: {}, value: { school: "Auburn University" } }]), [{ school: "Auburn University" }]);
  assert.deepEqual(ninjaTableRows([{ school: "Auburn University" }]), [{ school: "Auburn University" }]);
  assert.deepEqual(ninjaTableRows("not an array" as never), []);
});

test("_wpgmp: decodes the base64 map data and pulls out places", () => {
  const places = [{ id: "1", title: "Alpha (College of Charleston)", location: { city: "Charleston", state: "South Carolina" }, categories: [{ name: "Active" }] }];
  const b64 = Buffer.from(JSON.stringify({ places })).toString("base64");
  const html = `<script>window.wpgmp.mapdata1 = "${b64}";</script>`;
  assert.deepEqual(wpgmpPlaces(html), places);
  assert.deepEqual(wpgmpPlaces("<script>nothing here</script>"), []);
});

/* ------------------------------------------------------------------ */
/* SigEp (Ninja Tables)                                                 */
/* ------------------------------------------------------------------ */

test("sigep: dyadinstitutionalid is the campus; chapter designation becomes the chapter name", () => {
  const rows = [
    { chapterdesignation: "Alabama Alpha", dyadinstitutionalid: "Auburn University - Auburn", city: "Auburn", state: "Alabama", website: "https://auburn.sigep.org/" },
    { chapterdesignation: "Nebraska Alpha", school: "University of Nebraska-Lincoln<br>Lincoln, Nebraska" },
    { chapterdesignation: "Colony Only", dyadinstitutionalid: "" },
  ];
  assert.deepEqual(sigepRows(rows), [
    { campus: "Auburn University - Auburn", name: "Alabama Alpha (Sigma Phi Epsilon)", city: "Auburn", state: "Alabama", url: "https://auburn.sigep.org/" },
    { campus: "University of Nebraska-Lincoln", name: "Nebraska Alpha (Sigma Phi Epsilon)" },
  ]);
});

/* ------------------------------------------------------------------ */
/* Kappa Sigma (Ninja Tables, different fields)                        */
/* ------------------------------------------------------------------ */

test("kappa-sigma: the school field is the campus; rows without one are dropped", () => {
  const rows = [
    { organizationname: "Beta", school: "The University of Alabama" },
    { organizationname: "No School", school: "" },
  ];
  assert.deepEqual(kappaSigmaRows(rows), [{ campus: "The University of Alabama", name: "Beta (Kappa Sigma)" }]);
});

/* ------------------------------------------------------------------ */
/* Lambda Chi Alpha (embedded window.chaptersMapData)                   */
/* ------------------------------------------------------------------ */

test("lambda-chi-alpha: parses the embedded array and drops non-college entries", () => {
  const html = `<script>
	window.chaptersMapData = [{"id":1,"title":"Beta (Maine)","city":"Orono","state":"Maine","universitycollege":"University of Maine"},{"id":2,"title":"Lambda Chi Alpha – OOA","city":"Carmel","state":"Indiana","universitycollege":"Office of Administration"}];
	</script>`;
  const records = parseChaptersMapData(html);
  assert.equal(records.length, 2);
  assert.deepEqual(lambdaChiEntries(records), [{ campus: "University of Maine", name: "Beta (Maine) (Lambda Chi Alpha)", city: "Orono", state: "Maine" }]);
  assert.deepEqual(parseChaptersMapData("<script>nothing</script>"), []);
});

/* ------------------------------------------------------------------ */
/* Pi Kappa Phi (WP Google Maps Pro)                                    */
/* ------------------------------------------------------------------ */

test("pi-kappa-phi: splits \"Chapter (College)\" and keeps only Active markers", () => {
  assert.deepEqual(splitTitle("Alpha (College of Charleston)"), { chapter: "Alpha", campus: "College of Charleston" });
  assert.equal(splitTitle("No parens here"), null);
  const places = [
    { title: "Alpha (College of Charleston)", location: { city: "Charleston", state: "South Carolina" }, categories: [{ name: "Active" }] },
    { title: "Beta (Presbyterian)", location: { city: "Clinton", state: "South Carolina" }, categories: [{ name: "Inactive" }] },
  ];
  assert.deepEqual(pikappEntries(places), [{ campus: "College of Charleston", name: "Alpha (Pi Kappa Phi)", city: "Charleston", state: "South Carolina" }]);
});

/* ------------------------------------------------------------------ */
/* Sigma Nu (plain HTML table, active vs. dormant)                      */
/* ------------------------------------------------------------------ */

test("sigma-nu: reads the active table only, not the dormant one", () => {
  const html = `<table class="chapters"><tbody><tr><th>Charter Year</th></tr>
<tr><td class="year">1871</td><td class="chapname">Beta</td><td class="school">University of Virginia</td></tr>
</tbody></table>
<table class="chapters dormant"><tbody><tr><th>Charter Year</th></tr>
<tr><td class="year">1869</td><td class="chapname">Alpha</td><td class="school">Virginia Military Institute</td></tr>
</tbody></table>`;
  const rows = parseActiveTable(html);
  assert.deepEqual(rows, [{ chapter: "Beta", school: "University of Virginia" }]);
  assert.deepEqual(sigmaNuEntries(rows), [{ campus: "University of Virginia", name: "Beta (Sigma Nu)" }]);
  assert.deepEqual(parseActiveTable("<p>no table</p>"), []);
});

/* ------------------------------------------------------------------ */
/* Omega Phi Beta (NALFO; a chapter serving several colleges)           */
/* ------------------------------------------------------------------ */

test("omega-phi-beta: splits several colleges on \";\" into campuses, and strips footnote asterisks", () => {
  const html = `<table width="100%"><tbody>
<tr><td><h6>Entity</h6></td><td><h6>College/University</h6></td></tr>
<tr><td>Alpha Chapter</td><td>University at Albany, SUNY</td></tr>
<tr><td>Beta Chapter<span style="color:#ff0000;">*</span></td><td>SUNY New Paltz; Marist College</td></tr>
</tbody></table>`;
  const rows = opbParseTable(html);
  assert.deepEqual(rows, [
    { entity: "Alpha Chapter", colleges: "University at Albany, SUNY" },
    { entity: "Beta Chapter *", colleges: "SUNY New Paltz; Marist College" },
  ]);
  assert.deepEqual(opbEntries(rows), [
    { campus: "University at Albany, SUNY", name: "Alpha Chapter (Omega Phi Beta)" },
    { campus: "SUNY New Paltz", campuses: ["SUNY New Paltz", "Marist College"], name: "Beta Chapter (Omega Phi Beta)" },
  ]);
});

/* ------------------------------------------------------------------ */
/* GreekLife's display helpers, with a fixture that includes an "npc"  */
/* (sorority) listing from the parallel track, not just this track's   */
/* own councils — the display must group it correctly too.            */
/* ------------------------------------------------------------------ */

const fixtureRows: DirectoryRows = {
  credits: {
    sigep: { organization: "Sigma Phi Epsilon", publisher: "Sigma Phi Epsilon", list_url: "https://sigep.org/chapters/", read: "2026-10-04", tier: "D", domain: "greek", council: "nic" },
    "kappa-alpha-psi": { organization: "Kappa Alpha Psi", publisher: "Kappa Alpha Psi", list_url: "https://www.kappaalphapsi1911.com/find-a-chapter/", read: "2026-10-04", tier: "D", domain: "greek", council: "nphc" },
    // A council key this track never writes to, simulating the parallel sorority track's data.
    "kappa-delta": { organization: "Kappa Delta", publisher: "Kappa Delta", list_url: "https://kappadelta.org/chapter-locator/", read: "2026-10-03", tier: "D", domain: "greek", council: "npc" },
  },
  listings: [
    { org: "kappa-delta", name: "Beta (Kappa Delta)" },
    { org: "sigep", name: "Alabama Alpha (Sigma Phi Epsilon)" },
    { org: "kappa-alpha-psi", name: "Alpha (Kappa Alpha Psi)" },
  ],
};

test("GreekLife display: groups a mix of this track's councils and the sorority track's npc council", () => {
  const listings = listingsFor(fixtureRows, "greek");
  assert.equal(listings.length, 3);
  const groups = groupListings(listings);
  // Groups come out in COUNCILS' declared order: npc, nic, nphc, nalfo, napa, nmgc, lgbtq, professional.
  assert.deepEqual(groups.map((g) => g.key), ["npc", "nic", "nphc"]);
  assert.deepEqual(groups.map((g) => g.label), ["Panhellenic sororities (NPC)", "Interfraternity (NIC and IFC)", "Historically Black (NPHC)"]);
  assert.deepEqual(groups.map((g) => g.listings.length), [1, 1, 1]);
});

test("greekParticipationBlankOrZero: true only when both undergrad percentages are null or 0", () => {
  assert.equal(greekParticipationBlankOrZero({ reported: undefined }), true);
  assert.equal(greekParticipationBlankOrZero({ reported: { greek: { frat_pct_first_year: null, frat_pct_undergrad: 0, sor_pct_first_year: null, sor_pct_undergrad: null, housing: null } } }), true);
  assert.equal(greekParticipationBlankOrZero({ reported: { greek: { frat_pct_first_year: null, frat_pct_undergrad: 0.1, sor_pct_first_year: null, sor_pct_undergrad: null, housing: null } } }), false);
});

test("latestDirectoryRead: the newest lineage.directories.retrieved across the dataset, as a month/year label", () => {
  assert.equal(latestDirectoryRead([{ lineage: { directories: { retrieved: "2026-10-01" } } }, { lineage: { directories: { retrieved: "2026-10-04" } } }, {}]), "October 2026");
  assert.equal(latestDirectoryRead([{}, { lineage: {} }]), null);
});

test("hasGreekCouncil / matchesGreekCouncils / compareGreekCouncils: read school.directories.greek", () => {
  const s = { directories: { greek: ["nic", "nphc"] } };
  assert.equal(hasGreekCouncil(s, "nic"), true);
  assert.equal(hasGreekCouncil(s, "nalfo"), false);
  assert.equal(matchesGreekCouncils(s, ["nalfo", "nphc"]), true);
  assert.equal(matchesGreekCouncils(s, ["nalfo", "napa"]), false);
  assert.equal(compareGreekCouncils(s), "Interfraternity (NIC and IFC), Historically Black (NPHC)");
  assert.equal(compareGreekCouncils({ directories: undefined }), null);
});
