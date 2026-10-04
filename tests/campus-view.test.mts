/**
 * The campus-life blocks' view models and the organizations loader (lib/campus-view.ts, lib/organizations.ts;
 * specs/campus-directories.md "Display"): councils joined across the college's pages and the national lists, the
 * badge fallbacks, chapter names, and the organizations file's contract (on a fixture; on the real file once it
 * exists). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listingsFor, type Council, type DirectoryRows } from "../lib/directories.ts";
import { greekCouncils, type CampusPagesRows } from "../lib/campus-pages.ts";
import { faithView, greekView, listingView } from "../lib/campus-view.ts";
import { chapterLabel, inkOn, lettersFromName, loadOrganizations, orgBadge, organizationsProblems, orgWebsite, type OrganizationsFile } from "../lib/organizations.ts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE_ROOT = join(ROOT, "tests", "fixtures", "organizations");
const read = "2026-10-04";
const credit = (organization: string, council: Council, list_url = `https://${organization.toLowerCase().replace(/\s+/g, "")}.org/chapters/`) =>
  ({ organization, publisher: organization, list_url, read, tier: "D", domain: "greek", council }) as const;

const rows: DirectoryRows = {
  credits: {
    sigep: credit("Sigma Phi Epsilon", "nic", "https://sigep.org/chapters/"),
    "kappa-sigma": credit("Kappa Sigma", "nic"),
    "pi-beta-phi": credit("Pi Beta Phi", "npc"),
    "omega-phi-beta": credit("Omega Phi Beta", "nalfo"),
    focus: { organization: "FOCUS (Fellowship of Catholic University Students)", publisher: "FOCUS", list_url: "https://focus.org/about/campuses/", read, tier: "D", domain: "faith", tradition: "catholic" },
    ruf: { organization: "Reformed University Fellowship", publisher: "Reformed University Fellowship", list_url: "https://ruf.org/campus/", read, tier: "D", domain: "faith", tradition: "christian" },
  },
  listings: [
    { org: "focus", url: "https://focus.org/campus/x/" },
    { org: "ruf", name: "Testland RUF International", url: "https://ruf.org/ministry/x/" },
    { org: "kappa-sigma", name: "Tau (Kappa Sigma)" },
    { org: "sigep", name: "Texas Alpha (Sigma Phi Epsilon)", url: "https://texasaustin.sigep.org/" },
    { org: "pi-beta-phi", name: "Texas Alpha" },
    { org: "omega-phi-beta", name: "Alpha" },
  ],
};

const pages: CampusPagesRows = {
  greek: {
    councils: [
      { url: "https://x.edu/sfl", checked: "2026-10-04", quote: "22 chapters", council: "nic", name: "Interfraternity Council (IFC)", chapters: 22, members: null, term: null },
      { url: "https://x.edu/sfl", checked: "2026-10-04", quote: "13 chapters", council: "npc", name: "University Panhellenic Council (UPC)", chapters: 13, members: null, term: null },
      { url: "https://x.edu/sfl", checked: "2026-10-04", quote: "8 chapters", council: "nphc", name: "National Pan-Hellenic Council (NPHC)", chapters: 8, members: null, term: null },
    ],
  },
};

const fixture = JSON.parse(readFileSync(join(FIXTURE_ROOT, "data", "directories", "organizations.json"), "utf8")) as OrganizationsFile;

test("greekView: the college's councils take the lists' chapters; a council only the lists know gets its own row; no mixed total", () => {
  const v = greekView(greekCouncils(pages, "2026-10-05"), listingsFor(rows, "greek"), {});
  assert.deepEqual(
    v.councils.map((c) => [c.council, c.name, c.chapters, c.listings.map((l) => l.org)]),
    [
      ["npc", "University Panhellenic Council (UPC)", 13, ["Pi Beta Phi"]],
      ["nic", "Interfraternity Council (IFC)", 22, ["Kappa Sigma", "Sigma Phi Epsilon"]],
      ["nphc", "National Pan-Hellenic Council (NPHC)", 8, []],
      ["nalfo", null, null, ["Omega Phi Beta"]],
    ]
  );
  // NALFO has no college count, so a total would add a list count to the college's: none.
  assert.equal(v.total, null);
  const collegeOnly = greekView(greekCouncils(pages, "2026-10-05"), listingsFor(rows, "greek").filter((l) => l.credit.domain === "greek" && l.credit.council !== "nalfo"), {});
  assert.equal(collegeOnly.total, 43);
  assert.equal(greekView(null, [], {}).councils.length, 0);
});

test("listingView: chapter names drop the organization's; websites come from the file, else the org's own list's site", () => {
  const [kappa, sigep] = greekView(null, listingsFor(rows, "greek"), {}).councils.find((c) => c.council === "nic")!.listings;
  assert.equal(kappa.chapter, "Tau");
  assert.equal(kappa.website, "https://kappasigma.org/");
  assert.equal(sigep.chapter, "Texas Alpha");
  assert.equal(sigep.chapterUrl, "https://texasaustin.sigep.org/");
  // FOCUS publishes its own list under its short name: still its own site.
  assert.equal(listingView(listingsFor(rows, "faith")[0], {}).website, "https://focus.org/");
  assert.equal(listingView(listingsFor(rows, "faith")[0], fixture.organizations).website, "https://focus.org/");
  assert.equal(listingView(listingsFor(rows, "faith")[0], fixture.organizations).org, "FOCUS");
});

test("faithView: traditions in order, each with its groups", () => {
  assert.deepEqual(
    faithView(listingsFor(rows, "faith"), {}).map((t) => [t.tradition, t.items.length]),
    [
      ["catholic", 1],
      ["christian", 1],
    ]
  );
});

test("badges: a logo, else the file's letters on its color, else letters spelled from the name, else nothing", () => {
  const o = fixture.organizations;
  assert.deepEqual(orgBadge(o.sigep, "Sigma Phi Epsilon"), { kind: "logo", src: "/org-logos/sigep.svg", logo: o.sigep.logo, shape: "square", tone: "dark" });
  assert.deepEqual(orgBadge(o["pi-beta-phi"], "Pi Beta Phi"), { kind: "letters", letters: "ΠΒΦ", background: "#8B1F41", foreground: "#ffffff" });
  assert.deepEqual(orgBadge(o["kappa-sigma"], "Kappa Sigma"), { kind: "letters", letters: "ΚΣ", background: null, foreground: null });
  assert.deepEqual(orgBadge(null, "Lambda Chi Alpha"), { kind: "letters", letters: "ΛΧΑ", background: null, foreground: null });
  assert.deepEqual(orgBadge(null, "Reformed University Fellowship"), { kind: "none" });
  assert.equal(lettersFromName("Tri Delta"), "ΔΔΔ");
  assert.equal(lettersFromName("Alpha Kappa Alpha Sorority, Inc."), null);
  assert.equal(inkOn("#FFD700"), "#1a1530");
  assert.equal(inkOn("#002147"), "#ffffff");
});

test("orgBadge: a wordmark (aspect >= 1.8) gets a wide shape, a mark/crest gets square, light-on-transparent art gets a dark tone, and logo_display 'badge' skips the image", () => {
  const wordmark = { name: "Wordmark Org", website: null, letters: "WO", colors: [], wikidata: null, logo: { file: "public/org-logos/wordmark.svg", source: "https://x.org/", license: "Organization's own logo (used to identify it)", attribution: "© Wordmark Org", aspect: 4 } };
  assert.deepEqual(orgBadge(wordmark, "Wordmark Org"), { kind: "logo", src: "/org-logos/wordmark.svg", logo: wordmark.logo, shape: "wide", tone: "dark" });

  const asLogo = (b: ReturnType<typeof orgBadge>) => {
    assert.equal(b.kind, "logo");
    return b as Extract<ReturnType<typeof orgBadge>, { kind: "logo" }>;
  };

  const crest = { ...wordmark, logo: { ...wordmark.logo, aspect: 0.8 } };
  assert.equal(asLogo(orgBadge(crest, "Crest Org")).shape, "square");

  const light = { ...wordmark, logo: { ...wordmark.logo, aspect: 0.6, tone: "light" as const } };
  assert.equal(asLogo(orgBadge(light, "Light Org")).tone, "light");

  const noAspect = { ...wordmark, logo: { file: wordmark.logo.file, source: wordmark.logo.source, license: wordmark.logo.license, attribution: wordmark.logo.attribution } };
  assert.equal(asLogo(orgBadge(noAspect, "No Aspect")).shape, "square", "missing aspect degrades to the square tile");

  const unreadable = { ...wordmark, letters: "WO", logo: { ...wordmark.logo, logo_display: "badge" as const, logo_display_reason: "wordmark stays illegible even widened" } };
  assert.deepEqual(orgBadge(unreadable, "Wordmark Org"), { kind: "letters", letters: "WO", background: null, foreground: null });
});

test("chapterLabel strips a trailing (Organization), keeps everything else", () => {
  assert.equal(chapterLabel("Alpha-Mu (Texas Austin) (Lambda Chi Alpha)", "Lambda Chi Alpha"), "Alpha-Mu (Texas Austin)");
  assert.equal(chapterLabel("Sigma Nu", "Sigma Nu"), null);
  assert.equal(chapterLabel(undefined, "Sigma Nu"), null);
  assert.equal(orgWebsite(null, { organization: "Trans Policy Clearinghouse", publisher: "Dr. Genny Beemyn", list_url: "https://www.gennyb.com/x" }), null);
});

test("organizations.json contract: the fixture passes, and broken entries are named", () => {
  assert.deepEqual(organizationsProblems(fixture), []);
  const bad = structuredClone(fixture);
  bad.organizations.sigep.website = "http://sigep.org/";
  bad.organizations.sigep.logo!.license = "All rights reserved";
  bad.organizations["pi-beta-phi"].colors = ["red"];
  assert.deepEqual(organizationsProblems(bad), [
    "sigep: website must be https or null",
    'sigep: logo license "All rights reserved" isn\'t public domain or a free license',
    "pi-beta-phi: colors must be #rrggbb strings",
  ]);
});

test("organizationsProblems: logo aspect must be positive, tone must be light/dark, logo_display 'badge' needs a reason", () => {
  const base = structuredClone(fixture);
  const good = structuredClone(base);
  good.organizations.sigep.logo!.aspect = 2.1;
  good.organizations.sigep.logo!.tone = "dark";
  assert.deepEqual(organizationsProblems(good), []);

  const badAspect = structuredClone(base);
  badAspect.organizations.sigep.logo!.aspect = -1;
  assert.match(organizationsProblems(badAspect).join(), /aspect must be a positive number/);

  const badTone = structuredClone(base);
  // @ts-expect-error: deliberately invalid for the test
  badTone.organizations.sigep.logo!.tone = "pastel";
  assert.match(organizationsProblems(badTone).join(), /tone must be "light" or "dark"/);

  const badgeNoReason = structuredClone(base);
  badgeNoReason.organizations.sigep.logo!.logo_display = "badge";
  assert.match(organizationsProblems(badgeNoReason).join(), /logo_display "badge" needs logo_display_reason/);

  const badgeWithReason = structuredClone(base);
  badgeWithReason.organizations.sigep.logo!.logo_display = "badge";
  badgeWithReason.organizations.sigep.logo!.logo_display_reason = "wordmark stays illegible even widened";
  assert.deepEqual(organizationsProblems(badgeWithReason), []);
});

test("loadOrganizations: reads the file under a root, tolerant of a bad entry, empty before the file exists", () => {
  assert.equal(Object.keys(loadOrganizations(FIXTURE_ROOT).organizations).length, Object.keys(fixture.organizations).length);
  assert.deepEqual(loadOrganizations(join(FIXTURE_ROOT, "missing")).organizations, {});
});

test("the real organizations.json, once committed, meets the contract and every logo file exists", { skip: !existsSync(join(ROOT, "data", "directories", "organizations.json")) }, () => {
  const real = loadOrganizations(ROOT);
  const raw = JSON.parse(readFileSync(join(ROOT, "data", "directories", "organizations.json"), "utf8"));
  assert.deepEqual(organizationsProblems(raw), []);
  for (const [key, o] of Object.entries(real.organizations)) {
    if (o.logo) assert.ok(existsSync(join(ROOT, o.logo.file)), `${key}: ${o.logo.file} is missing`);
  }
});
