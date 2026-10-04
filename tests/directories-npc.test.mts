/**
 * NPC (Panhellenic) sorority adapters (feature/campus-life-2-sororities; specs/campus-directories.md). One parser
 * test per adapter on a small fixture string (never a stored page), plus a check that the blocked adapters throw
 * `Blocked` rather than fall back to anything. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Blocked } from "../scripts/lib/directories/contract.mts";
import { decodeEntities, splitChapterCollege } from "../scripts/lib/directories/adapters/_text.mts";
import { entriesFrom as phiSigmaSigmaEntries, parseRow as phiSigmaSigmaRow } from "../scripts/lib/directories/adapters/phi-sigma-sigma.mts";
import { entriesFrom as sigmaKappaEntries } from "../scripts/lib/directories/adapters/sigma-kappa.mts";
import { entriesFrom as adpiEntries, parseMarkerContents as adpiMarkers } from "../scripts/lib/directories/adapters/alpha-delta-pi.mts";
import { entriesFrom as phiMuEntries, parseNonce as phiMuNonce } from "../scripts/lib/directories/adapters/phi-mu.mts";
import { entriesFrom as kdEntries } from "../scripts/lib/directories/adapters/kappa-delta.mts";
import { entriesFrom as dphieEntries } from "../scripts/lib/directories/adapters/delta-phi-epsilon.mts";
import { entriesFrom as sdtEntries } from "../scripts/lib/directories/adapters/sigma-delta-tau.mts";
import { entriesFrom as tpaEntries } from "../scripts/lib/directories/adapters/theta-phi-alpha.mts";
import { entriesFrom as triDeltaEntries } from "../scripts/lib/directories/adapters/tri-delta.mts";
import { entriesFrom as pbpEntries } from "../scripts/lib/directories/adapters/pi-beta-phi.mts";
import alphaPhi from "../scripts/lib/directories/adapters/alpha-phi.mts";
import deltaZeta from "../scripts/lib/directories/adapters/delta-zeta.mts";
import alphaSigmaTau from "../scripts/lib/directories/adapters/alpha-sigma-tau.mts";
import kappaKappaGamma from "../scripts/lib/directories/adapters/kappa-kappa-gamma.mts";
import { loadAdapters } from "../scripts/lib/directories/registry.mts";

test("_text: decodeEntities handles the en dash and ampersand these sites use", () => {
  assert.equal(decodeEntities("Alpha Beta &#8211; Texas A&amp;M"), "Alpha Beta – Texas A&M");
});

test("_text: splitChapterCollege splits on the dash, ignoring entity encoding", () => {
  assert.deepEqual(splitChapterCollege("Alpha Beta Chapter &#8211; University of Iowa"), ["Alpha Beta Chapter", "University of Iowa"]);
  assert.equal(splitChapterCollege("No dash here"), null);
});

test("phi-sigma-sigma: parseRow picks the Chapter token and the institution, dropping state and consultant name", () => {
  assert.deepEqual(phiSigmaSigmaRow("Beta Alpha Chapter - University of Maryland - College Park - MD - Carrie Buente"), {
    chapter: "Beta Alpha Chapter",
    college: "University of Maryland",
  });
  assert.deepEqual(phiSigmaSigmaRow("Adelphi University - Epsilon Chapter - Sarah Alonzo"), {
    chapter: "Epsilon Chapter",
    college: "Adelphi University",
  });
  assert.equal(phiSigmaSigmaRow("Just a name with no chapter word"), null);
});

test("phi-sigma-sigma: entriesFrom dedups the two sort-order spans for the same chapter", () => {
  const html = `<span>Beta Alpha Chapter - University of Maryland - College Park - Carrie Buente</span>
    <span>Beta Alpha Chapter - University of Maryland - College Park - MD - Carrie Buente</span>`;
  const entries = phiSigmaSigmaEntries(html);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { campus: "University of Maryland", name: "Beta Alpha Chapter" });
});

test("sigma-kappa: entriesFrom reads the collegiate cards, leaving alumnae cards out", () => {
  const html = `
    <article class="chapter-card collegiate-card" data-search="alpha chi georgetown college georgetown, ky">
      <div class="chapter-name">Alpha Chi</div>
      <div class="chapter-location">Georgetown, KY</div>
      <div class="chapter-school">Georgetown College</div>
    </article>
    <article class="chapter-card alumnae-card" data-search="x">
      <div class="chapter-name">Alumnae Group</div>
      <div class="chapter-location">Nowhere, NA</div>
      <div class="chapter-school">N/A</div>
    </article>`;
  const entries = sigmaKappaEntries(html);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { campus: "Georgetown College", name: "Alpha Chi", city: "Georgetown", state: "KY" });
});

test("alpha-delta-pi: parseMarkerContents URL-decodes the Geo Mashup latLongs content", () => {
  const html = `var latLongs = [{"lat":"41.66","long":"-91.53","content":"%3Ch2%3EAlpha%20Beta%20Chapter%20%26%238211%3B%20University%20of%20Iowa%3C%2Fh2%3E"}];`;
  const contents = adpiMarkers(html);
  assert.equal(contents.length, 1);
  assert.match(contents[0], /<h2>Alpha Beta Chapter &#8211; University of Iowa<\/h2>/);
});

test("alpha-delta-pi: entriesFrom splits each marker's h2 into chapter and college", () => {
  const html = `var latLongs = [{"lat":"1","long":"2","content":"%3Ch2%3EAlpha%20Beta%20Chapter%20%26%238211%3B%20University%20of%20Iowa%3C%2Fh2%3E%3Cdiv%3Eextra%3C%2Fdiv%3E"}];`;
  assert.deepEqual(adpiEntries(html), [{ campus: "University of Iowa", name: "Alpha Beta Chapter" }]);
});

test("phi-mu: parseNonce reads the Ajax Load More nonce embedded on the page", () => {
  const html = `{"ajaxurl":"https://phimu.org/wp-admin/admin-ajax.php","alm_nonce":"af2ec57b6e","rest_api":""}`;
  assert.equal(phiMuNonce(html), "af2ec57b6e");
  assert.equal(phiMuNonce("no nonce here"), null);
});

test("phi-mu: entriesFrom reads chapter_item divs out of the Ajax Load More JSON envelope", () => {
  const json = JSON.stringify({
    html: `<div class="chapter_item" data-state="ny">
      <span class="chapter_item_label">Psi</span>
      <h3>Adelphi University</h3>
      <p class="chapter_item_location">Garden City, New York</p>
    </div>`,
  });
  assert.deepEqual(phiMuEntries(json), [{ campus: "Adelphi University", name: "Psi", city: "Garden City", state: "New York" }]);
});

test("kappa-delta: entriesFrom keeps only Collegiate Chapters markers", () => {
  const html = `
    <div class="single-mod-marker" data-chapter-name="Gamma Zeta" data-school="Texas Christian University" data-state="Texas" data-shortstate="TX" data-chapter="Collegiate Chapters">
    <div class="single-mod-marker" data-chapter-name="West Michigan Alumnae Chapter" data-school="West Michigan Alumnae Chapter" data-state="Michigan" data-shortstate="MI" data-chapter="Alumnae Chapters">`;
  const entries = kdEntries(html);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { campus: "Texas Christian University", name: "Gamma Zeta", state: "TX" });
});

test("delta-phi-epsilon: entriesFrom reads Chapters sections, leaving Associations out", () => {
  const html = `<h3>Arizona</h3>
<h4><span>Chapters</span></h4>
<p><strong>Zeta Iota Chapter at Northern Arizona University</strong><br />
Flagstaff, AZ<br />
<strong>Beta Alpha Chapter at Embry-Riddle Aeronautical University</strong><br />
Prescott, AZ</p>
<h4><span>Associations</span></h4>
<p><strong>Phoenix Area Association</strong><br />
Phoenix, AZ</p>`;
  const entries = dphieEntries(html);
  assert.deepEqual(entries, [
    { campus: "Northern Arizona University", name: "Zeta Iota Chapter", city: "Flagstaff", state: "AZ" },
    { campus: "Embry-Riddle Aeronautical University", name: "Beta Alpha Chapter", city: "Prescott", state: "AZ" },
  ]);
});

test("sigma-delta-tau: entriesFrom reads the chapter table's three leading columns", () => {
  const html = `<td class="tbl-school"><h2 class="h5 nomargB">Adelphi University</h2></td>
    <td class="tbl-chapter">Gamma Omega</td>
    <td class="tbl-loc">Garden City, NY</td>`;
  assert.deepEqual(sdtEntries(html), [{ campus: "Adelphi University", name: "Gamma Omega", city: "Garden City", state: "NY" }]);
});

test("theta-phi-alpha: entriesFrom pulls the college out of the WP Store Locator address parentheses", () => {
  const json = JSON.stringify([
    { store: "Chi", address: "(The Creighton University) Student Board", city: "Omaha", state: "NE" },
    { store: "No College", address: "123 Main St", city: "Nowhere", state: "XX" },
  ]);
  const entries = tpaEntries(json);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { campus: "The Creighton University", name: "Chi", city: "Omaha", state: "NE" });
});

test("tri-delta: entriesFrom splits each post's title into chapter and campus, keeping the chapter's own link", () => {
  const posts = [{ title: { rendered: "Zeta Beta &#8211; Xavier" }, link: "https://www.tridelta.org/collegiate-chapters/zeta-beta-xavier/" }];
  assert.deepEqual(triDeltaEntries(posts), [{ campus: "Xavier", name: "Zeta Beta", url: posts[0].link }]);
});

test("pi-beta-phi: entriesFrom keeps only data-chapter-type=chapter results from the noscript fallback", () => {
  const html = `
    <div class="map-result" data-id="1" data-chapter-type="chapter">
      <div class="result-wrapper">
        <span>Collegiate Chapter</span>
        <h2 class="h3">Alabama Beta</h2>
        <p class="meta">Tuscaloosa, Alabama | University of Alabama</p>
      </div>
    </div>
    <div class="map-result" data-id="2" data-chapter-type="club">
      <div class="result-wrapper">
        <span>Alumnae Club</span>
        <h2 class="h3">Some Club</h2>
        <p class="meta">Nowhere, Nowhere | N/A</p>
      </div>
    </div>`;
  const entries = pbpEntries(html);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { campus: "University of Alabama", name: "Alabama Beta", city: "Tuscaloosa", state: "Alabama" });
});

for (const [name, adapter] of [
  ["alpha-phi", alphaPhi],
  ["delta-zeta", deltaZeta],
  ["alpha-sigma-tau", alphaSigmaTau],
  ["kappa-kappa-gamma", kappaKappaGamma],
] as const) {
  test(`${name}: crawl throws Blocked rather than returning anything`, async () => {
    await assert.rejects(() => adapter.crawl({} as never), (err) => err instanceof Blocked);
  });
}

test("all NPC sorority adapters load and declare council npc", async () => {
  const adapters = await loadAdapters();
  const keys = [
    "phi-sigma-sigma",
    "sigma-kappa",
    "alpha-delta-pi",
    "phi-mu",
    "kappa-delta",
    "delta-phi-epsilon",
    "sigma-delta-tau",
    "theta-phi-alpha",
    "tri-delta",
    "pi-beta-phi",
    "alpha-phi",
    "delta-zeta",
    "alpha-sigma-tau",
    "kappa-kappa-gamma",
  ];
  for (const key of keys) {
    const a = adapters.find((x) => x.key === key);
    assert.ok(a, `${key} should be a loaded adapter`);
    assert.equal(a!.domain, "greek");
    assert.equal((a as { council?: string }).council, "npc");
  }
});
