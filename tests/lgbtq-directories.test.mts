/**
 * LGBTQ+ national directories (specs/lgbtq-life.md phase 3, specs/campus-directories.md): the seven Trans Policy
 * Clearinghouse lists' parsers (six on gennyb.com's shared accordion, one its own prose list), the Consortium's
 * campus-center KML parser, and the policy checklist's tier A over tier D precedence. Each parser is tested on a
 * small fixture string built to match the real markup's shape, never a stored copy of the page. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, decode, panelState, parseAccordionList, tpcItem } from "../scripts/lib/directories/adapters/_tpc-common.mts";
import { entriesFromAccordion } from "../scripts/lib/directories/adapters/_tpc-common.mts";
import { entryFromParagraph, entriesFrom as transAdmissionEntries } from "../scripts/lib/directories/adapters/tpc-trans-admission.mts";
import { centersFrom, embeddedMid, entriesFromKml } from "../scripts/lib/directories/adapters/lgbt-campus-consortium.mts";
import { POLICY_KEYS, type CreditedListing, type DirectoryCredit } from "../lib/directories.ts";
import { checklistSays, comparedChecklist, hasLgbtqCenter, policyChecklist, policyIsYes } from "../lib/lgbtq-policy.ts";
import type { School } from "../lib/types.ts";
import type { SchoolDetail } from "../lib/detail.ts";

/* ------------------------------------------------------------------ */
/* The shared gennyb.com accordion (five lists + athletics)            */
/* ------------------------------------------------------------------ */

const ACCORDION_FIXTURE = `
<div class="wpsm_panel-group" id="wpsm_accordion_1">
<!-- Inner panel Start -->
<div class="wpsm_panel wpsm_panel-default">
<div class="wpsm_panel-heading" role="tab">
  <h4 class="wpsm_panel-title">
    <a class="collapsed" data-toggle="collapse">
      <span class="ac_open_cl_icon fa fa-plus"></span>
      <span class="ac_title_class">
        <span style="margin-right:6px;" class="fa fa-mortar-board"></span>
        Testland (3 colleges)        </span>
    </a>
  </h4>
</div>
<div id="ac_1" class="wpsm_panel-collapse collapse">
  <div class="wpsm_panel-body">
    <ul>
 	<li>Example State University</li>
 	<li>Fixture College (2015)</li>
 	<li>Removed State University: removed in 2025 by school officials</li>
</ul>						  </div>
</div>
</div>
<!-- Inner panel End -->
<!-- Inner panel Start -->
<div class="wpsm_panel wpsm_panel-default">
<div class="wpsm_panel-heading" role="tab">
  <h4 class="wpsm_panel-title">
    <a class="collapsed" data-toggle="collapse">
      <span class="ac_open_cl_icon fa fa-plus"></span>
      <span class="ac_title_class">
        <span style="margin-right:6px;" class="fa fa-ban"></span>
        Emptyland (no colleges)        </span>
    </a>
  </h4>
</div>
<div id="ac_2" class="wpsm_panel-collapse collapse">
  <div class="wpsm_panel-body">
							none						  </div>
</div>
</div>
<!-- Inner panel End -->
</div>`;

test("tpc-common: entity decode, and the accordion's heading text less its college count", () => {
  assert.equal(decode("Mary&#8217;s &amp; Sons"), "Mary’s & Sons");
  assert.equal(clean("  <strong>A</strong>\n  B  "), "A B");
  assert.match(ACCORDION_FIXTURE, /Testland/); // sanity: the fixture itself names the state
});

test("tpc-common: one <li> → a cleaned campus name and its start year; a removed policy is dropped", () => {
  assert.deepEqual(tpcItem("Example State University"), { campus: "Example State University", year: null });
  assert.deepEqual(tpcItem("Fixture College (2015)"), { campus: "Fixture College", year: 2015 });
  assert.equal(tpcItem("Removed State University: removed in 2025 by school officials"), null);
  assert.deepEqual(tpcItem("Footnoted College**"), { campus: "Footnoted College", year: null });
  assert.equal(tpcItem(""), null);
});

test("tpc-common: parses every panel of the shared accordion, skipping an empty one", () => {
  const rows = parseAccordionList(ACCORDION_FIXTURE);
  assert.deepEqual(rows, [
    { campus: "Example State University", state: "Testland", year: null },
    { campus: "Fixture College", state: "Testland", year: 2015 },
  ]);
  assert.equal(panelState('<span class="ac_title_class"><span class="fa"></span>Testland (3 colleges)</span>'), "Testland");
  const entries = entriesFromAccordion(ACCORDION_FIXTURE);
  assert.deepEqual(entries, [
    { campus: "Example State University", state: "Testland" },
    { campus: "Fixture College", state: "Testland", fact: "since 2015" },
  ]);
});

/* ------------------------------------------------------------------ */
/* The trans-admission prose list (its own format)                     */
/* ------------------------------------------------------------------ */

const ADMISSION_PARAGRAPH_LINKED = `<a href="https://x.example.edu/policy"><strong>Fixture College:</strong></a> admits &#8220;applicants who identify as women.&#8221;`;
const ADMISSION_PARAGRAPH_WRAPPED = `<strong><a href="https://y.example.edu/policy">Second College:</a></strong> &#8220;will not admit men.&#8221;`;
const ADMISSION_PARAGRAPH_NO_LINK = `<strong>Third College:</strong> does not publish a written policy.`;
const ADMISSION_PARAGRAPH_NO_COLON = `In addition, <strong>Fourth College</strong> does not indicate its policy toward trans students.`;

test("tpc-trans-admission: a college's name (linked either way) and its policy text, however the markup nests", () => {
  assert.deepEqual(entryFromParagraph(ADMISSION_PARAGRAPH_LINKED, "label"), {
    campus: "Fixture College",
    name: "label",
    quote: "admits “applicants who identify as women.”",
    url: "https://x.example.edu/policy",
  });
  assert.deepEqual(entryFromParagraph(ADMISSION_PARAGRAPH_WRAPPED, "label"), {
    campus: "Second College",
    name: "label",
    quote: "“will not admit men.”",
    url: "https://y.example.edu/policy",
  });
  assert.deepEqual(entryFromParagraph(ADMISSION_PARAGRAPH_NO_LINK, "label"), { campus: "Third College", name: "label", quote: "does not publish a written policy." });
  assert.deepEqual(entryFromParagraph(ADMISSION_PARAGRAPH_NO_COLON, "label"), { campus: "Fourth College", name: "label", quote: "does not indicate its policy toward trans students." });
  assert.equal(entryFromParagraph("<em>no strong tag here</em>", "label"), null);
  const long = "x".repeat(200);
  assert.ok(entryFromParagraph(`<strong>Long College:</strong> ${long}`, "label")!.quote!.length <= 160);
});

const ADMISSION_PAGE_FIXTURE = `
<h4 id="womenscollegesformalpolicies" class="wp-block-heading"><strong>1 historically women&#8217;s college with a policy</strong></h4>
<p class="wp-block-paragraph">${ADMISSION_PARAGRAPH_LINKED}</p>
<h4 id="menscollegesformalpolicies" class="wp-block-heading"><strong>1 historically men&#8217;s college with a policy</strong></h4>
<p class="wp-block-paragraph">${ADMISSION_PARAGRAPH_WRAPPED}</p>
`;

test("tpc-trans-admission: sections become each entry's name label, by anchor", () => {
  const entries = transAdmissionEntries(ADMISSION_PAGE_FIXTURE);
  assert.deepEqual(
    entries.map((e) => [e.campus, e.name]),
    [
      ["Fixture College", "Admits some trans students (women's college)"],
      ["Second College", "Admission policy (men's college)"],
    ]
  );
});

/* ------------------------------------------------------------------ */
/* The Consortium's campus-center KML export                           */
/* ------------------------------------------------------------------ */

test("lgbt-campus-consortium: the page's embedded Google My Maps id", () => {
  const html = `<iframe src="https://www.google.com/maps/d/u/1/embed?mid=ABC123" height="480"></iframe>`;
  assert.equal(embeddedMid(html), "ABC123");
  assert.equal(embeddedMid("<p>no map here</p>"), null);
});

test("lgbt-campus-consortium: a center's name, founding year, and URL; several centers per campus split correctly", () => {
  assert.deepEqual(centersFrom(""), [{ name: null, year: null, url: null }]);
  assert.deepEqual(centersFrom("founded 2015<br>http://x.example.edu/lgbtq"), [{ name: null, year: 2015, url: "http://x.example.edu/lgbtq" }]);
  assert.deepEqual(centersFrom("Fixture Center<br>Founded: 1989<br>http://x.example.edu"), [{ name: "Fixture Center", year: 1989, url: "http://x.example.edu" }]);
  // Two full center blocks for one campus (e.g. UCLA's two centers): a second name line starts a new one.
  assert.deepEqual(centersFrom("First Center<br>Founded: 1995<br>http://a.example<br><br>Second Center<br>Founded: 2020<br>http://b.example"), [
    { name: "First Center", year: 1995, url: "http://a.example" },
    { name: "Second Center", year: 2020, url: "http://b.example" },
  ]);
});

test("lgbt-campus-consortium: every Placemark in the KML, name and description parsed, a bare marker still counted", () => {
  const kml = `<kml><Document>
<Placemark><name>Fixture University</name><description><![CDATA[Fixture Center<br>Founded: 2001<br>http://fixture.example.edu]]></description></Placemark>
<Placemark><name>Bare Marker College</name><description><![CDATA[]]></description></Placemark>
</kml></Document>`;
  assert.deepEqual(entriesFromKml(kml), [
    { campus: "Fixture University", name: "Fixture Center", url: "http://fixture.example.edu", fact: "founded 2001" },
    { campus: "Bare Marker College" },
  ]);
});

/* ------------------------------------------------------------------ */
/* Policy keys (lib/directories.ts), shared by the pilot track's tier A facts */
/* ------------------------------------------------------------------ */

test("the seven Clearinghouse lists match six existing policy keys, plus the athletics key this track adds", () => {
  for (const k of ["nondiscrimination_identity", "inclusive_housing", "inclusive_restrooms", "name_on_records", "health_plan_transition", "trans_admission", "trans_athletics"]) {
    assert.ok(k in POLICY_KEYS, k);
  }
});

/* ------------------------------------------------------------------ */
/* Policy checklist: tier A (the pilot's verified facts) over tier D    */
/* ------------------------------------------------------------------ */

const housingCredit: DirectoryCredit = {
  organization: "Trans Policy Clearinghouse",
  publisher: "Dr. Genny Beemyn",
  list_url: "https://www.gennyb.com/research/trans-supportive-campus-policies/colleges-and-universities-that-provide-gender-inclusive-housing",
  read: "2026-10-04",
  tier: "D",
  domain: "lgbtq",
  kind: "policy",
  policy: "inclusive_housing",
};
const housingListing: CreditedListing = { org: "tpc-housing", credit: housingCredit, tier: "D" };
const centerCredit: DirectoryCredit = {
  organization: "Consortium of Higher Education LGBT Resource Professionals",
  publisher: "Consortium of Higher Education LGBT Resource Professionals",
  list_url: "https://www.lgbtcampus.org/find-an-lgbtq-campus-center",
  read: "2026-10-04",
  tier: "D",
  domain: "lgbtq",
  kind: "center",
};
const centerListing: CreditedListing = { org: "lgbt-campus-consortium", credit: centerCredit, tier: "D", name: "Fixture Center" };

test("policyChecklist: a tier D lead shows as 'Listed by …', never a plain yes", () => {
  const items = policyChecklist(null, [housingListing]);
  assert.deepEqual(items, [
    { key: "inclusive_housing", label: "Gender-inclusive housing", source: "tier-d", value: "yes", text: "Gender-inclusive housing: listed by Trans Policy Clearinghouse (2026-10-04)", url: housingCredit.list_url, date: "2026-10-04", listing: housingListing },
  ]);
  assert.ok(!items.some((i) => /^yes$/i.test(i.text)));
});

test("policyChecklist: a verified tier A fact for the same key replaces the tier D lead, even when it's 'no'", () => {
  const yes = policyChecklist({ policies: [{ key: "inclusive_housing", value: "yes", url: "https://x.edu/housing", checked: "2027-01-05", quote: "Gender-inclusive housing is available." }] }, [housingListing]);
  assert.equal(yes.length, 1);
  assert.equal(yes[0].source, "tier-a");
  assert.match(yes[0].text, /checked 2027-01-05/);
  const no = policyChecklist(
    { policies: [{ key: "inclusive_housing", value: "no", url: "https://x.edu/housing", checked: "2027-01-05", quote: "No such option.", verified_by: "claude-sonnet-5" }] },
    [housingListing]
  );
  assert.equal(no.length, 1, "the tier D lead doesn't also show once tier A has checked");
  assert.equal(no[0].source, "tier-a");
  assert.equal(no[0].value, "no");
  assert.ok(!/^no$/i.test(no[0].text), "never a plain 'No'");
});

test("policyChecklist: 'not_found' (checked, but nothing on the page) falls back to a tier D lead, not a blank", () => {
  const items = policyChecklist({ policies: [{ key: "inclusive_housing", value: "not_found", url: "https://x.edu/housing", checked: "2027-01-05", quote: null }] }, [housingListing]);
  assert.equal(items[0].source, "tier-d");
});

test("policyChecklist: a key with neither tier is left out; a center listing is passed straight through", () => {
  assert.deepEqual(policyChecklist(null, []), []);
  const items = policyChecklist(null, [centerListing]);
  assert.equal(items.length, 0, "center isn't a PolicyKey; it never appears in the policy checklist itself");
});

test("hasLgbtqCenter / policyIsYes / checklistSays: Explore's filter predicates, tier A over the directory summary", () => {
  assert.equal(hasLgbtqCenter({ directories: { lgbtq: ["center"] } }), true);
  assert.equal(hasLgbtqCenter({ directories: { lgbtq: ["inclusive_housing"] } }), false);
  assert.equal(hasLgbtqCenter({}), false);
  assert.equal(policyIsYes({ directories: { lgbtq: ["inclusive_housing"] } }, "inclusive_housing"), true);
  assert.equal(policyIsYes({ directories: {} }, "inclusive_housing"), false);
  const noHousing = { gender: null, admissions: null, state_law: null, policies: [{ key: "inclusive_housing" as const, value: "no" as const, url: "u", checked: "2027-01-01", quote: "q", verified_by: "m" }] };
  assert.equal(policyIsYes({ lgbtq: noHousing }, "inclusive_housing"), false, "tier A 'no' overrides a tier D listing");
  const items = policyChecklist(null, [housingListing]);
  assert.equal(checklistSays(items, "inclusive_housing")?.source, "tier-d");
  assert.equal(checklistSays(items, "name_on_records"), null);
});

test("comparedChecklist: Compare's checklist rows, one per key with something to show, cells dated per college", () => {
  const schoolA = { unit_id: "1" } as unknown as School;
  const schoolB = { unit_id: "2", lgbtq: { gender: null, admissions: null, state_law: null, policies: [{ key: "inclusive_housing" as const, value: "yes" as const, url: "https://b.edu/housing", checked: "2027-02-01", quote: "Yes." }] } } as unknown as School;
  const detailA: SchoolDetail = { unit_id: "1", tables: { directories: { source: "directory", vintage: null, year: "October 2026", rows: { credits: { "tpc-housing": housingCredit }, listings: [{ org: "tpc-housing" }] } } } } as unknown as SchoolDetail;
  const rows = comparedChecklist([schoolA, schoolB], [detailA, null]);
  assert.deepEqual(rows.map((r) => r.key), ["inclusive_housing"]);
  assert.equal(rows[0].cells[0]?.source, "tier-d");
  assert.equal(rows[0].cells[1]?.source, "tier-a");
  assert.match(rows[0].cells[1]!.text, /checked 2027-02-01/);
});
