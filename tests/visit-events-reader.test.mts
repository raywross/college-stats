/**
 * The visit-events reader (scripts/lib/visit-events/; specs/product/visit-events.md "The nightly job") on pages saved
 * from UF and Duke on 2026-10-13: the standard search, the portal widgets, the event page, discovery, the ZIP lookup,
 * the pure diff (new, changed, missed, removed after two misses, idempotent), a whole host read over a fake fetch,
 * and the check's guards.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStandardSearch, isSlateEventRegistration } from "../scripts/lib/visit-events/slate-search.mts";
import { findWidgetServices, parseWidgetList, widgetListUrl } from "../scripts/lib/visit-events/slate-widget.mts";
import { parseEventPage } from "../scripts/lib/visit-events/event-page.mts";
import { CANDIDATE_HOST, candidateHosts, discoverSlateHost, portalPages, rankCandidates, rankHosts, slateLinks } from "../scripts/lib/visit-events/discover.mts";
import { loadZipTable, locate } from "../scripts/lib/visit-events/geo.mts";
import { diffEvents, needsPage, pagePolicy, readHost, runSync, syncHost, withholdMisses, CollapsedSearchError, MISSES_TO_REMOVE, type EventStore, type ReadEvent, type StoredEvent, type SyncRecord } from "../scripts/lib/visit-events/sync.mts";
import { checkHosts, hostReport } from "../scripts/lib/visit-events/check.mts";
import type { SlateHostRow } from "../lib/visit-events/types.ts";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(import.meta.dirname, "fixtures", "visit-events");
const read = (f: string) => readFileSync(join(FIX, f), "utf8");
const UF = "undergrad.admissions.ufl.edu";
const OCT_13 = new Date("2026-10-13T16:00:00Z");

/* ------------------------------------------------------------------ */
/* Parsers                                                             */
/* ------------------------------------------------------------------ */

test("parseStandardSearch: UF's US page gives every row with id, title, when, place, and state", () => {
  const { total, rows } = parseStandardSearch(read("uf-standard-search-us.html"), UF);
  // The page says "returned 519 event(s)" and lists 519 distinct ids.
  assert.equal(total, 519);
  assert.equal(rows.length, 519);
  assert.equal(new Set(rows.map((r) => r.slateId)).size, 519);
  assert.deepEqual(rows[0], {
    slateId: "78137e05-d612-49a1-840f-b91f674fb563",
    title: "Chadwick School College Night",
    when: "Tuesday, October 13 at 6:30 PM",
    place: "Palos Verdes Peninsula, CA",
    state: "CA",
    bookUrl: "https://undergrad.admissions.ufl.edu/register/?id=78137e05-d612-49a1-840f-b91f674fb563",
  });
  assert.equal(new Set(rows.map((r) => r.state)).size, 18);
  assert.ok(rows.every((r) => r.state && r.title && r.when && r.place));
  // The "Canyon Crest Acadmey" typo is UF's; entities decode ("Bishop's School").
  assert.ok(rows.some((r) => r.title === "Bishop's School"));
  const allDay = rows.find((r) => r.title === "Campus Visit");
  assert.equal(allDay?.when, "Wednesday, October 14");
});

test("parseStandardSearch: the ZIP page's distance bands are ignored; rows keep the same shape", () => {
  const { total, rows } = parseStandardSearch(read("uf-standard-search-zip32611.html"), UF);
  assert.equal(total, 209);
  assert.equal(rows.length, 209);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["bookUrl", "place", "slateId", "state", "title", "when"]);
  // No section names a state, so the state comes from the place.
  assert.equal(rows[0].state, "FL");
  assert.ok(rows.every((r) => !/miles/.test(r.title) && !/miles/.test(r.place)));
});

test("isSlateEventRegistration: the search form and its results, not a portal or a college page", () => {
  assert.equal(isSlateEventRegistration(read("uf-standard-search-form.html")), true);
  assert.equal(isSlateEventRegistration(read("uf-standard-search-us.html")), true);
  assert.equal(isSlateEventRegistration(read("uf-portal-campus-tour.html")), false);
  assert.equal(isSlateEventRegistration(read("duke-visit-page.html")), false);
});

test("findWidgetServices: one event widget on each UF portal, entities decoded", () => {
  assert.deepEqual(findWidgetServices(read("uf-portal-campus-tour.html")), [
    "/portal/widget/event?portal_id=cf68cc9c-d780-45ff-8715-dc5734c85f95&part=0025b0c3-7ebf-4467-80b6-bf9d8df7c1bf",
  ]);
  assert.deepEqual(findWidgetServices(read("uf-portal-virtual-sessions.html")), [
    "/portal/widget/event?portal_id=cd8fe571-0b26-4785-b2a9-f48ec9ad4e8c&part=5b83d1e8-11c8-40a1-a2c3-0cdcbdf8b701",
  ]);
  assert.equal(
    widgetListUrl(UF, "/portal/widget/event?portal_id=a&part=b", 2),
    "https://undergrad.admissions.ufl.edu/portal/widget/event?portal_id=a&part=b&cmd=event_list&page=2",
  );
});

test("parseWidgetList: online flag, legend to open/full, date, and the link", () => {
  const rows = parseWidgetList(read("uf-widget-virtual-sessions-event_list.html"), UF);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], {
    slateId: "9303c570-11f3-44fa-adf8-d3655c837ac3",
    title: "Honors information Session",
    whenIso: "2026-10-13T18:30:00",
    online: true,
    place: "Online",
    availability: "full",
    bookUrl: "https://undergrad.admissions.ufl.edu/register/?id=9303c570-11f3-44fa-adf8-d3655c837ac3",
  });
  assert.equal(rows[1].availability, "open");
  assert.ok(rows.every((r) => r.online));
});

test("parseWidgetList: UF's own tour template (no legend, a day alone, a button for a title)", () => {
  const rows = parseWidgetList(read("uf-widget-campus-tour-event_list-2026-10-21.html"), UF);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slateId, "4c7c83d8-5e9a-4660-ba5e-fa059d4f09d9");
  assert.equal(rows[0].whenIso, "2026-10-21");
  assert.equal(rows[0].online, false);
  assert.equal(rows[0].place, "Welcome Center");
  assert.equal(rows[0].availability, null);
});

test("parseWidgetList: UT Austin's template nests a placeholder item (2024-08-12, offline) around the link; the outer item wins", () => {
  const rows = parseWidgetList(read("ut-widget-virtual-sessions-event_list.html"), "bealonghorn.admissions.utexas.edu");
  assert.equal(rows.length, 53);
  assert.deepEqual(rows[0], {
    slateId: "e91013b2-177a-4a3b-b09c-6a30d41976e9",
    title: "University Housing and Dining: Living On Campus - Virtual",
    whenIso: "2026-10-14T07:00:00",
    online: true,
    place: "Online",
    availability: "full",
    bookUrl: "https://bealonghorn.admissions.utexas.edu/register/?id=e91013b2-177a-4a3b-b09c-6a30d41976e9",
  });
  assert.ok(rows.every((r) => r.online && !r.whenIso.startsWith("2024")));
});

test("parseEventPage: the online info session, 28 Oct 6:30–7:30 pm Eastern", () => {
  const p = parseEventPage(read("uf-event-page-info-session.html"));
  assert.equal(p.title, "Prospective Information Session");
  assert.equal(p.start, "2026-10-28T18:30:00");
  assert.equal(p.end, "2026-10-28T19:30:00");
  assert.equal(p.zone, "America/New_York");
  assert.equal(p.offset, "-04:00");
  assert.equal(p.allDay, false);
  assert.equal(p.closed, false);
  assert.equal(p.venue, null);
  assert.equal(p.zip, null);
  assert.match(p.description ?? "", /^Ask a Gator features an Admissions Officer/);
});

test("parseEventPage: the closed open house, with its venue, street, ZIP, and map", () => {
  const p = parseEventPage(read("uf-event-page-open-house-closed.html"));
  assert.equal(p.title, "Open House - October 12, 2026");
  assert.equal(p.start, "2026-10-12T08:00:00");
  assert.equal(p.end, "2026-10-12T17:00:00");
  assert.equal(p.zone, "America/New_York");
  assert.equal(p.venue, "J. Wayne Reitz Union");
  assert.equal(p.address, "686 Museum Road");
  assert.equal(p.city, "Gainesville");
  assert.equal(p.state, "FL");
  assert.equal(p.zip, "32611");
  assert.equal(p.mapLat, 29.646);
  assert.equal(p.mapLng, -82.348);
  assert.equal(p.closed, true);
  assert.match(p.description ?? "", /current high school seniors\. Participants/);
});

/* ------------------------------------------------------------------ */
/* ZIP → lat/lng                                                       */
/* ------------------------------------------------------------------ */

test("locate: the ZIP's ZCTA centre, else the page's map, never an online event", () => {
  const zips = loadZipTable(join(ROOT, "tests", "fixtures", "visit-events", "zcta-centroids.csv"));
  const gnv = locate(zips, { zip: "32601", online: false });
  assert.equal(gnv.by, "zip");
  assert.ok(gnv.lat! > 29.5 && gnv.lat! < 29.8 && gnv.lng! < -82.2 && gnv.lng! > -82.5);
  assert.deepEqual(locate(zips, { zip: null, online: false, mapLat: 29.6461, mapLng: -82.3481 }), { lat: 29.646, lng: -82.348, by: "map" });
  // UF's own campus ZIP (32611, a unique ZIP) has no ZCTA: the page's map places those events.
  assert.deepEqual(locate(zips, { zip: "32611", online: false }), { lat: null, lng: null, by: null });
  assert.deepEqual(locate(zips, { zip: "32611", online: false, mapLat: 29.646, mapLng: -82.348 }).by, "map");
  assert.deepEqual(locate(zips, { zip: "32611", online: true }), { lat: null, lng: null, by: null });
});

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/** A fetch stand-in serving fixtures by URL; anything else is a 404. Counts requests. */
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

test("slateLinks and rankHosts: Duke's own Slate host before Duke Kunshan's, portal pages once each", () => {
  const links = slateLinks(read("duke-visit-page.html"), "https://admissions.duke.edu/visit/");
  assert.deepEqual(rankHosts(links, ["admissions.duke.edu"]), ["admiss.ugrad.duke.edu", "apply.dukekunshan.edu.cn"]);
  assert.deepEqual(portalPages(links, "admiss.ugrad.duke.edu"), ["/portal/visits", "/portal/group-tours", "/portal/discover-duke"].sort((a, b) => links.findIndex((u) => u.pathname === a) - links.findIndex((u) => u.pathname === b)));
});

test("discoverSlateHost: one hop from the visit page, confirmed by the standard search, with the portal widgets", async () => {
  const host = "admiss.ugrad.duke.edu";
  const http = fakeHttp({
    "https://admissions.duke.edu/visit": read("duke-visit-page.html"),
    [`https://${host}/register/?cmd=search&country=US`]: read("uf-standard-search-form.html"),
    [`https://${host}/portal/visits`]: read("uf-portal-campus-tour.html"),
    [`https://${host}/portal/discover-duke`]: read("uf-portal-virtual-sessions.html"),
  });
  const d = await discoverSlateHost("198419", "https://admissions.duke.edu/visit", null, http);
  assert.equal(d?.host, host);
  assert.equal(d?.foundOn, "https://admissions.duke.edu/visit");
  assert.deepEqual(
    d?.portalParts.map((p) => p.page),
    ["/portal/visits", "/portal/discover-duke"],
  );
  // Duke Kunshan's host was never asked: the first candidate confirmed.
  assert.ok(!http.asked.some((u) => u.includes("dukekunshan")));
});

test("discoverSlateHost: a host whose search isn't Slate's page is refused; a blocked host is never fetched; nothing found is null", async () => {
  const notSlate = fakeHttp({
    "https://admissions.duke.edu/visit": read("duke-visit-page.html"),
    "https://admiss.ugrad.duke.edu/register/?cmd=search&country=US": "<html><h1>Sorry</h1></html>",
  });
  assert.equal(await discoverSlateHost("198419", "https://admissions.duke.edu/visit", null, notSlate), null);
  const blocked = fakeHttp({ "https://admissions.duke.edu/visit": read("duke-visit-page.html") });
  assert.equal(await discoverSlateHost("198419", "https://admissions.duke.edu/visit", null, blocked, { isBlocked: (h) => h !== "admissions.duke.edu" }), null);
  assert.ok(!blocked.asked.some((u) => u.includes("admiss.ugrad")));
  // A visit link that is itself a Slate portal needs no hop; the apply link is the fallback.
  const direct = fakeHttp({
    "https://www.example.edu/visit": "<html>no links</html>",
    "https://apply.example.edu/portal/visit": read("uf-portal-campus-tour.html"),
    "https://apply.example.edu/register/?cmd=search&country=US": read("uf-standard-search-us.html"),
  });
  const d = await discoverSlateHost("1", "https://www.example.edu/visit", "https://apply.example.edu/portal/visit", direct);
  assert.equal(d?.host, "apply.example.edu");
  assert.equal(d?.portalParts.length, 1);
});

test("discoverSlateHost: a page that links its Slate host only by /status (UNC) still finds it; the college's own /apply is no candidate", async () => {
  const visit = '<a href="/apply/">Apply</a><a href="https://www.unc.edu/apply">Apply</a><a href="https://mycarolina.unc.edu/status">Check your status</a>';
  const links = slateLinks(visit, "https://admissions.unc.edu/visit/");
  assert.deepEqual(rankHosts(links, ["admissions.unc.edu"]), ["mycarolina.unc.edu", "www.unc.edu"]);
  const http = fakeHttp({
    "https://admissions.unc.edu/visit/": visit,
    "https://mycarolina.unc.edu/register/?cmd=search&country=US": read("uf-standard-search-us.html"),
  });
  const d = await discoverSlateHost("199120", "https://admissions.unc.edu/visit/", null, http);
  assert.equal(d?.host, "mycarolina.unc.edu");
  assert.deepEqual(d?.portalParts, []);
});

test("candidateHosts: Amherst's visit page names admission.amherst.edu only in Slate's embed script; engage.amherst.edu is a subdomain candidate; other hosts are not", () => {
  const html = read("amherst-visit-page.html");
  const page = "https://www.amherst.edu/admission/visit";
  // No href points at admission.amherst.edu: the portal is only in a script string.
  assert.ok(!/href="https:\/\/admission\.amherst\.edu/.test(html));
  const links = slateLinks(html, page);
  assert.deepEqual(rankHosts(links, ["www.amherst.edu"]), ["admission.amherst.edu"]);
  assert.deepEqual(portalPages(links, "admission.amherst.edu"), ["/portal/campus_visit"]);
  const subs = candidateHosts(html, page, ["www.amherst.edu"]);
  assert.ok(subs.includes("engage.amherst.edu"));
  assert.ok(subs.every((h) => CANDIDATE_HOST.test(h)));
  assert.ok(!subs.includes("athletics.amherst.edu") && !subs.includes("give.engage.amherst.edu"));
  // Portal-linked hosts are confirmed before subdomain candidates.
  assert.deepEqual(rankCandidates(links, subs, ["www.amherst.edu"])[0], "admission.amherst.edu");
});

test("candidateHosts: own domain first, any .edu next, never another domain; the start URL counts", () => {
  const html =
    '<a href="https://apply.other.edu/x">a</a><a href="https://go.example.edu/">b</a><a href="https://go.example.edu/y">c</a>' +
    '<a href="https://apply.vendor.com/">d</a><a href="https://visit.example.edu/z">e</a><a href="https://www.example.edu/apply">f</a>';
  assert.deepEqual(candidateHosts(html, "https://www.example.edu/visit", ["www.example.edu"]), ["go.example.edu", "visit.example.edu", "apply.other.edu"]);
  assert.deepEqual(candidateHosts("", "https://admissions.example.edu/apply/", ["admissions.example.edu"]), ["admissions.example.edu"]);
});

test("discoverSlateHost: a subdomain linked without a portal path is confirmed by the standard search; a rejected candidate is logged and the next one wins", async () => {
  const visit = '<a href="https://connect.example.edu/">Connect</a><a href="https://apply.example.edu/">Apply now</a><a href="https://apply.example.edu/start">Start</a>';
  const http = fakeHttp({
    "https://www.example.edu/visit": visit,
    "https://apply.example.edu/register/?cmd=search&country=US": "<html>Common App</html>",
    "https://connect.example.edu/register/?cmd=search&country=US": read("uf-standard-search-us.html"),
  });
  const logs: string[] = [];
  const d = await discoverSlateHost("1", "https://www.example.edu/visit", null, http, { log: (m) => logs.push(m) });
  assert.equal(d?.host, "connect.example.edu");
  assert.equal(d?.foundOn, "https://www.example.edu/visit");
  assert.ok(logs.some((l) => l.includes("apply.example.edu rejected")));
  // apply. has two links, so it was asked first.
  assert.ok(http.asked.indexOf("https://apply.example.edu/register/?cmd=search&country=US") < http.asked.indexOf("https://connect.example.edu/register/?cmd=search&country=US"));
  // Nothing on a vendor domain or a non-admissions subdomain is ever asked.
  const none = fakeHttp({ "https://www.example.edu/visit": '<a href="https://apply.vendor.com/">x</a><a href="https://library.example.edu/">y</a>' });
  assert.equal(await discoverSlateHost("1", "https://www.example.edu/visit", null, none), null);
  assert.deepEqual(none.asked, ["https://www.example.edu/visit"]);
});

test("discoverSlateHost: Amherst's embedded portal is found from the saved visit page", async () => {
  const http = fakeHttp({
    "https://www.amherst.edu/admission/visit": read("amherst-visit-page.html"),
    "https://admission.amherst.edu/register/?cmd=search&country=US": read("uf-standard-search-us.html"),
    "https://admission.amherst.edu/portal/campus_visit": read("uf-portal-campus-tour.html"),
  });
  const d = await discoverSlateHost("164465", "https://www.amherst.edu/admission/visit", null, http);
  assert.equal(d?.host, "admission.amherst.edu");
  assert.equal(d?.foundOn, "https://www.amherst.edu/admission/visit");
  assert.deepEqual(d?.portalParts.map((p) => p.page), ["/portal/campus_visit"]);
});

/* ------------------------------------------------------------------ */
/* The diff                                                            */
/* ------------------------------------------------------------------ */

const NOW = "2026-10-13T08:00:00.000Z";
const LATER = "2026-10-14T08:00:00.000Z";
const LATEST = "2026-10-15T08:00:00.000Z";

function readEvent(over: Partial<ReadEvent> = {}): ReadEvent {
  return {
    id: `${UF}:11111111-1111-1111-1111-111111111111`,
    unit_id: "134130",
    host: UF,
    slate_id: "11111111-1111-1111-1111-111111111111",
    title: "Marietta High School",
    kind: "travel",
    starts_at: "2026-10-19T15:40:00.000Z",
    ends_at: null,
    timezone: "America/New_York",
    all_day: false,
    online: false,
    venue: "Marietta High School",
    address: "1171 Whitlock Ave NW",
    city: "Marietta",
    state: "GA",
    zip: "30064",
    lat: 33.95,
    lng: -84.6,
    availability: null,
    book_url: `https://${UF}/register/?id=11111111-1111-1111-1111-111111111111`,
    source_url: `https://${UF}/register/?cmd=search&country=US`,
    description: null,
    date_confirmed: true,
    pageRead: true,
    ...over,
  };
}

/** Applies a diff to a store, as the writer would. */
function apply(stored: StoredEvent[], diff: ReturnType<typeof diffEvents>): StoredEvent[] {
  const by = new Map(stored.map((s) => [s.id, s]));
  for (const r of [...diff.upserts, ...diff.missed]) by.set(r.id, r);
  return [...by.values()];
}

test("diffEvents: a new row gets first_seen, last_seen, and changed_at now; a second identical read changes nothing", () => {
  const first = diffEvents([], [readEvent()], NOW);
  assert.deepEqual(first.counts, { new: 1, changed: 0, removed: 0, seen: 0 });
  assert.equal(first.upserts[0].first_seen, NOW);
  assert.equal(first.upserts[0].changed_at, NOW);
  assert.equal(first.upserts[0].misses, 0);
  const stored = apply([], first);
  const second = diffEvents(stored, [readEvent()], LATER);
  assert.deepEqual(second.counts, { new: 0, changed: 0, removed: 0, seen: 1 });
  assert.equal(second.upserts[0].first_seen, NOW);
  assert.equal(second.upserts[0].changed_at, NOW);
  assert.equal(second.upserts[0].last_seen, LATER);
  assert.equal(second.missed.length, 0);
});

test("diffEvents: changed_at moves on title, start, venue, or availability, not on the description", () => {
  const stored = apply([], diffEvents([], [readEvent()], NOW));
  for (const change of [{ title: "Marietta HS" }, { starts_at: "2026-10-19T16:40:00.000Z" }, { venue: "Gym" }, { availability: "full" as const }]) {
    const d = diffEvents(stored, [readEvent(change)], LATER);
    assert.equal(d.counts.changed, 1, JSON.stringify(change));
    assert.equal(d.upserts[0].changed_at, LATER);
  }
  const quiet = diffEvents(stored, [readEvent({ description: "New words" })], LATER);
  assert.equal(quiet.upserts[0].moved_at, null);
  assert.equal(quiet.counts.changed, 0);
  assert.equal(quiet.upserts[0].changed_at, NOW);
});

test("diffEvents: moved_at moves on a new start, venue, address, or city; not on a title or availability change, nor a first confirmation", () => {
  const stored = apply([], diffEvents([], [readEvent()], NOW));
  assert.equal(stored[0].moved_at, null);
  for (const move of [{ starts_at: "2026-10-20T15:40:00.000Z" }, { venue: "Gym" }, { address: "1 Main St" }, { city: "Kennesaw" }]) {
    const d = diffEvents(stored, [readEvent(move)], LATER);
    assert.equal(d.upserts[0].moved_at, LATER, JSON.stringify(move));
    assert.equal(d.upserts[0].changed_at, LATER);
  }
  for (const change of [{ title: "Marietta HS" }, { availability: "full" as const }]) {
    const d = diffEvents(stored, [readEvent(change)], LATER);
    assert.equal(d.upserts[0].changed_at, LATER);
    assert.equal(d.upserts[0].moved_at, null, JSON.stringify(change));
  }
  // An earlier move is kept when nothing moves tonight.
  const moved = apply(stored, diffEvents(stored, [readEvent({ venue: "Gym" })], LATER));
  assert.equal(diffEvents(moved, [readEvent({ venue: "Gym" })], LATEST).upserts[0].moved_at, LATER);
  // A search row's guessed start corrected by its first page read is not a move.
  const guessed = apply([], diffEvents([], [readEvent({ date_confirmed: false, pageRead: false, starts_at: "2026-10-19T16:40:00.000Z" })], NOW));
  assert.equal(diffEvents(guessed, [readEvent()], LATER).upserts[0].moved_at, null);
});

test("diffEvents: a known row read from the listing alone keeps the page's fields, and its confirmation", () => {
  const stored = apply([], diffEvents([], [readEvent()], NOW));
  const listingOnly = readEvent({ pageRead: false, date_confirmed: false, venue: null, zip: null, lat: null, lng: null, timezone: null, starts_at: "2026-10-19T15:40:00.000Z" });
  const d = diffEvents(stored, [listingOnly], LATER);
  assert.equal(d.counts.changed, 0);
  assert.equal(d.upserts[0].venue, "Marietta High School");
  assert.equal(d.upserts[0].zip, "30064");
  assert.equal(d.upserts[0].date_confirmed, true);
  assert.equal(d.upserts[0].timezone, "America/New_York");
  // The page's "closed" outranks the widget's "full" on a night the page isn't read; the widget's "open" reopens it.
  const closed = apply([], diffEvents([], [readEvent({ availability: "closed" })], NOW));
  const full = diffEvents(closed, [{ ...listingOnly, availability: "full" }], LATER);
  assert.equal(full.upserts[0].availability, "closed");
  assert.equal(full.counts.changed, 0);
  assert.equal(diffEvents(closed, [{ ...listingOnly, availability: "open" }], LATER).upserts[0].availability, "open");
  // A row stored without coordinates (its page failed on the first read) takes the listing's campus coordinates on a
  // later night; a row that has the page's coordinates keeps them.
  const unplaced = apply([], diffEvents([], [readEvent({ pageRead: false, date_confirmed: false, lat: null, lng: null, zip: null })], NOW));
  const campus = diffEvents(unplaced, [{ ...listingOnly, lat: 29.64629, lng: -82.347911 }], LATER).upserts[0];
  assert.equal(campus.lat, 29.64629);
  assert.equal(campus.lng, -82.347911);
  const placed = diffEvents(stored, [{ ...listingOnly, lat: 29.64629, lng: -82.347911 }], LATER).upserts[0];
  assert.equal(placed.lat, stored[0].lat, "the page's coordinates are kept");
});

test("diffEvents: removed only after two missed reads; a row seen again comes back; past rows and skipped rows are never missed", () => {
  assert.equal(MISSES_TO_REMOVE, 2);
  let stored = apply([], diffEvents([], [readEvent()], NOW));
  const miss1 = diffEvents(stored, [], LATER);
  assert.equal(miss1.missed[0].misses, 1);
  assert.equal(miss1.missed[0].removed_at, null);
  assert.equal(miss1.counts.removed, 0);
  stored = apply(stored, miss1);
  const miss2 = diffEvents(stored, [], LATEST);
  assert.equal(miss2.missed[0].misses, 2);
  assert.equal(miss2.missed[0].removed_at, LATEST);
  assert.equal(miss2.counts.removed, 1);
  stored = apply(stored, miss2);
  // Already removed: not counted again.
  assert.equal(diffEvents(stored, [], "2026-10-16T08:00:00.000Z").missed.length, 0);
  // Seen again: live, misses reset.
  const back = diffEvents(stored, [readEvent()], "2026-10-16T08:00:00.000Z");
  assert.equal(back.upserts[0].removed_at, null);
  assert.equal(back.upserts[0].misses, 0);
  // A row whose start has passed dropped out because it happened.
  const past = apply([], diffEvents([], [readEvent({ starts_at: "2026-10-12T15:00:00.000Z" })], "2026-10-11T08:00:00.000Z"));
  assert.equal(diffEvents(past, [], NOW).missed.length, 0);
  // Online rows when a widget didn't answer.
  const online = apply([], diffEvents([], [readEvent({ online: true })], NOW));
  assert.equal(diffEvents(online, [], LATER, (s) => s.online).missed.length, 0);
});

test("needsPage: new, unconfirmed, retitled, or moved rows; not a confirmed row that matches", () => {
  const stored = apply([], diffEvents([], [readEvent()], NOW))[0];
  const listing = { title: "Marietta High School", localIso: "2026-10-19T11:40:00", timed: true, inSearch: true };
  assert.equal(needsPage(undefined, listing), true);
  assert.equal(needsPage({ ...stored, date_confirmed: false }, listing), true);
  assert.equal(needsPage(stored, listing), false);
  assert.equal(needsPage(stored, { ...listing, title: "Marietta HS" }), true);
  assert.equal(needsPage(stored, { ...listing, localIso: "2026-10-19T12:40:00" }), true);
  // A widget's button text is not compared.
  assert.equal(needsPage(stored, { ...listing, title: "Sign Up", inSearch: false }), false);
});

/* ------------------------------------------------------------------ */
/* A whole host, over a fake fetch                                     */
/* ------------------------------------------------------------------ */

const TOUR_SERVICE = "/portal/widget/event?portal_id=cf68cc9c-d780-45ff-8715-dc5734c85f95&part=0025b0c3-7ebf-4467-80b6-bf9d8df7c1bf";
const ONLINE_SERVICE = "/portal/widget/event?portal_id=cd8fe571-0b26-4785-b2a9-f48ec9ad4e8c&part=5b83d1e8-11c8-40a1-a2c3-0cdcbdf8b701";

function ufSite() {
  return fakeHttp({
    [`https://${UF}/register/?cmd=search&country=US`]: read("uf-standard-search-us.html"),
    [widgetListUrl(UF, ONLINE_SERVICE)]: read("uf-widget-virtual-sessions-event_list.html"),
    // Page 2 repeats page 1: paging stops.
    [widgetListUrl(UF, ONLINE_SERVICE, 2)]: read("uf-widget-virtual-sessions-event_list.html"),
    [widgetListUrl(UF, TOUR_SERVICE)]: read("uf-widget-campus-tour-event_list-2026-10-21.html"),
    [`https://${UF}/register/?id=8b849d04-6aba-4437-b90f-eb24b53f6cf0`]: read("uf-event-page-info-session.html"),
  });
}

const UF_HOST: SlateHostRow = {
  unit_id: "134130",
  host: UF,
  vendor: "slate",
  config: {},
  found_on: "https://www.admissions.ufl.edu/visit-and-events",
  portal_parts: [
    { page: "/portal/uf-campus-tour", service: TOUR_SERVICE },
    { page: "/portal/Virtual-Information-Session_vNew", service: ONLINE_SERVICE },
  ],
  status: "active",
  failures: 0,
  first_seen: NOW,
  last_read: null,
  last_error: null,
  last_attempt: null,
  search_total: null,
  zero_since: null,
};

test("pagePolicy: hidden kinds, online, and on-campus rows come from the listing alone; away rows of shown kinds get their page", () => {
  const c = (title: string, place: string, online = false) => ({ title, place, online });
  assert.equal(pagePolicy(c("Requested Group / Filled", "Durham, NC"), "durham"), "listing", "staff: stored, never detailed");
  assert.equal(pagePolicy(c("Admissions Drop-In", "Chapel Hill, NC"), "chapel hill"), "listing", "other: stored, never detailed");
  assert.equal(pagePolicy(c("Meal on Campus in the Dining Hall", "Austin, TX"), "austin"), "listing", "an appointment slot gets no page");
  assert.equal(pagePolicy(c("Prospective Information Session", "", true), "gainesville"), "listing");
  assert.equal(pagePolicy(c("Campus Tour", "Gainesville, FL"), "gainesville"), "listing");
  assert.equal(pagePolicy(c("Campus Tour", "Welcome Center"), "gainesville"), "listing", "a widget row names a building, not a city");
  assert.equal(pagePolicy(c("Honors Information Session", "Gainesville, FL"), "gainesville"), "listing");
  assert.equal(pagePolicy(c("Becoming a Longhorn", "Dallas, TX"), "austin"), "page", "a session in another city needs its venue");
  assert.equal(pagePolicy(c("Marietta High School Probe Fair", "Marietta, GA"), "gainesville"), "page");
  assert.equal(pagePolicy(c("Discover Duke - Denver", "Englewood, CO"), "durham"), "page");
});

test("readHost: UF's search and widgets make 527 rows (4 staff stored, never detailed); only away rows read their page; campus rows take the campus coordinates", async () => {
  const http = ufSite();
  const r = await readHost(UF_HOST, {
    http,
    now: OCT_13,
    zips: loadZipTable(join(ROOT, "tests", "fixtures", "visit-events", "zcta-centroids.csv")),
    campusCity: "gainesville",
    campusState: "FL",
    campusLat: 29.64629,
    campusLng: -82.347911,
    stored: new Map(),
  });
  assert.equal(r.rows.length, 527);
  assert.equal(r.searchTotal, 519);
  assert.equal(new Set(r.rows.map((e) => e.id)).size, 527);
  // A staff row is kept from the listing (for later), unconfirmed, with no page requested.
  const staff = r.rows.find((e) => e.kind === "staff")!;
  assert.equal(staff.date_confirmed, false);
  assert.ok(!http.asked.some((u) => u.includes(staff.slate_id)), "no page for a staff row");
  // An online session from the widget: no page read; the listing's time in the campus state's zone, unconfirmed.
  const info = r.rows.find((e) => e.slate_id === "8b849d04-6aba-4437-b90f-eb24b53f6cf0")!;
  assert.equal(info.kind, "online");
  assert.equal(info.online, true);
  assert.equal(info.date_confirmed, false);
  assert.equal(info.starts_at, "2026-10-28T22:30:00.000Z");
  assert.equal(info.ends_at, null);
  assert.equal(info.availability, "open");
  assert.equal(info.lat, null);
  assert.ok(!http.asked.some((u) => u.includes("8b849d04-6aba-4437-b90f-eb24b53f6cf0")), "no page for an online row");
  // A travel row whose page didn't answer: the year rule's date in the state's zone, unconfirmed.
  const chadwick = r.rows.find((e) => e.title === "Chadwick School College Night")!;
  assert.equal(chadwick.date_confirmed, false);
  assert.equal(chadwick.starts_at, "2026-10-14T01:30:00.000Z");
  assert.equal(chadwick.kind, "travel");
  assert.equal(chadwick.state, "CA");
  assert.equal(chadwick.city, "Palos Verdes Peninsula");
  // A campus tour: no page, the campus's own coordinates, the widget's title never replaces the search's.
  const tour = r.rows.find((e) => e.slate_id === "4c7c83d8-5e9a-4660-ba5e-fa059d4f09d9")!;
  assert.notEqual(tour.title, "Sign Up For a Tour");
  assert.equal(tour.lat, 29.64629);
  assert.equal(tour.lng, -82.347911);
  assert.ok(!http.asked.some((u) => u.includes("4c7c83d8-5e9a-4660-ba5e-fa059d4f09d9")), "no page for a campus row");
  // Kinds as the research counted them (UF 2026-10-13: 340 travel, 132 tours, 40 sessions, 9 online, 3 open houses, 4
  // staff, from a search one row longer than the saved page).
  const kinds: Record<string, number> = {};
  for (const e of r.rows) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  assert.deepEqual(kinds, { travel: 339, tour: 132, info_session: 40, online: 9, open_house: 3, staff: 4 });
  assert.ok(r.errors.length > 0, "event pages the fake doesn't serve are recorded as errors");
  assert.ok(!http.asked.includes(widgetListUrl(UF, ONLINE_SERVICE, 3)), "paging stops when a page repeats");
});

test("runSync: twice over the same pages is idempotent; a search failure leaves rows alone and counts a failure", async () => {
  let rows: StoredEvent[] = [];
  const hostPatches: Partial<SlateHostRow>[] = [];
  const records: SyncRecord[] = [];
  const store: EventStore = {
    storedFor: async () => rows.map((r) => ({ ...r })),
    upsertEvents: async (up) => {
      const by = new Map(rows.map((r) => [r.id, r]));
      for (const r of up) by.set(r.id, { ...r });
      rows = [...by.values()];
    },
    updateHost: async (_u, patch) => void hostPatches.push(patch),
    recordSync: async (r) => void records.push(r),
  };
  const deps = { store, zips: loadZipTable(join(ROOT, "tests", "fixtures", "visit-events", "zcta-centroids.csv")), campus: () => ({ city: "Gainesville", state: "FL", lat: 29.64629, lng: -82.347911 }), maxPages: 3 };
  const first = await runSync([UF_HOST], { ...deps, http: ufSite(), now: OCT_13 });
  assert.equal(first.record.events_new, 527);
  assert.equal(rows.length, 527);
  const second = await runSync([UF_HOST], { ...deps, http: ufSite(), now: new Date("2026-10-14T16:00:00Z") });
  assert.equal(second.record.events_new, 0);
  assert.equal(second.record.events_changed, 0);
  assert.equal(second.record.events_removed, 0);
  assert.equal(rows.length, 527);
  assert.equal(records.length, 2);
  assert.deepEqual(hostPatches.at(-1), {
    last_attempt: "2026-10-14T16:00:00.000Z",
    last_read: "2026-10-14T16:00:00.000Z",
    failures: 0,
    last_error: null,
    search_total: 519,
    zero_since: null,
    status: "active",
  });
  // The search fails: nothing is missed, the host's failure count rises.
  const before = JSON.stringify(rows);
  const down = await runSync([{ ...UF_HOST, failures: 2 }], { ...deps, http: fakeHttp({}), now: new Date("2026-10-15T16:00:00Z") });
  assert.equal(down.record.hosts_read, 0);
  assert.equal(down.record.errors.length, 1);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(hostPatches.at(-1)?.failures, 3);
  assert.equal(hostPatches.at(-1)?.status, "unreachable");
});

/* ------------------------------------------------------------------ */
/* Guards: a collapsed search, the run-level guard ("Keeping it running") */
/* ------------------------------------------------------------------ */

const UF_SEARCH_URL = `https://${UF}/register/?cmd=search&country=US`;
/** UF's saved search with every row taken out: the page still says "returned 519 event(s)". */
const ufCollapsed = () => read("uf-standard-search-us.html").replace(/<li[^>]*>\s*<a href="[^"]*\?id=[\s\S]*?<\/li>/gi, "");

function memoryStore(initial: StoredEvent[] = []) {
  const state = { rows: initial, hostPatches: [] as { unitId: string; patch: Partial<SlateHostRow> }[], records: [] as SyncRecord[] };
  const store: EventStore = {
    storedFor: async (host) => state.rows.filter((r) => r.host === host).map((r) => ({ ...r })),
    upsertEvents: async (up) => {
      const by = new Map(state.rows.map((r) => [r.id, r]));
      for (const r of up) by.set(r.id, { ...r });
      state.rows = [...by.values()];
    },
    updateHost: async (unitId, patch) => void state.hostPatches.push({ unitId, patch }),
    recordSync: async (r) => void state.records.push(r),
  };
  return { state, store };
}

const campusDeps = { zips: loadZipTable(join(ROOT, "tests", "fixtures", "visit-events", "zcta-centroids.csv")), campus: () => ({ city: "Gainesville", state: "FL", lat: 29.64629, lng: -82.347911 }) };

test('readHost: a search that still says "returned 519 event(s)" but has no rows is a collapse; so is a page without the phrase; "returned 0" is not', async () => {
  const deps = { now: OCT_13, zips: campusDeps.zips, campusCity: "gainesville", campusState: "FL", campusLat: null, campusLng: null, stored: new Map() };
  const html = ufCollapsed();
  assert.match(html, /returned 519 event/);
  assert.equal(parseStandardSearch(html, UF).rows.length, 0);
  await assert.rejects(
    readHost(UF_HOST, { ...deps, http: fakeHttp({ [UF_SEARCH_URL]: html }) }),
    (err: Error) => err instanceof CollapsedSearchError && /returned 519 event\(s\) but none parsed/.test(err.message),
  );
  // The phrase gone (even with rows on the page): collapsed too.
  const noPhrase = read("uf-standard-search-us.html").replace(/returned\s+[\d,]+\s+event\(s\)/gi, "found these events");
  assert.match(noPhrase, /<h1>\s*Event Registration\s*<\/h1>/, "still headed as Slate's page");
  await assert.rejects(
    readHost(UF_HOST, { ...deps, http: fakeHttp({ [UF_SEARCH_URL]: noPhrase }) }),
    (err: Error) => err instanceof CollapsedSearchError && /no longer says/.test(err.message),
  );
  // A genuine empty search is an answer, not a collapse.
  const empty = html.replace(/returned 519 event/, "returned 0 event");
  const r = await readHost({ ...UF_HOST, portal_parts: [] }, { ...deps, http: fakeHttp({ [UF_SEARCH_URL]: empty }) });
  assert.equal(r.rows.length, 0);
  assert.equal(r.searchTotal, 0);
});

test("syncHost: a collapsed host counts a failure, names the collapse, keeps its status, and misses nothing", async () => {
  const live = stored(1, { id: `${UF}:a`, host: UF, starts_at: "2026-11-01T15:00:00.000Z", misses: 1 });
  const { state, store } = memoryStore([live]);
  const res = await syncHost({ ...UF_HOST, failures: 1 }, { ...campusDeps, store, http: fakeHttp({ [UF_SEARCH_URL]: ufCollapsed() }), now: OCT_13 });
  assert.equal(res.ok, false);
  assert.equal(res.collapsed, true);
  assert.equal(res.diff, undefined);
  assert.deepEqual(state.rows, [live], "the stored row is not missed (it had one miss; a second would remove it)");
  const patch = state.hostPatches.at(-1)!.patch;
  assert.equal(patch.failures, 2);
  assert.equal(patch.status, "active", "status unchanged below FAILURES_TO_UNREACHABLE");
  assert.match(patch.last_error ?? "", /collapsed/);
  // A plain failure is not a collapse.
  const down = await syncHost(UF_HOST, { ...campusDeps, store, http: fakeHttp({}), now: OCT_13 });
  assert.equal(down.ok, false);
  assert.equal(down.collapsed, false);
});

/** A small Slate host's search listing `ids` (each a travel row on Oct 19); `collapsed` drops the rows but keeps the count. */
function tinySearch(ids: string[], collapsed = false): string {
  const li = collapsed ? "" : ids.map((id) => `<li><a href="?id=${id}">Visit ${id.slice(-2)}</a><br />Monday, October 19 at 9:00 AM<br />Marietta, GA</li>`).join("");
  return `<html><h1>Event Registration</h1><p>Your search returned ${ids.length} event(s).</p><ul>${li}</ul></html>`;
}
const guid = (h: number, n: number) => `00000000-0000-0000-${String(h).padStart(4, "0")}-${String(n).padStart(12, "0")}`;

/** Ten hosts, the first `collapsedCount` collapsed; each stores a row seen again (1) and a row gone tonight (2, one miss already); 3 is new. */
function tenHosts(collapsedCount: number) {
  const hosts: SlateHostRow[] = [];
  const pages: Record<string, string> = {};
  const rows: StoredEvent[] = [];
  for (let h = 0; h < 10; h++) {
    const host = `h${h}.example.edu`;
    const unit = String(1000 + h);
    hosts.push({ ...UF_HOST, unit_id: unit, host, portal_parts: [] });
    pages[`https://${host}/register/?cmd=search&country=US`] = tinySearch([guid(h, 1), guid(h, 3)], h < collapsedCount);
    for (const n of [1, 2]) {
      rows.push(stored(h * 10 + n, { id: `${host}:${guid(h, n)}`, host, unit_id: unit, slate_id: guid(h, n), starts_at: "2026-10-19T13:00:00.000Z", misses: n === 2 ? 1 : 0, title: `Visit 0${n}` }));
    }
  }
  return { hosts, pages, rows };
}

test("runSync: 3 of 10 hosts collapsed withholds every miss (no removed rows) but still writes new rows; 2 of 10 does not", async () => {
  const { hosts, pages, rows } = tenHosts(3);
  const { state, store } = memoryStore(rows);
  const { record, results } = await runSync(hosts, { ...campusDeps, store, http: fakeHttp(pages), now: OCT_13, maxPages: 0 });
  assert.equal(record.hosts_collapsed, 3);
  assert.equal(record.hosts_failed, 0);
  assert.equal(record.hosts_read, 7);
  assert.equal(record.misses_withheld, true);
  assert.equal(record.events_removed, 0);
  assert.equal(record.events_new, 7, "each healthy host's new row");
  assert.deepEqual(state.records, [record]);
  assert.equal(results.filter((r) => r.collapsed).length, 3);
  assert.ok(state.rows.every((r) => r.removed_at == null), "nothing removed");
  assert.ok(state.rows.filter((r) => r.slate_id.endsWith("2")).every((r) => r.misses === 1), "no miss counted, on any host");
  assert.equal(state.rows.filter((r) => r.slate_id.endsWith("3")).length, 7, "new rows written");

  // 20% exactly is under the guard: the healthy hosts' gone rows are removed (their second miss); collapsed hosts' rows stay.
  const two = tenHosts(2);
  const m = memoryStore(two.rows);
  const run = await runSync(two.hosts, { ...campusDeps, store: m.store, http: fakeHttp(two.pages), now: OCT_13, maxPages: 0 });
  assert.equal(run.record.misses_withheld, false);
  assert.equal(run.record.hosts_collapsed, 2);
  assert.equal(run.record.events_removed, 8);
  assert.equal(m.state.rows.filter((r) => r.removed_at).length, 8);
  assert.ok(m.state.rows.filter((r) => r.host === "h0.example.edu" || r.host === "h1.example.edu").every((r) => !r.removed_at && r.misses === (r.slate_id.endsWith("2") ? 1 : 0)));
});

test("runSync: unreachable hosts retried tonight are counted apart and left out of the guard (2026-11-01: 640 of 830 one Sunday)", async () => {
  // Ten healthy hosts, plus six hosts already unreachable whose search still 404s: 6 of 16 failed, but 0 of the 10 the guard measures.
  const { hosts, pages, rows } = tenHosts(0);
  const down = Array.from({ length: 6 }, (_, i) => ({ ...UF_HOST, unit_id: String(2000 + i), host: `down${i}.example.edu`, portal_parts: [], status: "unreachable" as const, failures: 3 }));
  const { state, store } = memoryStore(rows);
  const { record } = await runSync([...hosts, ...down], { ...campusDeps, store, http: fakeHttp(pages), now: OCT_13, maxPages: 0 });
  assert.equal(record.hosts_read, 10);
  assert.equal(record.hosts_failed, 6);
  assert.equal(record.hosts_retried, 6);
  assert.equal(record.retries_failed, 6);
  assert.equal(record.misses_withheld, false, "the retries don't trip the guard");
  assert.equal(record.events_removed, 10, "the healthy hosts' gone rows are removed");
  assert.equal(state.rows.filter((r) => r.removed_at).length, 10);
  // A retried host that answers counts as read and not as a retry failure.
  const back = { ...UF_HOST, unit_id: "3000", host: "h0.example.edu", portal_parts: [], status: "unreachable" as const, failures: 3 };
  const again = await runSync([back, ...hosts.slice(1)], { ...campusDeps, store: memoryStore(rows).store, http: fakeHttp(pages), now: OCT_13, maxPages: 0 });
  assert.equal(again.record.hosts_retried, 1);
  assert.equal(again.record.retries_failed, 0);
  assert.equal(again.record.hosts_failed, 0);
  // Fresh failures still count: 3 of 10 healthy hosts collapsing withholds misses whatever the retries did.
  const bad = tenHosts(3);
  const b = memoryStore(bad.rows);
  const tripped = await runSync([...bad.hosts, ...down], { ...campusDeps, store: b.store, http: fakeHttp(bad.pages), now: OCT_13, maxPages: 0 });
  assert.equal(tripped.record.misses_withheld, true);
  assert.equal(tripped.record.hosts_collapsed, 3);
  assert.equal(tripped.record.retries_failed, 6);
});

test("withholdMisses: failed and collapsed both count, above 20% of the hosts tried", () => {
  assert.equal(withholdMisses(10, 2, 0), false);
  assert.equal(withholdMisses(10, 1, 1), false);
  assert.equal(withholdMisses(10, 2, 1), true);
  assert.equal(withholdMisses(10, 3, 0), true);
  assert.equal(withholdMisses(0, 0, 0), false);
});

/* ------------------------------------------------------------------ */
/* The check                                                           */
/* ------------------------------------------------------------------ */

function stored(i: number, over: Partial<StoredEvent> = {}): StoredEvent {
  const r = readEvent({ id: `h:${i}`, host: "h", slate_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, title: `Event ${i}`, ...over });
  const row: Partial<ReadEvent> = { ...r };
  delete row.pageRead;
  return { ...(row as Omit<ReadEvent, "pageRead">), first_seen: NOW, last_seen: NOW, changed_at: NOW, removed_at: null, misses: 0, moved_at: null, ...over };
}

test("checkHosts: a clean host passes", () => {
  const rows = Array.from({ length: 10 }, (_, i) => stored(i));
  const [c] = checkHosts(rows, OCT_13);
  assert.equal(c.events, 10);
  assert.equal(c.staffShare, 0);
  assert.equal(c.hiddenShare, 0);
  assert.equal(c.locatedShare, 1);
  assert.deepEqual(c.failures, []);
  assert.match(hostReport(c)[0], /^h \(134130\): 10 events \(travel 10\); hidden 0% \(staff 0%\); ZIP of detailed (100%|n\/a); located 100%/);
});

test("checkHosts: fails above 40% logistics staff, naming the titles; 40% exactly passes", () => {
  const four = [...Array.from({ length: 6 }, (_, i) => stored(i)), ...Array.from({ length: 4 }, (_, i) => stored(10 + i, { kind: "staff", title: `Hotel Shipping ${i}` }))];
  assert.deepEqual(checkHosts(four, OCT_13)[0].failures, []);
  const five = [...Array.from({ length: 5 }, (_, i) => stored(i)), ...Array.from({ length: 5 }, (_, i) => stored(10 + i, { kind: "staff", title: `Hotel Shipping ${i}` }))];
  const [c] = checkHosts(five, OCT_13);
  assert.equal(c.staffShare, 0.5);
  assert.equal(c.logisticsShare, 0.5);
  assert.equal(c.failures.length, 1);
  assert.match(c.failures[0], /logistics share 50% is above 40%; staff titles: Hotel Shipping 0/);
  assert.deepEqual(c.warnings, []);
});

test("checkHosts: a host that is mostly graduate or non-admissions events warns instead of failing (2026-11-01: Clarkson's graduate Slate)", () => {
  const grad = [
    ...Array.from({ length: 3 }, (_, i) => stored(i)),
    ...Array.from({ length: 6 }, (_, i) => stored(10 + i, { kind: "staff", title: `Graduate Programs Information Session ${i}` })),
    stored(20, { kind: "staff", title: "Hotel Shipping" }),
  ];
  const [c] = checkHosts(grad, OCT_13);
  assert.equal(c.staffShare, 0.7);
  assert.equal(c.logisticsShare, 0.1);
  assert.deepEqual(c.failures, []);
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /staff share 70% is above 40%, mostly graduate or other non-admissions events \(hidden on purpose\): Graduate Programs Information Session 0/);
  assert.doesNotMatch(c.warnings[0], /Hotel Shipping/);
  assert.match(hostReport(c).join("\n"), /WARN: staff share 70%/);
  // Both kinds together: the failure rule still measures only the logistics part.
  const mixed = [...Array.from({ length: 5 }, (_, i) => stored(i)), ...Array.from({ length: 3 }, (_, i) => stored(10 + i, { kind: "staff", title: `Graduate Admissions Phone Appointment ${i}` })), ...Array.from({ length: 2 }, (_, i) => stored(20 + i, { kind: "staff", title: `Materials Pick-Up ${i}` }))];
  const [m] = checkHosts(mixed, OCT_13);
  assert.equal(m.logisticsShare, 0.2);
  assert.deepEqual(m.failures, []);
  assert.equal(m.warnings.length, 1);
});

test("checkHosts: fails below 80% located among placed rows (online and hidden rows don't count); lists duplicates, far-out and late-seen rows", () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => stored(i)),
    ...Array.from({ length: 3 }, (_, i) => stored(10 + i, { lat: null, lng: null, zip: null, title: `No place ${i}` })),
    ...Array.from({ length: 5 }, (_, i) => stored(20 + i, { lat: null, lng: null, zip: null, online: true, kind: "online" })),
    ...Array.from({ length: 4 }, (_, i) => stored(30 + i, { lat: null, lng: null, zip: null, kind: "other", title: `Counselor Meeting ${i}` })),
  ];
  const [c] = checkHosts(rows, OCT_13);
  assert.equal(c.locatedShare, 0.7);
  assert.equal(c.hiddenShare, 4 / 19);
  // A host whose event pages didn't answer is a warning (the nightly job shouldn't fail on it), never a failure.
  assert.deepEqual(c.failures, []);
  assert.match(c.warnings.join(" "), /located share 70% is below 80%; rows with no coordinates: No place 0/);
  const eight = checkHosts([...Array.from({ length: 8 }, (_, i) => stored(i)), ...Array.from({ length: 2 }, (_, i) => stored(10 + i, { lat: null, lng: null, zip: null }))], OCT_13)[0];
  assert.deepEqual(eight.failures, []);
  const odd = checkHosts(
    [
      stored(1),
      stored(2, { title: "Event 1" }),
      stored(3, { starts_at: "2028-06-01T15:00:00.000Z" }),
      stored(4, { first_seen: "2026-10-25T00:00:00.000Z" }),
      stored(5, { removed_at: NOW, kind: "staff" }),
      stored(6, { starts_at: "2026-10-01T15:00:00.000Z", kind: "staff" }),
    ],
    OCT_13,
  )[0];
  assert.equal(odd.events, 4);
  assert.deepEqual(odd.duplicates, ["Event 1 (2026-10-19T15:40:00.000Z) ×2"]);
  assert.equal(odd.farOut.length, 1);
  assert.equal(odd.startsBeforeSeen.length, 1);
  assert.deepEqual(odd.failures, []);
});
