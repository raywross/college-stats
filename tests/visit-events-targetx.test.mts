/**
 * The TargetX reader (scripts/lib/visit-events/readers/targetx.mts, discover-targetx.mts; specs/product/visit-events.md
 * "TargetX: the protocol") on responses saved 2026-10-15 from Belmont Abbey, Baptist Health Sciences, and Beacon College
 * (legacy; Beacon's answer is reference-compressed) and Mid-America Christian's ERx listing: the descriptor, the
 * reference resolver, both event parsers, the place rule, availability, the collapses, the two remoting calls over a
 * fake Salesforce (origin headers, page-scoped tokens), discovery, the `readSite` dispatch, and `PoliteHttp.post`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bySuffix,
  erxStart,
  orgSettings,
  parseErxListing,
  parseFutureEvents,
  parseRemotingDescriptor,
  readTargetxSite,
  remotingBody,
  resolveRefs,
  targetxRows,
  unescapeJsLiteral,
  type TargetxEvent,
  type TargetxHttp,
  type TargetxRowContext,
} from "../scripts/lib/visit-events/readers/targetx.mts";
import { candidateSite, classifyTargetxPage, discoverTargetxSite } from "../scripts/lib/visit-events/readers/discover-targetx.mts";
import { CollapsedSearchError, readSite, runSync, type EventStore, type ReadDeps, type StoredEvent, type SyncRecord } from "../scripts/lib/visit-events/sync.mts";
import { loadZipTable } from "../scripts/lib/visit-events/geo.mts";
import { PoliteHttp } from "../scripts/lib/college-reported/http.mts";
import type { SlateHostRow } from "../lib/visit-events/types.ts";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(import.meta.dirname, "fixtures", "visit-events", "targetx");
const read = (f: string) => readFileSync(join(FIX, f), "utf8");
const json = (f: string) => JSON.parse(read(f));
const ZIPS = loadZipTable(ROOT);

const BELMONT = "belmontabbey.my.salesforce-sites.com";
const BELMONT_ORIGIN = `https://${BELMONT}`;
const BELMONT_BOOK = "https://belmontabbey.my.salesforce-sites.com/events/targetx_eventsb__events#/esr";

const belmontCtx: TargetxRowContext = {
  host: BELMONT,
  unitId: "197984",
  sourceUrl: `${BELMONT_ORIGIN}/events`,
  zips: ZIPS,
  campusCity: "belmont",
  campusLat: 35.260651,
  campusLng: -81.041315,
};
const beaconCtx: TargetxRowContext = { ...belmontCtx, host: "beaconcollege2.my.salesforce-sites.com", unitId: "384254", campusCity: "leesburg", campusLat: 28.811281, campusLng: -81.87415 };
const macuCtx: TargetxRowContext = { ...belmontCtx, host: "macu-edu.my.salesforce-sites.com", unitId: "245953", campusCity: "oklahoma city", campusLat: 35.347785, campusLng: -97.578297 };

/* ------------------------------------------------------------------ */
/* The descriptor and the request                                      */
/* ------------------------------------------------------------------ */

test("parseRemotingDescriptor: Belmont Abbey's page gives the vid, service, controller, and the two methods' tokens", () => {
  const d = parseRemotingDescriptor(read("belmontabbey-events.html"));
  assert.ok(d);
  assert.equal(d.vid, "066A0000002AWIl");
  assert.equal(d.service, "events/apexremote");
  assert.equal(d.action, "TargetX_Eventsb.eventsRemote");
  assert.deepEqual(Object.keys(d.methods).sort(), ["getFutureEvents", "initialize"]);
  assert.equal(d.methods.initialize.ns, "TargetX_Eventsb");
  assert.equal(d.methods.initialize.ver, 62);
  assert.match(d.methods.getFutureEvents.csrf, /^VmpFPSxNakF5/);
  assert.match(d.methods.getFutureEvents.authorization, /^eyJ/);
  assert.notEqual(d.methods.initialize.csrf, d.methods.getFutureEvents.csrf);
  // The guard: no descriptor, or one without getFutureEvents, is no descriptor.
  assert.equal(parseRemotingDescriptor(read("belmontabbey-events.html").replace(/RemotingProviderImpl/g, "SomethingElse")), null);
  assert.equal(parseRemotingDescriptor(read("belmontabbey-events.html").replace(/"name":"getFutureEvents"/, '"name":"getFutureEventz"')), null);
  assert.equal(parseRemotingDescriptor("<html></html>"), null);
});

test("remotingBody: the page's own request shape, and no method but initialize and getFutureEvents", () => {
  const d = parseRemotingDescriptor(read("belmontabbey-events.html"))!;
  const body = remotingBody("getFutureEvents", [{}, true, "", []], d, 2);
  assert.deepEqual(body, {
    action: "TargetX_Eventsb.eventsRemote",
    method: "getFutureEvents",
    data: [{}, true, "", []],
    type: "rpc",
    tid: 2,
    ctx: { csrf: d.methods.getFutureEvents.csrf, vid: "066A0000002AWIl", ns: "TargetX_Eventsb", ver: 62, authorization: d.methods.getFutureEvents.authorization },
  });
  for (const m of ["register", "login", "upsertContact", "getMyEvents"]) {
    assert.throws(() => remotingBody(m as "initialize", [{}], d, 1), /never called/);
  }
});

/* ------------------------------------------------------------------ */
/* The resolver and the legacy events                                  */
/* ------------------------------------------------------------------ */

test("resolveRefs: Beacon's reference-compressed answer equals the saved resolved one; harmless on a plain answer", () => {
  const [env] = json("resp-beacon-events.json");
  assert.equal(env.ref, true);
  assert.deepEqual(resolveRefs(env.result), json("resp-beacon-events-resolved.json"));
  // Without the resolver the compressed result is not even an array: parseFutureEvents finds nothing.
  assert.equal(parseFutureEvents(env.result, { bookBase: "x" }).length, 0);
  const [plain] = json("resp-belmontabbey-getFutureEvents.json");
  assert.deepEqual(resolveRefs(plain.result), plain.result);
  // {r} points back at an {s,v} registered earlier.
  assert.deepEqual(resolveRefs({ a: { s: 1, v: { x: 1 } }, b: { r: 1 } }), { a: { x: 1 }, b: { x: 1 } });
});

test("parseFutureEvents: Belmont Abbey's 58 events, epoch ms to ISO, the IANA zone, the booking URL", () => {
  const [init] = json("resp-belmontabbey-initialize.json");
  const settings = orgSettings(init.result);
  assert.deepEqual(settings, { useLocationLookup: true, bookBase: BELMONT_BOOK, zone: "America/New_York" });
  const [env] = json("resp-belmontabbey-getFutureEvents.json");
  const events = parseFutureEvents(env.result, { bookBase: settings.bookBase! });
  assert.equal(events.length, 58);
  const fair = events[0];
  assert.equal(fair.id, "a0qPr00000P6hyMIAR");
  assert.equal(fair.title, "Charlotte-Mecklenburg Schools CACRAO");
  assert.equal(fair.startsAt, new Date(1792071000000).toISOString());
  assert.equal(fair.endsAt, new Date(1792081800000).toISOString());
  assert.equal(fair.timezone, "America/New_York");
  assert.equal(fair.type, "College Fair");
  assert.equal(fair.bookUrl, `${BELMONT_BOOK}?eid=a0qPr00000P6hyMIAR`);
  assert.equal(fair.availability, "open"); // "Unlimited"
  assert.equal(fair.city, null); // no location on any Belmont event
  const visit = events.find((e) => e.title === "On-Campus Visit")!;
  assert.equal(visit.availability, "open"); // 20 slots
  assert.match(visit.description ?? "", /guided campus visit/);
});

test("parseFutureEvents: Baptist Health's 9 and Beacon's 26, the location lookup read by suffix", () => {
  const [bap] = json("resp-baptist-events.json");
  const b = parseFutureEvents(bap.result, { bookBase: "https://baptisthealers.my.salesforce-sites.com/events/targetx_eventsb__events#/esr" });
  assert.equal(b.length, 9);
  assert.ok(b.every((e) => e.title === "Weekly Campus Visit" && e.type === "Info Session" && e.timezone === "America/Chicago"));
  const [bea] = json("resp-beacon-events.json");
  const events = parseFutureEvents(resolveRefs(bea.result), { bookBase: "https://beaconcollege2.my.salesforce-sites.com/events#/esr" });
  assert.equal(events.length, 26);
  const e = events[0];
  // TargetX_Base__City__c etc.: the namespace differs by org, so the suffix decides.
  assert.deepEqual([e.street, e.city, e.state, e.zip], ["105 E. Main Street", "Leesburg", "FL", "34748"]);
  assert.equal(e.bookUrl, "https://beaconcollege2.my.salesforce-sites.com/events#/esr?eid=a1IPI00000C7MwV2AV");
  assert.equal(events.filter((x) => x.title === "Open House").length, 1);
  // The suffix rule: another namespace reads the same; Location__c never matches Location_Lookup__c.
  assert.equal(bySuffix({ TargetX_SRMb__City__c: "Erie" }, "City__c"), "Erie");
  assert.equal(bySuffix({ TargetX_Eventsb__Location_Lookup__c: "a0K" }, "Location__c"), undefined);
  assert.equal(bySuffix({ TargetX_Base__NotCity__c: "x" }, "City__c"), undefined);
});

test("legacy availability: cancelled is closed, no slots and no waitlist full, a waitlist or slots open", () => {
  const base = { Id: "a0x000000000001AAA", Name: "Campus Tour", TargetX_Eventsb__Start_Date_Time__c: 1792071000000 };
  const av = (oe: object) => parseFutureEvents([{ oe: { ...base, ...oe } }], { bookBase: "b" })[0].availability;
  assert.equal(av({ TargetX_Eventsb__Cancelled__c: true, TargetX_Eventsb__Slots_Available__c: "5" }), "closed");
  assert.equal(av({ TargetX_Eventsb__Slots_Available__c: "0" }), "full");
  assert.equal(av({ TargetX_Eventsb__Slots_Available__c: "0", TargetX_Eventsb__Waiting_List__c: true }), "open");
  assert.equal(av({ TargetX_Eventsb__Slots_Available__c: "3" }), "open");
  assert.equal(av({ TargetX_Eventsb__Slots_Available__c: "Unlimited" }), "open");
  assert.equal(av({}), "open");
});

/* ------------------------------------------------------------------ */
/* ERx                                                                 */
/* ------------------------------------------------------------------ */

test("parseErxListing: MACU's 9 events, the zone from the parenthesised suffix, wall-clock start, online, availability", () => {
  const got = parseErxListing(read("macu-eventlisting.html"));
  assert.ok(got);
  assert.equal(got.events.length, 9);
  assert.deepEqual(got.errors, []);
  const e = got.events[0];
  assert.equal(e.id, "701QU000012nbXvYAI");
  assert.equal(e.title, "Evangel Experience");
  assert.equal(e.timezone, "America/Chicago");
  // "2027-02-24T17:00:00.000+0000" displayed as "05:00PM": 5 PM in Oklahoma, 23:00 UTC in February.
  assert.equal(e.startsAt, "2027-02-24T23:00:00.000Z");
  assert.equal(e.endsAt, null);
  assert.equal(e.venue, "Fozard Hall");
  assert.equal(e.online, false);
  assert.equal(e.availability, "open"); // 3 of 100
  assert.equal(e.bookUrl, "https://macu-edu.my.salesforce-sites.com/EventListing/apex/ERx_Forms__PageMaker?pageId=MACUEventRegistrationCAS&eventId=701QU000012nbXvYAI");
  assert.match(e.description ?? "", /^Open to Juniors/);
  assert.ok(!/<p>/.test(e.description ?? ""));
  // An ACT sitting at 9:00 AM local, never 3 AM.
  const act = got.events.find((x) => x.title === "Residual ACT - November 6th, 2026")!;
  assert.equal(act.startsAt, "2026-11-06T19:00:00.000Z");
});

test("parseErxListing: one corrupted event is skipped and counted; online and full come from the record", () => {
  const html = read("macu-eventlisting.html");
  const broken = html.replace('\\"Name\\":\\"Black Youth Conference\\"', '\\"Name\\":\\"Black \\"Youth Conference\\"');
  assert.notEqual(broken, html);
  const got = parseErxListing(broken)!;
  assert.equal(got.events.length, 8);
  assert.equal(got.errors.length, 1);
  assert.match(got.errors[0], /skipped/);
  assert.ok(!got.events.some((e) => /Black/.test(e.title)));
  // Online flag and a full event (registrations at the cap).
  const flipped = html
    .replace('\\"ERx_Events__OnlineGuestEnabled__c\\":false', '\\"ERx_Events__OnlineGuestEnabled__c\\":true')
    .replace('\\"ERx_Events__Total_Event_Registrations__c\\":3', '\\"ERx_Events__Total_Event_Registrations__c\\":100');
  const f = parseErxListing(flipped)!.events[0];
  assert.equal(f.online, true);
  assert.equal(f.availability, "full");
  // No literal: null (the reader's collapse).
  assert.equal(parseErxListing(html.replace(/var a = '/g, "var b = '")), null);
});

test("unescapeJsLiteral and erxStart: one layer only, unknown escapes dropped; a start whose display disagrees is UTC", () => {
  assert.equal(unescapeJsLiteral(String.raw`{\"a\":\"it\'s \\\"x\\\"\"}`), String.raw`{"a":"it's \"x\""}`);
  assert.equal(unescapeJsLiteral(String.raw`\&#39;x\n`), String.raw`&#39;x\n`);
  assert.deepEqual(JSON.parse(unescapeJsLiteral(String.raw`{\"a\":\"line\nnext\"}`)), { a: "line\nnext" });
  assert.equal(erxStart({ ERx_Events__StartDateTime__c: "2027-02-24T17:00:00.000+0000", ERx_Events__Event_Time__c: "11:00AM - 1:00PM" }, "America/Chicago"), "2027-02-24T17:00:00.000Z");
  assert.equal(erxStart({ ERx_Events__StartDateTime__c: "2027-02-24T17:00:00.000+0000" }, "America/Chicago"), "2027-02-24T17:00:00.000Z");
});

/* ------------------------------------------------------------------ */
/* Rows and the place rule                                             */
/* ------------------------------------------------------------------ */

const ev = (over: Partial<TargetxEvent>): TargetxEvent => ({
  id: "a0X000000000001AAA",
  title: "Campus Tour",
  type: null,
  startsAt: "2026-11-01T14:00:00.000Z",
  endsAt: null,
  timezone: "America/New_York",
  description: null,
  venue: null,
  street: null,
  city: null,
  state: null,
  zip: null,
  online: null,
  availability: "open",
  bookUrl: "https://x/events#/esr?eid=a0X000000000001AAA",
  ...over,
});

test("targetxRows: the place rule (ZIP to ZCTA, campus text to campus, away without a ZIP unlocated, online never)", () => {
  const [bea] = json("resp-beacon-events.json");
  const beacon = targetxRows(parseFutureEvents(resolveRefs(bea.result), { bookBase: "b" }), "legacy", beaconCtx);
  // Leesburg's ZIP 34748 places it at its ZCTA centre, not the IPEDS point.
  assert.deepEqual([beacon[0].lat, beacon[0].lng], [ZIPS.get("34748")!.lat, ZIPS.get("34748")!.lng]);
  assert.equal(beacon[0].id, "beaconcollege2.my.salesforce-sites.com:a1ipi00000c7mwv2av");
  assert.equal(beacon[0].slate_id, "a1ipi00000c7mwv2av");
  assert.equal(beacon[0].kind, "tour");
  assert.equal(beacon[0].date_confirmed, true);
  assert.equal(beacon[0].pageRead, true);
  const rows = targetxRows(
    [
      ev({ id: "A1", venue: "Fozard Hall" }), // venue text only: campus
      ev({ id: "A2", city: "Belmont", state: "NC" }), // the campus city: campus
      ev({ id: "A3", title: "Info Session", city: "Charlotte", state: "NC" }), // away, no ZIP: unlocated
      ev({ id: "A4", title: "Independence High School Visit", type: "High School Visit" }), // travel, no place: unlocated
      ev({ id: "A5", title: "Virtual Info Session", zip: "28012" }), // online: no place even with a ZIP
      ev({ id: "A6", title: "Info Session", city: "Charlotte", state: "NC", zip: "28012" }), // a ZIP places it
      ev({ id: "A7", title: "Info Session", online: true, venue: "Zoom" }), // ERx online flag
    ],
    "legacy",
    belmontCtx,
  );
  const at = (id: string) => rows.find((r) => r.slate_id === id.toLowerCase())!;
  assert.deepEqual([at("A1").lat, at("A1").lng], [35.260651, -81.041315]);
  assert.deepEqual([at("A2").lat, at("A2").lng], [35.260651, -81.041315]);
  assert.deepEqual([at("A3").lat, at("A3").lng], [null, null]);
  assert.equal(at("A3").kind, "info_session");
  assert.deepEqual([at("A4").lat, at("A4").lng, at("A4").kind], [null, null, "travel"]);
  assert.deepEqual([at("A5").lat, at("A5").online, at("A5").kind], [null, true, "online"]);
  assert.deepEqual([at("A6").lat, at("A6").lng], [ZIPS.get("28012")!.lat, ZIPS.get("28012")!.lng]);
  assert.deepEqual([at("A7").lat, at("A7").online, at("A7").kind], [null, true, "online"]);
  // ERx rows never carry an end.
  assert.equal(targetxRows([ev({ endsAt: "2026-11-01T16:00:00.000Z" })], "erx", macuCtx)[0].ends_at, null);
  assert.equal(targetxRows([ev({ endsAt: "2026-11-01T16:00:00.000Z" })], "legacy", macuCtx)[0].ends_at, "2026-11-01T16:00:00.000Z");
});

test("targetxRows: Belmont Abbey's kinds from title and type", () => {
  const [env] = json("resp-belmontabbey-getFutureEvents.json");
  const rows = targetxRows(parseFutureEvents(env.result, { bookBase: BELMONT_BOOK }), "legacy", belmontCtx);
  const kind = (t: string) => rows.find((r) => r.title === t)!.kind;
  assert.equal(kind("On-Campus Visit"), "tour"); // typed "Campus Tour"
  assert.equal(kind("Charlotte-Mecklenburg Schools CACRAO"), "travel"); // typed "College Fair"
  assert.equal(kind("Independence High School Visit"), "travel");
  // A campus tour with no location takes the campus point; a high-school visit with none stays unlocated.
  assert.equal(rows.find((r) => r.title === "On-Campus Visit")!.lat, 35.260651);
  assert.equal(rows.find((r) => r.title === "Independence High School Visit")!.lat, null);
});

/* ------------------------------------------------------------------ */
/* Reading a site over a fake Salesforce                               */
/* ------------------------------------------------------------------ */

interface Call {
  method: "GET" | "POST";
  url: string;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * A fake Salesforce org: each page load mints new tokens (the saved page with its csrf values rewritten to
 * PAGE<n>-…), and `apexremote` answers 402 without Referer and Origin, or when the tokens aren't the latest page's.
 */
function fakeOrg(opts: { page?: string; init?: unknown; events?: unknown } = {}) {
  const calls: Call[] = [];
  let loads = 0;
  let current = "";
  const page = opts.page ?? read("belmontabbey-events.html");
  const http: TargetxHttp = {
    async get(url) {
      calls.push({ method: "GET", url });
      loads++;
      current = `PAGE${loads}-`;
      return new Response(page.replace(/"csrf":"/g, `"csrf":"${current}`), { status: 200 });
    },
    async post(url, body, headers) {
      calls.push({ method: "POST", url, body, headers });
      const req = JSON.parse(body);
      const refused = (message: string) => new Response(JSON.stringify([{ statusCode: 402, type: "exception", tid: req.tid, method: req.method, message }]), { status: 200 });
      if (headers.Referer !== BELMONT_ORIGIN || headers.Origin !== BELMONT_ORIGIN) return refused("Unable to determine from which page the request originated");
      if (!String(req.ctx?.csrf ?? "").startsWith(current)) return refused("Invalid CSRF token");
      const answer = req.method === "initialize" ? (opts.init ?? json("resp-belmontabbey-initialize.json")) : (opts.events ?? json("resp-belmontabbey-getFutureEvents.json"));
      return new Response(JSON.stringify(answer), { status: 200 });
    },
  };
  return { http, calls };
}

const deps = (http: ReadDeps["http"]): ReadDeps => ({
  http,
  now: new Date("2026-10-15T12:00:00Z"),
  zips: ZIPS,
  campusCity: "belmont",
  campusState: "NC",
  campusLat: 35.260651,
  campusLng: -81.041315,
  stored: new Map(),
});
const BELMONT_ROW = { unit_id: "197984", host: BELMONT, config: { site: "events", flavour: "legacy" } };

test("readTargetxSite (legacy): GET the page, POST initialize then getFutureEvents with Referer and Origin and that page's tokens", async () => {
  const { http, calls } = fakeOrg();
  const got = await readTargetxSite(BELMONT_ROW, deps(http));
  assert.equal(got.rows.length, 58);
  assert.equal(got.searchTotal, 58);
  assert.equal(got.pagesRead, 0);
  assert.equal(got.fetched, 3);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    `GET ${BELMONT_ORIGIN}/events`,
    `POST ${BELMONT_ORIGIN}/events/apexremote`,
    `POST ${BELMONT_ORIGIN}/events/apexremote`,
  ]);
  const posts = calls.filter((c) => c.method === "POST").map((c) => ({ ...c, req: JSON.parse(c.body!) }));
  assert.deepEqual(posts.map((p) => p.req.method), ["initialize", "getFutureEvents"]);
  for (const p of posts) {
    assert.equal(p.headers!.Referer, BELMONT_ORIGIN);
    assert.equal(p.headers!.Origin, BELMONT_ORIGIN);
    assert.equal(p.headers!["Content-Type"], "application/json");
    assert.match(p.req.ctx.csrf, /^PAGE1-/);
  }
  // Belmont's org uses the location lookup: getFutureEvents carries it.
  assert.deepEqual(posts[1].req.data, [{}, true, "", []]);
  assert.equal(got.rows[0].book_url, `${BELMONT_BOOK}?eid=a0qPr00000P6hyMIAR`);
  // A second read fetches the page again and uses the new tokens (never cached).
  calls.length = 0;
  await readTargetxSite(BELMONT_ROW, deps(http));
  assert.ok(calls.filter((c) => c.method === "POST").every((c) => JSON.parse(c.body!).ctx.csrf.startsWith("PAGE2-")));
});

test("readTargetxSite: the guards fail when their rule is broken (headers, tokens) as a refusal, not a collapse", async () => {
  const { http } = fakeOrg();
  // Without the origin headers the fake answers 402, as Salesforce does: the reader's headers are what make it work.
  const noHeaders: TargetxHttp = { get: http.get, post: (u, b) => http.post(u, b, { "Content-Type": "application/json" }) };
  await assert.rejects(readTargetxSite(BELMONT_ROW, deps(noHeaders)), (err: Error) => !(err instanceof CollapsedSearchError) && /402.*originated/.test(err.message));
  // Tokens from an earlier page load are refused.
  const stale: TargetxHttp = {
    get: http.get,
    async post(u, b, h) {
      await http.get(`${BELMONT_ORIGIN}/events`); // another load mints new tokens
      return http.post(u, b, h);
    },
  };
  await assert.rejects(readTargetxSite(BELMONT_ROW, deps(stale)), /CSRF/);
});

test("readTargetxSite: collapses on a descriptor-less page, a result-less answer, and an ERx page with no literal", async () => {
  const noDesc = fakeOrg({ page: "<html><body>Down For Maintenance</body></html>" });
  await assert.rejects(readTargetxSite(BELMONT_ROW, deps(noDesc.http)), CollapsedSearchError);
  assert.equal(noDesc.calls.filter((c) => c.method === "POST").length, 0);
  const noResult = fakeOrg({ events: [{ statusCode: 200, type: "rpc", tid: 2, ref: false, method: "getFutureEvents", result: null }] });
  await assert.rejects(readTargetxSite(BELMONT_ROW, deps(noResult.http)), CollapsedSearchError);
  const objResult = fakeOrg({ events: [{ statusCode: 200, type: "rpc", tid: 2, ref: false, method: "getFutureEvents", result: { events: [] } }] });
  await assert.rejects(readTargetxSite(BELMONT_ROW, deps(objResult.http)), CollapsedSearchError);
  // An empty array is a real answer: no events, no collapse.
  const empty = fakeOrg({ events: [{ statusCode: 200, type: "rpc", tid: 2, ref: false, method: "getFutureEvents", result: [] }] });
  assert.equal((await readTargetxSite(BELMONT_ROW, deps(empty.http))).rows.length, 0);
  // A compressed answer is resolved.
  const beacon = fakeOrg({ init: json("resp-beacon-init.json"), events: json("resp-beacon-events.json") });
  assert.equal((await readTargetxSite(BELMONT_ROW, deps(beacon.http))).rows.length, 26);
  // ERx: one GET, collapse without the literal.
  const erxRow = { unit_id: "245953", host: "macu-edu.my.salesforce-sites.com", config: { site: "EventListing", flavour: "erx" } };
  const erxHttp = (page: string): TargetxHttp => ({ get: async () => new Response(page, { status: 200 }), post: async () => assert.fail("ERx never posts") });
  const erx = await readTargetxSite(erxRow, deps(erxHttp(read("macu-eventlisting.html"))));
  assert.equal(erx.rows.length, 9);
  assert.equal(erx.fetched, 1);
  await assert.rejects(readTargetxSite(erxRow, deps(erxHttp("<html>no listing</html>"))), CollapsedSearchError);
});

/* ------------------------------------------------------------------ */
/* Dispatch and the run                                                */
/* ------------------------------------------------------------------ */

test("readSite: targetx rows go to the TargetX reader, slate rows to readHost, Lightning and unknown vendors throw", async () => {
  const { http, calls } = fakeOrg();
  const tx = await readSite({ ...BELMONT_ROW, portal_parts: [], vendor: "targetx" }, deps(http));
  assert.equal(tx.rows.length, 58);
  assert.equal(calls[0].url, `${BELMONT_ORIGIN}/events`);
  await assert.rejects(readSite({ ...BELMONT_ROW, portal_parts: [], vendor: "targetx", config: { site: "EMEvents/s/campus-tour", flavour: "lightning" } }, deps(http)), /not readable/);
  // A Slate row asks for Slate's search page.
  const slateCalls: string[] = [];
  const slateHttp: TargetxHttp = { get: async (u) => (slateCalls.push(u), null), post: async () => null };
  await assert.rejects(readSite({ unit_id: "1", host: "apply.example.edu", portal_parts: [], vendor: "slate", config: {} }, deps(slateHttp)), /robots/);
  assert.match(slateCalls[0], /^https:\/\/apply\.example\.edu\/register\/\?cmd=search/);
  // No vendor is Slate.
  slateCalls.length = 0;
  await assert.rejects(readSite({ unit_id: "1", host: "apply.example.edu", portal_parts: [] }, deps(slateHttp)), /robots/);
  assert.equal(slateCalls.length, 1);
  // A vendor with no reader is an error, never a silent Slate read.
  await assert.rejects(readSite({ unit_id: "1", host: "x.example", portal_parts: [], vendor: "nope" as "slate", config: {} }, deps(slateHttp)), /no reader for vendor "nope"/);
  // A TargetX row without its config is refused before any request.
  await assert.rejects(readSite({ ...BELMONT_ROW, portal_parts: [], vendor: "targetx", config: {} }, deps(http)), /needs \{ site, flavour \}/);
});

test("runSync over a TargetX host: rows written, the host's bookkeeping moves, a collapse counts no misses", async () => {
  const written: StoredEvent[] = [];
  const patches: Partial<SlateHostRow>[] = [];
  const records: SyncRecord[] = [];
  const store: EventStore = {
    storedFor: async () => [],
    upsertEvents: async (rows) => void written.push(...rows),
    updateHost: async (_u, p) => void patches.push(p),
    recordSync: async (r) => void records.push(r),
  };
  const host: SlateHostRow = {
    unit_id: "197984",
    host: BELMONT,
    found_on: "https://belmontabbeycollege.edu/admissions/visit/",
    portal_parts: [],
    status: "active",
    failures: 0,
    first_seen: "2026-10-15T00:00:00Z",
    last_read: null,
    last_error: null,
    last_attempt: null,
    search_total: null,
    zero_since: null,
    vendor: "targetx",
    config: { site: "events", flavour: "legacy" },
  };
  const { http } = fakeOrg();
  const campus = () => ({ city: "Belmont", state: "NC", lat: 35.260651, lng: -81.041315 });
  const { results, record } = await runSync([host], { http, store, zips: ZIPS, now: new Date("2026-10-15T12:00:00Z"), campus });
  assert.equal(results[0].ok, true);
  assert.equal(written.length, 58);
  assert.equal(patches[0].search_total, 58);
  assert.equal(record.hosts_read, 1);
  const bad = fakeOrg({ page: "<html></html>" });
  const second = await runSync([host], { http: bad.http, store, zips: ZIPS, now: new Date("2026-10-15T12:00:00Z"), campus });
  assert.equal(second.results[0].collapsed, true);
  assert.equal(second.record.hosts_collapsed, 1);
});

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

function siteHttp(pages: Record<string, string>): { http: TargetxHttp; got: string[] } {
  const got: string[] = [];
  return {
    got,
    http: {
      async get(url) {
        got.push(url);
        const body = pages[url];
        return body == null ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
      },
      post: async () => assert.fail("discovery never posts"),
    },
  };
}

test("discoverTargetxSite: a legacy site confirmed by its descriptor, chat and forms skipped", async () => {
  const visit = "https://belmontabbeycollege.edu/admissions/visit/";
  const page = `<a href="https://artu.my.site.com/ESWMIAWADMChat123">chat</a>
    <a href="https://belmontabbey.my.salesforce-sites.com/Inquiry/TargetX_Base__InquiryForm#?formId=a0e">Request info</a>
    <a href="https://belmontabbey.my.salesforce-sites.com/Forms/apex/ERx_Forms__PageMaker?pageId=RFI">Form</a>
    <a href="https://belmontabbey.my.salesforce-sites.com/events#/calendar?type=Campus%20Tour">Visit</a>`;
  const { http, got } = siteHttp({ [visit]: page, [`${BELMONT_ORIGIN}/events`]: read("belmontabbey-events.html") });
  const d = await discoverTargetxSite("197984", visit, http);
  assert.deepEqual(d, { host: BELMONT, foundOn: visit, config: { site: "events", flavour: "legacy" } });
  assert.deepEqual(got, [visit, `${BELMONT_ORIGIN}/events`]);
});

test("discoverTargetxSite: an ERx listing keeps its query; a Lightning events site is returned off-flavour; portals are not", async () => {
  const visit = "https://www.uaa.alaska.edu/admissions/visit/";
  const erxUrl = "https://university-of-alaska.my.salesforce-sites.com/EventListing?eventfilter=UAA&visit=1";
  const page = `<a href="http://university-of-alaska.my.salesforce-sites.com/EventListing?eventfilter=UAA&amp;visit=1&amp;utm_source=web">Events</a>`;
  const erx = siteHttp({ [visit]: page, [erxUrl]: read("macu-eventlisting.html") });
  assert.deepEqual(await discoverTargetxSite("102553", visit, erx.http), {
    host: "university-of-alaska.my.salesforce-sites.com",
    foundOn: visit,
    config: { site: "EventListing?eventfilter=UAA&visit=1", flavour: "erx" },
  });
  const arcadia = "https://www.arcadia.edu/admissions/visit/";
  const lt = siteHttp({ [arcadia]: `<a href="https://arcadiau.my.site.com/EMEvents/s/campus-tour">Tour</a>` });
  assert.deepEqual(await discoverTargetxSite("211088", arcadia, lt.http), {
    host: "arcadiau.my.site.com",
    foundOn: arcadia,
    config: { site: "EMEvents/s/campus-tour", flavour: "lightning" },
  });
  assert.deepEqual(lt.got, [arcadia]); // a Lightning page is never fetched
  const ahu = "https://www.ahu.edu/visit-ahu";
  const portal = siteHttp({ [ahu]: `<a href="https://ahu-edu.my.site.com/applicantportal/s/">Apply</a>` });
  assert.equal(await discoverTargetxSite("133872", ahu, portal.http), null);
  // A Salesforce page that is neither flavour is rejected.
  const plain = siteHttp({ [ahu]: `<a href="https://x.my.salesforce-sites.com/events">x</a>`, "https://x.my.salesforce-sites.com/events": "<html>hello</html>" });
  assert.equal(await discoverTargetxSite("1", ahu, plain.http), null);
  assert.equal(classifyTargetxPage(read("belmontabbey-events.html")), "legacy");
  assert.equal(classifyTargetxPage(read("macu-eventlisting.html")), "erx");
  assert.equal(candidateSite(new URL("https://francis.my.salesforce-sites.com//events/targetx_eventsb__events"))!.segment, "events");
});

/* ------------------------------------------------------------------ */
/* PoliteHttp.post                                                     */
/* ------------------------------------------------------------------ */

test("PoliteHttp.post: robots.txt honored, the user agent kept, extra headers sent, paced with GETs", async () => {
  const seen: { url: string; init: RequestInit; at: number }[] = [];
  let clock = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({ url, init, at: clock });
    if (url.endsWith("/robots.txt")) return new Response(url.includes("blocked") ? "User-agent: *\nDisallow: /" : "User-agent: *\nDisallow: /private", { status: 200 });
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  const http = new PoliteHttp({ fetch: fetchFn, now: () => clock, sleep: async (ms) => void (clock += ms), minDelayMs: 1000, log: () => {} });
  const res = await http.post("https://a.example/events/apexremote", '{"x":1}', { Referer: "https://a.example", Origin: "https://a.example", "User-Agent": "spoof" });
  assert.equal(res?.status, 200);
  const call = seen.find((s) => s.url.endsWith("/apexremote"))!;
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.body, '{"x":1}');
  const h = call.init.headers as Record<string, string>;
  assert.equal(h.Origin, "https://a.example");
  assert.match(h["User-Agent"], /^QuadCollegeData/);
  assert.equal(await http.post("https://a.example/private/x", "{}", {}), null);
  assert.equal(await http.post("https://blocked.example/events/apexremote", "{}", {}), null);
  // A GET and a POST to one host are a second apart.
  await http.get("https://a.example/events");
  await http.post("https://a.example/events/apexremote", "{}", {});
  const times = seen.filter((s) => s.url.startsWith("https://a.example/events")).map((s) => s.at);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1000);
});
