/**
 * The Element451 reader (scripts/lib/visit-events/readers/element451.mts, discover-element451.mts; specs/product/
 * visit-events.md "Round 3: TargetX and Element451", "Element451: the protocol") on four saved sites (research in
 * visit-events-build/research/element451.md, fixtures trimmed under tests/fixtures/visit-events/element451/: each
 * `<client>-listing.html` keeps one copy of the `event451-state` blob and drops the page's `<style>` blocks and other
 * `<script>` tags, which the parser never reads, to stay under 400 KB — noted here rather than in the fixtures
 * themselves). Also the dispatch seam (`readSite`) that sends a `slate` host to `readHost` and an `element451` host
 * to this reader.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  elementRows,
  listElementEvents,
  parseElementState,
  readElementSite,
  type ElementItem,
} from "../scripts/lib/visit-events/readers/element451.mts";
import { discoverElementSite, elementCandidateHosts } from "../scripts/lib/visit-events/readers/discover-element451.mts";
import { loadZipTable } from "../scripts/lib/visit-events/geo.mts";
import { CollapsedSearchError, readSite, type ReadDeps } from "../scripts/lib/visit-events/sync.mts";
import type { SlateHostRow } from "../lib/visit-events/types.ts";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(import.meta.dirname, "fixtures", "visit-events", "element451");
const read = (f: string) => readFileSync(join(FIX, f), "utf8");
const zips = loadZipTable(ROOT);

/** A fetch stand-in serving fixtures by URL; anything else 404s. */
function fakeHttp(pages: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    async get(url: string): Promise<Response | null> {
      asked.push(url);
      const body = pages[url];
      const res = new Response(body ?? "not found", { status: body === undefined ? 404 : 200, headers: { "content-type": "text/html" } });
      Object.defineProperty(res, "url", { value: url });
      return res;
    },
  };
}

/* ------------------------------------------------------------------ */
/* parseElementState / listElementEvents: the four fixtures            */
/* ------------------------------------------------------------------ */

test("parseElementState: the four fixtures give the listing's items and client token", () => {
  const cccb = parseElementState(read("cccb-listing.html"));
  assert.equal(cccb.eventsListStore.items.length, 3);
  assert.equal(cccb.eventsListStore.total, 3);
  assert.equal(cccb.configState?.client?.token, "cccb");

  const stfrancis = parseElementState(read("stfrancis-listing.html"));
  assert.equal(stfrancis.eventsListStore.items.length, 7);
  assert.equal(stfrancis.configState?.client?.token, "stfrancis");

  const webber = parseElementState(read("webber-listing.html"));
  assert.equal(webber.eventsListStore.items.length, 2);
  assert.equal(webber.configState?.client?.token, "webber");

  const cookman = parseElementState(read("cookman-listing.html"));
  assert.equal(cookman.eventsListStore.items.length, 3);
  assert.equal(cookman.configState?.client?.token, "cookman");
});

test("parseElementState: a page without the blob, or with eventsListStore missing, is a collapse; invalid JSON too", () => {
  const html = read("cccb-listing.html");
  const noBlob = html.replace(/<script id="event451-state"[\s\S]*?<\/script>/, "");
  assert.throws(() => parseElementState(noBlob), (err: Error) => err instanceof CollapsedSearchError && /no id="event451-state"/.test(err.message));

  const brokenJson = html.replace(/(<script id="event451-state" type="application\/json">)([\s\S]*?)(<\/script>)/, (_m, a, _b, c) => `${a}{not json${c}`);
  assert.throws(() => parseElementState(brokenJson), (err: Error) => err instanceof CollapsedSearchError && /valid JSON/.test(err.message));

  const noStore = html.replace(/"eventsListStore":\{/, '"renamedStore":{');
  assert.throws(() => parseElementState(noStore), (err: Error) => err instanceof CollapsedSearchError && /eventsListStore\.items/.test(err.message));
});

test("listElementEvents: one GET of the site's root gives the items and the listing URL as source_url", async () => {
  const http = fakeHttp({ "https://cccb.event451.sites.451.io/": read("cccb-listing.html") });
  const { items, total, sourceUrl } = await listElementEvents("cccb.event451.sites.451.io", http);
  assert.equal(items.length, 3);
  assert.equal(total, 3);
  assert.equal(sourceUrl, "https://cccb.event451.sites.451.io/");
  assert.deepEqual(http.asked, ["https://cccb.event451.sites.451.io/"]);
});

/* ------------------------------------------------------------------ */
/* elementRows: the mapping and the row count per fixture               */
/* ------------------------------------------------------------------ */

function itemsOf(fixture: string): ElementItem[] {
  return parseElementState(read(fixture)).eventsListStore.items;
}

test("elementRows: one row per occurrences.upcoming[] entry, the parent's title and location carried down", () => {
  const rows = elementRows(itemsOf("cccb-listing.html"), { host: "cccb.event451.sites.451.io", unitId: "176910", sourceUrl: "https://cccb.event451.sites.451.io/", zips, campusCity: null });
  // 3 items, 10 + 1 + 1 occurrences (research/element451/fixtures/cccb/listing-state.json).
  assert.equal(rows.length, 12);
  assert.ok(rows.every((r) => r.host === "cccb.event451.sites.451.io" && r.unit_id === "176910" && r.date_confirmed === true));
  const tour = rows.filter((r) => r.slate_id.startsWith("cccb.events.212835:"));
  assert.equal(tour.length, 10);
  assert.ok(tour.every((r) => r.title === "Campus Visit" && r.city === "Moberly" && r.state === "MO" && r.zip === "65270"));
});

test("elementRows: counts of items and occurrences across all four fixtures", () => {
  const counts: Record<string, [items: number, rows: number]> = {
    "cccb-listing.html": [3, 12],
    "stfrancis-listing.html": [7, 26],
    "webber-listing.html": [2, 11],
    "cookman-listing.html": [3, 22],
  };
  for (const [fixture, [items, rows]] of Object.entries(counts)) {
    const parsed = itemsOf(fixture);
    assert.equal(parsed.length, items, fixture);
    const built = elementRows(parsed, { host: "h", unitId: "1", sourceUrl: "https://h/", zips, campusCity: null });
    assert.equal(built.length, rows, fixture);
  }
});

test("elementRows: coordinates and ZIP present on every in-person row (better than Slate's page-read fallback)", () => {
  const rows = elementRows(itemsOf("stfrancis-listing.html"), { host: "stfrancis.event451.sites.451.io", unitId: "148584", sourceUrl: "https://stfrancis.event451.sites.451.io/", zips, campusCity: null });
  const visit = rows.find((r) => r.slate_id.startsWith("stfrancis.events.1909771:"))!;
  assert.equal(visit.online, false);
  assert.equal(visit.zip, "60435");
  assert.equal(visit.city, "Joliet");
  assert.equal(visit.state, "IL");
  assert.equal(visit.lat, 41.533);
  assert.equal(visit.lng, -88.096);
  assert.equal(visit.venue, "USF Welcome Center");
});

test("elementRows: a virtual item has no place-naming location and comes out online (research's documented rule: no location key; this fixture's own shape: a location present with only a platform name and no city/address/geo — undocumented, treated the same)", () => {
  const items = itemsOf("stfrancis-listing.html");
  const virtual = items.find((i) => i.guid === "stfrancis.events.1909415")!;
  assert.ok(virtual.location, "the fixture's location key IS present (not absent) for this virtual item");
  assert.equal((virtual.location as Record<string, unknown>).city, undefined);
  const rows = elementRows([virtual], { host: "stfrancis.event451.sites.451.io", unitId: "148584", sourceUrl: "https://stfrancis.event451.sites.451.io/", zips, campusCity: null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].online, true);
  assert.equal(rows[0].kind, "online");
  assert.equal(rows[0].lat, null);
  assert.equal(rows[0].lng, null);
  assert.equal(rows[0].zip, null);
  assert.equal(rows[0].city, null);
});

test("elementRows: availability from the occurrence's own flags (is_open/is_full/is_closed), not a single page-level flag", () => {
  const item = itemsOf("cccb-listing.html").find((i) => i.guid === "cccb.events.212835")!;
  const rows = elementRows([item], { host: "cccb.event451.sites.451.io", unitId: "176910", sourceUrl: "https://cccb.event451.sites.451.io/", zips, campusCity: null });
  const availabilities = new Set(rows.map((r) => r.availability));
  assert.deepEqual([...availabilities].sort(), ["full", "open"]);
  const full = rows.find((r) => r.slate_id.includes("1858230:1792420200"))!;
  assert.equal(full.availability, "full");
});

test("elementRows: the composite id disambiguates occurrences that share a recurring slot's element_guid (the research's `item.guid:element_guid` id would collide: CCCB's 10 occurrences share only 2 element_guid values)", () => {
  const item = itemsOf("cccb-listing.html").find((i) => i.guid === "cccb.events.212835")!;
  const elementGuids = new Set((item.occurrences?.upcoming ?? []).map((o) => o.element_guid));
  assert.equal(elementGuids.size, 2, "2 distinct element_guid values across 10 occurrences, confirming the collision risk");
  const rows = elementRows([item], { host: "h", unitId: "1", sourceUrl: "https://h/", zips, campusCity: null });
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((r) => r.id)).size, 10, "every occurrence gets its own id despite the shared element_guid");
  assert.equal(new Set(rows.map((r) => r.slate_id)).size, 10);
});

test("elementRows: kindOf results for the fixture titles (event_type appended only when the title alone is `other`)", () => {
  const expected: Record<string, string> = {
    // cccb
    "cccb.events.212835": "info_session", // "Campus Visit" matches SESSION's literal "campus visit"
    "cccb.events.592334": "other", // "PURSUE at Central Bible University" (youth-events) matches nothing, even appended
    "cccb.events.1262676": "other", // "seal'D 2027" (youth-events)
    // stfrancis
    "stfrancis.events.1909771": "info_session", // "USF Personal Campus Visit"
    "stfrancis.events.1909415": "online", // "...Virtual Information Session"
    "stfrancis.events.1926569": "info_session", // "Honors Visit Day" (\bvisit\b)
    "stfrancis.events.1909233": "online", // "MSW Virtual Information Session"
    "stfrancis.events.1671103": "info_session", // "Saturday Information Session"
    "stfrancis.events.1919722": "info_session", // "USF Campus Visit Day"
    "stfrancis.events.1694042": "other", // "Discover USF Day": no space-hyphen-space, not even appending "discover-usf-day" matches
    // webber
    "webber.events.1980051": "other", // "Fall B-Term Start Date" (registration)
    "webber.events.688345": "tour", // "Webber Daily Campus Tour"
    // cookman
    "cookman.events.242147": "tour", // "Wildcat 360 Campus Tour: Families" (event_type open-house, but no "open house" in the title)
    "cookman.events.248323": "tour", // "...Schools/Organizations" — no "high school"/"fair", so NOT_A_TOUR doesn't veto it
    "cookman.events.2039255": "tour", // "the stompdown Campus Tour-Private Event"
  };
  for (const fixture of ["cccb-listing.html", "stfrancis-listing.html", "webber-listing.html", "cookman-listing.html"]) {
    for (const item of itemsOf(fixture)) {
      const want = expected[item.guid];
      assert.ok(want, `${item.guid} needs an expectation`);
      const rows = elementRows([item], { host: "h", unitId: "1", sourceUrl: "https://h/", zips, campusCity: null });
      assert.equal(rows[0]?.kind, want, `${item.guid} ("${item.content.title}")`);
      assert.ok(rows.every((r) => r.kind === want), `${item.guid}: every occurrence shares the item's kind`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* readElementSite: the whole host read, and its guards                 */
/* ------------------------------------------------------------------ */

test("readElementSite: reads the site's one page, builds every row, and reports the search total", async () => {
  const http = fakeHttp({ "https://webber.event451.sites.451.io/": read("webber-listing.html") });
  const hostRow = { unit_id: "138293", host: "webber.event451.sites.451.io", config: { site: "webber.event451.sites.451.io", client: "webber" } };
  const r = await readElementSite(hostRow, { http, zips, campusCity: null });
  assert.equal(r.rows.length, 11);
  assert.equal(r.searchTotal, 2);
  assert.equal(r.fetched, 1);
  assert.equal(r.pagesRead, 0, "no event page is ever read; the listing has everything");
  assert.deepEqual(r.errors, []);
});

test("readElementSite: total > items.length is a warning, the rows it did get are kept (not silently dropped)", async () => {
  const html = read("webber-listing.html").replace('"total":2,"offset"', '"total":9,"offset"');
  const http = fakeHttp({ "https://webber.event451.sites.451.io/": html });
  const hostRow = { unit_id: "138293", host: "webber.event451.sites.451.io", config: { site: "webber.event451.sites.451.io" } };
  const r = await readElementSite(hostRow, { http, zips, campusCity: null });
  assert.equal(r.searchTotal, 9);
  assert.equal(r.rows.length, 11, "the 2 items' rows are still built, never dropped for the mismatch");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /total \(9\) is greater than items\.length \(2\)/);
});

test("readElementSite: a collapsed site (no blob) throws CollapsedSearchError, same as Slate's collapse", async () => {
  const http = fakeHttp({ "https://dead.event451.sites.451.io/": "<html><body>Not Found</body></html>" });
  const hostRow = { unit_id: "1", host: "dead.event451.sites.451.io", config: {} };
  await assert.rejects(readElementSite(hostRow, { http, zips, campusCity: null }), (err: Error) => err instanceof CollapsedSearchError);
});

/* ------------------------------------------------------------------ */
/* Discovery                                                            */
/* ------------------------------------------------------------------ */

test("elementCandidateHosts: event451.sites.451.io hosts before any other linked host", () => {
  const html = read("cccb-visit-page.html");
  const page = "https://centralbible.edu/visit";
  const hosts = elementCandidateHosts(html, page);
  assert.ok(hosts.includes("cccb.event451.sites.451.io"));
  assert.equal(hosts[0], "cccb.event451.sites.451.io");
});

test("discoverElementSite: a visit page that links an event451 site, confirmed by its root blob", async () => {
  const visitUrl = "https://centralbible.edu/visit";
  const http = fakeHttp({
    [visitUrl]: read("cccb-visit-page.html"),
    "https://cccb.event451.sites.451.io/": read("cccb-listing.html"),
  });
  const d = await discoverElementSite("176910", visitUrl, http);
  assert.equal(d?.host, "cccb.event451.sites.451.io");
  assert.equal(d?.foundOn, visitUrl);
  assert.deepEqual(d?.config, { site: "cccb.event451.sites.451.io", client: "cccb" });
});

test("discoverElementSite: a visit link that is itself the site (visit.cookman.edu) needs no hop", async () => {
  const visitUrl = "https://visit.cookman.edu/";
  const http = fakeHttp({ [visitUrl]: read("cookman-listing.html") });
  const d = await discoverElementSite("132602", visitUrl, http);
  assert.equal(d?.host, "visit.cookman.edu");
  assert.equal(d?.foundOn, visitUrl);
  assert.deepEqual(d?.config, { site: "visit.cookman.edu", client: "cookman" });
});

test("discoverElementSite: a candidate without the blob is rejected and logged; nothing found is null", async () => {
  const visitUrl = "https://nowhere.edu/visit";
  const logs: string[] = [];
  const http = fakeHttp({
    [visitUrl]: '<a href="https://nowhere.event451.sites.451.io/">Visit us</a>',
    "https://nowhere.event451.sites.451.io/": "<html><body>Coming soon</body></html>",
  });
  const d = await discoverElementSite("1", visitUrl, http, { log: (m) => logs.push(m) });
  assert.equal(d, null);
  assert.ok(logs.some((l) => l.includes("nowhere.event451.sites.451.io rejected")));
  // No visit link, no page at all: still null, never throws.
  const none = fakeHttp({});
  assert.equal(await discoverElementSite("1", "https://gone.edu/visit", none), null);
  assert.equal(await discoverElementSite("1", null, none), null);
});

/* ------------------------------------------------------------------ */
/* readSite: the vendor dispatch seam in sync.mts                       */
/* ------------------------------------------------------------------ */

const baseDeps: Omit<ReadDeps, "http"> = {
  now: new Date("2026-10-15T08:00:00Z"),
  zips,
  campusCity: null,
  campusState: null,
  campusLat: null,
  campusLng: null,
  stored: new Map(),
};

test("readSite: a slate host takes the readHost path", async () => {
  const host = "example.slate.edu";
  const html = '<html><h1>Event Registration</h1><p>Your search returned 0 event(s).</p></html>';
  const http = fakeHttp({ [`https://${host}/register/?cmd=search&country=US`]: html });
  const hostRow: SlateHostRow = {
    unit_id: "1", host, vendor: "slate", config: {}, found_on: null, portal_parts: [], status: "active", failures: 0,
    first_seen: "2026-10-01T00:00:00Z", last_read: null, last_error: null, last_attempt: null, search_total: null, zero_since: null,
  };
  const r = await readSite(hostRow, { ...baseDeps, http });
  assert.equal(r.searchTotal, 0);
  assert.equal(r.rows.length, 0);
});

test("readSite: an element451 host takes the Element451 reader's path", async () => {
  const host = "webber.event451.sites.451.io";
  const http = fakeHttp({ [`https://${host}/`]: read("webber-listing.html") });
  const hostRow: SlateHostRow = {
    unit_id: "138293", host, vendor: "element451", config: { site: host, client: "webber" }, found_on: null, portal_parts: [],
    status: "active", failures: 0, first_seen: "2026-10-01T00:00:00Z", last_read: null, last_error: null, last_attempt: null,
    search_total: null, zero_since: null,
  };
  const r = await readSite(hostRow, { ...baseDeps, http });
  assert.equal(r.searchTotal, 2);
  assert.equal(r.rows.length, 11);
});

test("readSite: an unhandled vendor throws, naming it, rather than silently skipping the host (a vendor neither this reader nor TargetX's claims)", async () => {
  const hostRow = {
    unit_id: "1", host: "h", vendor: "carrier-pigeon" as unknown as SlateHostRow["vendor"], config: {}, found_on: null, portal_parts: [],
    status: "active" as const, failures: 0, first_seen: "2026-10-01T00:00:00Z", last_read: null, last_error: null, last_attempt: null,
    search_total: null, zero_since: null,
  };
  await assert.rejects(readSite(hostRow, { ...baseDeps, http: fakeHttp({}) }), (err: Error) => /no reader for vendor "carrier-pigeon"/.test(err.message));
});
