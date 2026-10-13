/**
 * The visit alert email (lib/emails/visit-alert.ts; specs/product/visit-events.md "Alerting"): the subject names the
 * nearest event, the text body line by line (event lines in the event's own zone, Sign up and Add to calendar, "moved
 * to", "and N more", the farther-away count, the radius line, the per-college stop link, the one-click unsubscribe),
 * the HTML carrying the same links, and the List-Unsubscribe headers. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVisitAlert, eventWhen, milesText, type VisitAlertCollegeInfo } from "../lib/emails/visit-alert.ts";
import type { AlertEvent, AlertPlan } from "../lib/visit-events/alerts.ts";
import type { VisitEventRow } from "../lib/visit-events/types.ts";

const SITE = "https://quad.example";
const TOKEN = "b".repeat(64);
const COLLEGES = new Map<string, VisitAlertCollegeInfo>([
  ["134130", { name: "University of Florida", short: "UF" }],
  ["198419", { name: "Duke University", short: "Duke" }],
]);

function ev(over: Partial<VisitEventRow>): VisitEventRow {
  return {
    id: "h:1",
    unit_id: "134130",
    host: "undergrad.admissions.ufl.edu",
    slate_id: "00000000-0000-0000-0000-000000000001",
    title: "Marietta High School Visit",
    kind: "travel",
    // 11:40 am in Atlanta (EDT, UTC−4).
    starts_at: "2026-10-19T15:40:00Z",
    ends_at: null,
    timezone: "America/New_York",
    all_day: false,
    online: false,
    venue: "Marietta High School",
    address: null,
    city: "Marietta",
    state: "GA",
    zip: "30060",
    lat: 33.95,
    lng: -84.55,
    availability: "open",
    book_url: "https://undergrad.admissions.ufl.edu/register/?id=abc",
    source_url: "https://undergrad.admissions.ufl.edu/register/?cmd=search&country=US",
    description: null,
    date_confirmed: true,
    first_seen: "2026-10-14T06:00:00Z",
    last_seen: "2026-10-14T06:00:00Z",
    changed_at: "2026-10-14T06:00:00Z",
    moved_at: null,
    removed_at: null,
    ...over,
  };
}

function plan(colleges: AlertPlan["colleges"], over: Partial<AlertPlan> = {}): AlertPlan {
  const ids = colleges.flatMap((c) => c.events.map((e) => e.event.id));
  return {
    userId: "u",
    colleges,
    unsubscribeToken: TOKEN,
    radiusMiles: 30,
    pointLabels: ["home in Marietta, GA"],
    eventIds: ids,
    eventCount: ids.length + colleges.reduce((n, c) => n + c.more, 0),
    ...over,
  };
}

const a = (event: VisitEventRow, miles: number | null, change: AlertEvent["change"] = "new"): AlertEvent => ({ event, miles, change });

test("one college: the subject names the nearest visit; the text body line by line", () => {
  const near = ev({ id: "h:1" });
  const second = ev({
    id: "h:2",
    venue: "Decatur High School",
    city: "Decatur",
    title: "Decatur High School Visit",
    starts_at: "2026-10-20T13:00:00Z",
    lat: 33.77,
    lng: -84.3,
    book_url: "https://undergrad.admissions.ufl.edu/register/?id=def",
  });
  const moved = ev({ id: "h:3", venue: "Walton High School", city: "Marietta", starts_at: "2026-10-21T18:30:00Z", book_url: "https://undergrad.admissions.ufl.edu/register/?id=ghi" });
  const built = buildVisitAlert({
    plan: plan([{ unitId: "134130", events: [a(near, 0.4), a(second, 14.2), a(moved, 22.6, "moved")], more: 2, farther: 41 }]),
    colleges: COLLEGES,
    siteUrl: SITE,
  });
  assert.equal(built.subject, "UF is visiting Marietta High School on Oct 19, and 4 more near you");
  const uf = `${SITE}/me/visits?unit=134130&utm_source=visit-alert`;
  assert.deepEqual(built.text.split("\n"), [
    "New events near you at colleges on your list.",
    "",
    "University of Florida",
    `${SITE}/schools/134130?utm_source=visit-alert`,
    "- Mon 19 Oct · 11:40 am · Marietta High School, Marietta, GA · under 1 mile",
    "  Sign up: https://undergrad.admissions.ufl.edu/register/?id=abc",
    `  Add to calendar: ${uf}`,
    "- Tue 20 Oct · 9:00 am · Decatur High School, Decatur, GA · 14 miles",
    "  Sign up: https://undergrad.admissions.ufl.edu/register/?id=def",
    `  Add to calendar: ${uf}`,
    "- Moved to Wed 21 Oct · 2:30 pm · Walton High School, Marietta, GA · 23 miles",
    "  Sign up: https://undergrad.admissions.ufl.edu/register/?id=ghi",
    `  Add to calendar: ${uf}`,
    `and 2 more on your visits page: ${uf}`,
    "",
    "--",
    `UF also added 41 events farther away; see them: ${uf}`,
    `Within 30 miles of home in Marietta, GA · change: ${SITE}/me?utm_source=visit-alert#visit-alerts`,
    `Stop alerts for UF: ${SITE}/unsubscribe/${TOKEN}/visits/134130`,
    `You get this because visit alerts are on for your Quad account. Unsubscribe from visit alerts: ${SITE}/unsubscribe/${TOKEN}/visits`,
  ]);
  assert.deepEqual(built.headers, {
    "List-Unsubscribe": `<${SITE}/unsubscribe/${TOKEN}/visits>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  assert.equal(built.collegeCount, 1);
  assert.equal(built.eventCount, 5);
});

test("the HTML carries the same links and escapes text", () => {
  const built = buildVisitAlert({
    plan: plan([{ unitId: "134130", events: [a(ev({ venue: "St. Pius X <Catholic> High" }), 3)], more: 0, farther: 0 }]),
    colleges: COLLEGES,
    siteUrl: SITE,
  });
  assert.match(built.html, /St\. Pius X &lt;Catholic&gt; High/);
  assert.ok(built.html.includes(`href="${SITE}/unsubscribe/${TOKEN}/visits/134130"`));
  assert.ok(built.html.includes(`href="${SITE}/unsubscribe/${TOKEN}/visits"`));
  assert.ok(built.html.includes(`href="https://undergrad.admissions.ufl.edu/register/?id=abc"`));
  assert.ok(built.html.includes(">Sign up<"));
  assert.ok(built.html.includes(">Add to calendar<"));
  assert.ok(!built.html.includes("farther away"));
  assert.ok(!built.text.includes("farther away"));
  assert.ok(!built.text.includes("more on your visits page"));
});

test("two colleges: subject lists both and the visit count; a stop link per college", () => {
  const built = buildVisitAlert({
    plan: plan([
      { unitId: "134130", events: [a(ev({ id: "1" }), 2), a(ev({ id: "2" }), 9)], more: 0, farther: 0 },
      { unitId: "198419", events: [a(ev({ id: "3", unit_id: "198419" }), 12)], more: 0, farther: 3 },
    ]),
    colleges: COLLEGES,
    siteUrl: SITE,
  });
  assert.equal(built.subject, "UF and Duke: 3 new visits near you");
  const lines = built.text.split("\n");
  assert.ok(lines.includes(`Stop alerts for UF: ${SITE}/unsubscribe/${TOKEN}/visits/134130`));
  assert.ok(lines.includes(`Stop alerts for Duke: ${SITE}/unsubscribe/${TOKEN}/visits/198419`));
  assert.ok(lines.includes(`Duke also added 3 events farther away; see them: ${SITE}/me/visits?unit=198419&utm_source=visit-alert`));
  assert.ok(lines.includes("Duke University"));
});

test("a moved visit leads the subject with 'moved'; a non-visit event names its title; two schools' radius", () => {
  const moved = buildVisitAlert({ plan: plan([{ unitId: "134130", events: [a(ev({}), 4, "moved")], more: 0, farther: 0 }]), colleges: COLLEGES, siteUrl: SITE });
  assert.equal(moved.subject, "UF moved its visit to Marietta High School to Oct 19");

  const tour = ev({ kind: "tour", title: "Campus Tour", venue: "Visitor Center", city: "Gainesville", state: "FL" });
  const built = buildVisitAlert({
    plan: plan([{ unitId: "134130", events: [a(tour, 25)], more: 0, farther: 0 }], { pointLabels: ["Marietta High School", "Buchholz High School"] }),
    colleges: COLLEGES,
    siteUrl: SITE,
  });
  assert.equal(built.subject, "UF: Campus Tour on Oct 19");
  assert.ok(built.text.includes("- Mon 19 Oct · 11:40 am · Campus Tour at Visitor Center, Gainesville, FL · 25 miles"));
  assert.ok(built.text.includes("Within 30 miles of Marietta High School or Buchholz High School · change"));
});

test("event lines: all day, the event's own zone, online, full and closed", () => {
  assert.equal(eventWhen({ starts_at: "2026-10-19T04:00:00Z", timezone: "America/New_York", all_day: true }), "Mon 19 Oct · all day");
  // 6:30 pm Central is 23:30 UTC.
  assert.equal(eventWhen({ starts_at: "2026-10-28T23:30:00Z", timezone: "America/Chicago", all_day: false }), "Wed 28 Oct · 6:30 pm");
  assert.equal(milesText(1.2), "1 mile");
  assert.equal(milesText(249.6), "250 miles");

  const online = ev({ online: true, kind: "online", title: "Virtual Info Session", venue: null, city: null, state: null, lat: null, lng: null, starts_at: "2026-10-22T23:00:00Z" });
  const full = ev({ id: "f", availability: "full" });
  const closed = ev({ id: "c", availability: "closed" });
  const built = buildVisitAlert({ plan: plan([{ unitId: "134130", events: [a(full, 3), a(closed, 4), a(online, null)], more: 0, farther: 0 }]), colleges: COLLEGES, siteUrl: SITE });
  const lines = built.text.split("\n");
  assert.ok(lines.includes("- Mon 19 Oct · 11:40 am · Marietta High School, Marietta, GA · 3 miles · full"));
  assert.ok(lines.includes("- Mon 19 Oct · 11:40 am · Marietta High School, Marietta, GA · 4 miles · registration closed"));
  assert.ok(lines.includes("- Thu 22 Oct · 7:00 pm · Virtual Info Session · Online"));
});
