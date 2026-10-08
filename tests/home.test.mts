/**
 * Home and distance (specs/product/home-and-distance.md): the pure rules in lib/home.ts, Explore's `near`/`within`
 * params (lib/params.ts), the filter predicate getSchools() applies, the checked-in ZIP table, and source guards
 * that keep the filter and the distance sort inside the server-side pipeline (lib/dataset.ts can't be imported
 * here: its extensionless imports are for the bundler, as tests/explore-fit.test.mts notes). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_WITHIN,
  WITHIN_OPTIONS,
  distanceFromHome,
  distanceLine,
  driveHours,
  exploreNearHref,
  formatDriveTime,
  formatMiles,
  isWithinHome,
  isWithinOption,
  milesBetween,
  parseCensusGeocode,
  parseCentroidCsv,
  parseZip,
  roundCoord,
  titleCaseAddress,
  zipHome,
  zipIn,
} from "../lib/home.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { ACCOUNT_EXPORTERS } from "../lib/account-export.ts";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* Distance and its wording                                            */
/* ------------------------------------------------------------------ */

const BOSTON = { lat: 42.3601, lng: -71.0589 };
const NYC = { lat: 40.7128, lng: -74.006 };
const LA = { lat: 34.0522, lng: -118.2437 };

test("milesBetween: the great-circle figure (Boston–New York about 190 mi, Boston–Los Angeles about 2,600 mi, a point to itself 0)", () => {
  assert.equal(milesBetween(BOSTON, BOSTON), 0);
  const bosNyc = milesBetween(BOSTON, NYC);
  assert.ok(bosNyc > 185 && bosNyc < 195, `Boston–NYC should be about 190 mi, got ${bosNyc}`);
  const bosLa = milesBetween(BOSTON, LA);
  assert.ok(bosLa > 2580 && bosLa < 2620, `Boston–LA should be about 2,600 mi, got ${bosLa}`);
  assert.equal(milesBetween(BOSTON, NYC), milesBetween(NYC, BOSTON));
});

test("distanceFromHome: null when the college has no reported coordinates (never 0)", () => {
  assert.equal(distanceFromHome({ lat: null, lng: null }, BOSTON), null);
  assert.equal(distanceFromHome({}, BOSTON), null);
  assert.equal(distanceFromHome({ lat: 42.3601, lng: -71.0589 }, BOSTON), 0);
});

test("formatDriveTime: minutes under an hour, half hours to ten hours, whole hours beyond; the road factor and speed are stated constants", () => {
  assert.equal(driveHours(55), 1.25);
  assert.equal(formatDriveTime(10), "about 15 minutes"); // 10 × 1.25 ÷ 55 = 0.23 h = 13.6 min → 15
  assert.equal(formatDriveTime(44), "about 1 hour"); // exactly 1.0 h
  assert.equal(formatDriveTime(66), "about 1½ hours"); // 1.5 h
  assert.equal(formatDriveTime(190), "about 4½ hours"); // 4.3 h → 4.5
  assert.equal(formatDriveTime(330), "about 7½ hours"); // 7.5 h
  assert.equal(formatDriveTime(1000), "about 23 hours"); // 22.7 h → whole hours
  assert.equal(formatMiles(409.6), "410 mi");
  assert.equal(formatMiles(2601.2), "2,601 mi");
  assert.equal(distanceLine(190), "190 mi · about 4½ hours by car");
});

/* ------------------------------------------------------------------ */
/* ZIPs, radii, links                                                  */
/* ------------------------------------------------------------------ */

test("parseZip: five digits, with or without the +4; anything else is null", () => {
  assert.equal(parseZip("02139"), "02139");
  assert.equal(parseZip(" 02139-4307 "), "02139");
  assert.equal(parseZip(2139), null); // a number drops the leading zero: not a ZIP
  assert.equal(parseZip("0213"), null);
  assert.equal(parseZip("021390"), null);
  assert.equal(parseZip("abcde"), null);
  assert.equal(parseZip(undefined), null);
});

test("zipIn: the last five-digit group in an address, so a five-digit house number doesn't win", () => {
  assert.equal(zipIn("12345 Main St, Springfield, IL 62701"), "62701");
  assert.equal(zipIn("1 Main St, Springfield, IL 62701-1234"), "62701");
  assert.equal(zipIn("Springfield, IL"), null);
  assert.equal(zipIn("Box 123456"), null);
});

test("within: only the offered radii count; the default is 100 miles", () => {
  assert.deepEqual([...WITHIN_OPTIONS], [25, 50, 100, 200, 300, 500]);
  assert.equal(DEFAULT_WITHIN, 100);
  assert.equal(isWithinOption(100), true);
  assert.equal(isWithinOption(75), false);
  assert.equal(isWithinOption("100"), false);
  assert.equal(exploreNearHref("02139"), "/explore?near=02139&within=100&sortBy=distance");
  assert.equal(exploreNearHref("02139", 300), "/explore?near=02139&within=300&sortBy=distance");
});

test("parseFilters: near needs five digits and within one of the radii; bad values are dropped, not coerced", () => {
  const f = parseFilters({ near: "02139", within: "200" });
  assert.equal(f.nearZip, "02139");
  assert.equal(f.withinMiles, 200);
  assert.equal(f.near, undefined, "the ZIP's center is resolved by the page (resolveNear), never in parseFilters");
  assert.equal(parseFilters({ near: "2139", within: "200" }).nearZip, undefined);
  assert.equal(parseFilters({ near: "02139", within: "75" }).withinMiles, undefined);
  assert.equal(parseFilters({ near: "02139" }).withinMiles, undefined);
  assert.equal(parseFilters({ sortBy: "distance" }).sortBy, "distance");
  assert.equal(parseFilters({ sortBy: "distance" }).sortDir, "asc", "nearest first by default");
});

test("countActiveFilters: ZIP + radius count as one filter; a radius alone counts as none", () => {
  assert.equal(countActiveFilters({ near: "02139", within: "200" }), 1);
  assert.equal(countActiveFilters({ near: "02139" }), 1);
  assert.equal(countActiveFilters({ within: "200" }), 0);
  assert.equal(countActiveFilters({ near: "02139", within: "200", states: "MA" }), 2);
});

/* ------------------------------------------------------------------ */
/* The geocoder's answer                                               */
/* ------------------------------------------------------------------ */

const CENSUS_FIXTURE = {
  result: {
    input: { address: { address: "1600 Pennsylvania Ave NW Washington DC 20500" } },
    addressMatches: [
      {
        tigerLine: { side: "L", tigerLineId: "76225813" },
        coordinates: { x: -77.035189204737, y: 38.898702605245 },
        addressComponents: { zip: "20500", streetName: "PENNSYLVANIA", city: "WASHINGTON", state: "DC", suffixType: "AVE", suffixDirection: "NW", fromAddress: "1600", toAddress: "1648" },
        matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
      },
    ],
  },
};

test("parseCensusGeocode: the first match, rounded to about 100 m, with a tidy label and a short place", () => {
  const home = parseCensusGeocode(CENSUS_FIXTURE);
  assert.deepEqual(home, {
    lat: 38.899,
    lng: -77.035,
    label: "1600 Pennsylvania Ave NW, Washington, DC 20500",
    place: "Washington, DC",
    zip: "20500",
  });
});

test("parseCensusGeocode: no match, a missing shape, or impossible coordinates give null", () => {
  assert.equal(parseCensusGeocode({ result: { addressMatches: [] } }), null);
  assert.equal(parseCensusGeocode({}), null);
  assert.equal(parseCensusGeocode(null), null);
  assert.equal(parseCensusGeocode({ result: { addressMatches: [{ coordinates: { x: "east", y: 1 } }] } }), null);
  assert.equal(parseCensusGeocode({ result: { addressMatches: [{ coordinates: { x: -200, y: 1 } }] } }), null);
});

test("titleCaseAddress keeps directionals and state codes, lowers street suffixes, and leaves ordinals alone", () => {
  assert.equal(titleCaseAddress("1600 PENNSYLVANIA AVE NW"), "1600 Pennsylvania Ave NW");
  assert.equal(titleCaseAddress("12 E 1ST ST"), "12 E 1st St");
  assert.equal(titleCaseAddress("WASHINGTON"), "Washington");
  assert.equal(roundCoord(38.898702605245), 38.899);
});

test("zipHome: a ZIP-only home names the ZIP, not an address", () => {
  assert.deepEqual(zipHome("02139", { lat: 42.3647, lng: -71.1042 }), { lat: 42.365, lng: -71.104, label: "ZIP code 02139 (its center)", place: "ZIP 02139", zip: "02139" });
});

/* ------------------------------------------------------------------ */
/* The checked-in ZIP table                                            */
/* ------------------------------------------------------------------ */

test("parseCentroidCsv skips comments and the header and drops malformed rows", () => {
  const table = parseCentroidCsv("# a comment\nzcta,lat,lng\n02139,42.365,-71.104\nbad,1,2\n02140,x,y\n");
  assert.equal(table.size, 1);
  assert.deepEqual(table.get("02139"), { lat: 42.365, lng: -71.104 });
});

test("data/reference/zcta-centroids.csv: every row is a five-digit ZCTA with coordinates in the U.S., and well-known ZIPs land where they should", () => {
  const text = readFileSync(join(ROOT, "data", "reference", "zcta-centroids.csv"), "utf8");
  assert.match(text.split("\n")[0], /^# ZCTA centers from the U\.S\. Census Bureau/);
  const table = parseCentroidCsv(text);
  const rows = text.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("zcta,"));
  assert.equal(table.size, rows.length, "every data row parses");
  assert.ok(table.size > 33000, `expected about 33,800 ZCTAs, got ${table.size}`);
  for (const [zip, c] of table) {
    assert.match(zip, /^\d{5}$/);
    // The states, Puerto Rico and the Virgin Islands (west of 64°W); American Samoa (south of the equator); Guam and
    // the Northern Marianas (east of 144°E).
    assert.ok(c.lat > -15 && c.lat < 72 && (c.lng < -64 || c.lng > 144), `${zip} is outside the U.S. and its territories: ${c.lat}, ${c.lng}`);
  }
  const cambridge = table.get("02139")!;
  assert.ok(Math.abs(cambridge.lat - 42.36) < 0.03 && Math.abs(cambridge.lng + 71.1) < 0.03, "02139 is Cambridge, MA");
  const athens = table.get("30602")!;
  assert.ok(Math.abs(athens.lat - 33.95) < 0.05 && Math.abs(athens.lng + 83.37) < 0.05, "30602 is the University of Georgia's ZIP");
});

/* ------------------------------------------------------------------ */
/* The filter predicate getSchools() applies                           */
/* ------------------------------------------------------------------ */

const nearBoston = (miles: number) => ({ zip: "02108", lat: BOSTON.lat, lng: BOSTON.lng, miles });

test("isWithinHome: inside the radius passes, outside fails, and a college without coordinates never matches, however wide the radius", () => {
  assert.equal(isWithinHome({ lat: 42.4, lng: -71.1 }, nearBoston(25)), true);
  assert.equal(isWithinHome(NYC, nearBoston(100)), false);
  assert.equal(isWithinHome(NYC, nearBoston(200)), true);
  assert.equal(isWithinHome(LA, nearBoston(500)), false);
  assert.equal(isWithinHome({ lat: null, lng: null }, nearBoston(5000)), false);
});

/* ------------------------------------------------------------------ */
/* Guards: the filter stays server-side, and the account exports it    */
/* ------------------------------------------------------------------ */

test("guard: getSchools() applies `near` itself with isWithinHome, before sorting, and sortBy=distance measures from the same home", () => {
  const src = readFileSync(join(ROOT, "lib", "dataset.ts"), "utf8");
  const fnStart = src.indexOf("function getSchools(");
  const fnEnd = src.indexOf("\n  }", fnStart);
  assert.ok(fnStart > 0 && fnEnd > fnStart, "getSchools() should exist in lib/dataset.ts");
  const body = src.slice(fnStart, fnEnd);
  assert.match(body, /const near = filters\.near/, "getSchools() must read filters.near itself (never nearZip: the page resolves the ZIP)");
  assert.doesNotMatch(body, /nearZip|withinMiles/, "the raw URL values are the page's business, not the filter's");
  assert.match(body, /if \(near\) results = results\.filter\(\(s\) => isWithinHome\(s\.location, near\)\)/, "the radius filter is lib/home.ts's isWithinHome, applied to the running list");
  assert.match(body, /distanceFromHome\(s\.location, near\)/, "the sort's getter is the same distance the cards show");
  assert.match(body, /sortBy === "distance" \? miles : SORTERS\[sortBy\]/, "sortBy=distance swaps in the distance getter; the SORTERS placeholder returns null");
  assert.ok(body.indexOf("if (near) results") < body.indexOf("const sortBy"), "the radius filter runs before the sort picks its getter");
});

test("guard: a getSchools() that post-filters by distance after sorting, or sorts by a different home, fails the check above", () => {
  const broken = "function getSchools(filters) {\n    const sortBy = filters.sortBy;\n    const sorted = [...schools].sort();\n    return filters.near ? sorted.filter((s) => s.location.lat != null) : sorted;\n  }";
  const fnStart = broken.indexOf("function getSchools(");
  const body = broken.slice(fnStart, broken.indexOf("\n  }", fnStart));
  assert.doesNotMatch(body, /const near = filters\.near/);
  assert.doesNotMatch(body, /isWithinHome\(/);
});

test("guard: Explore resolves the ZIP before getSchools(filters) and passes the home to every result view", () => {
  const src = readFileSync(join(ROOT, "app", "explore", "page.tsx"), "utf8");
  assert.match(src, /const filters = resolveNear\(parseFilters\(params\)\)/, "the page must resolve `near` from the ZIP table before filtering");
  assert.ok(src.indexOf("resolveNear(") < src.indexOf("getSchools(filters)"));
  for (const view of ["<SchoolTable", "<SchoolRow", "<SchoolCard"]) {
    const at = src.indexOf(view);
    assert.ok(at > 0 && /home=\{home\}/.test(src.slice(at, src.indexOf(">", at) + 1)), `${view} must receive home={home}`);
  }
  assert.match(src, /filters\.nearZip && !filters\.near/, "an unknown ZIP must be explained, not silently ignored");
});

test("the account export includes the home as its own key", () => {
  const home = ACCOUNT_EXPORTERS.find((e) => e.key === "home");
  assert.ok(home, "ACCOUNT_EXPORTERS must register a `home` exporter");
  assert.match(home!.description, /home address/i);
});
