/**
 * Visit alerts, who gets one (lib/visit-events/alerts.ts; specs/product/visit-events.md "Alerting"): the radius edge,
 * online off by default, a mute, unsubscribed, no point, the first-night rule for prefs and for a new home, two events
 * in one email, the moved case, staff never, past never, a new host's backlog never, the per-college cap, and a
 * guardian with two students' high schools (the union of both radii). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAlerts, changeOf, VISIT_ALERT_PER_COLLEGE, type SelectAlertsInput } from "../lib/visit-events/alerts.ts";
import { readFileSync } from "node:fs";
import { milesBetween } from "../lib/home.ts";
import { ACCOUNT_EXPORTERS } from "../lib/account-export.ts";
import type { MeasuringPoint } from "../lib/visit-events/measure.ts";
import type { VisitEventRow } from "../lib/visit-events/types.ts";

const NOW = new Date("2026-10-14T13:00:00Z");
const SINCE = new Date(NOW.getTime() - 24 * 3_600_000);
const TWO_DAYS_AGO = "2026-10-12T13:00:00Z";
const AN_HOUR_AGO = "2026-10-14T12:00:00Z";
const LAST_WEEK = "2026-10-07T13:00:00Z";

const HOME: MeasuringPoint = { lat: 33.95, lng: -84.55, source: "home", label: "home in Marietta, GA" };
const USER = "00000000-0000-0000-0000-00000000000a";
const TOKEN = "a".repeat(64);
const UF = "134130";
const DUKE = "198419";

/** A point `miles` due north of HOME (one degree of latitude is EARTH_RADIUS·π/180 miles). */
function northOf(miles: number): { lat: number; lng: number } {
  return { lat: HOME.lat + miles / ((3958.8 * Math.PI) / 180), lng: HOME.lng };
}

let seq = 0;
function ev(over: Partial<VisitEventRow> = {}): VisitEventRow {
  seq++;
  const at = northOf(5);
  return {
    id: `host:${seq}`,
    unit_id: UF,
    host: "undergrad.admissions.ufl.edu",
    slate_id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    title: "Marietta High School Visit",
    kind: "travel",
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
    lat: at.lat,
    lng: at.lng,
    availability: "open",
    book_url: "https://undergrad.admissions.ufl.edu/register/?id=x",
    source_url: "https://undergrad.admissions.ufl.edu/register/?cmd=search&country=US",
    description: null,
    date_confirmed: true,
    first_seen: AN_HOUR_AGO,
    last_seen: AN_HOUR_AGO,
    changed_at: AN_HOUR_AGO,
    moved_at: null,
    removed_at: null,
    ...over,
  };
}

function input(over: Partial<SelectAlertsInput> = {}): SelectAlertsInput {
  return {
    now: NOW,
    since: SINCE,
    events: [ev()],
    follows: [{ user_id: USER, unit_id: UF }],
    mutes: [],
    prefs: [{ user_id: USER, email_visit_alerts: true, radius_miles: 30, include_online: false, updated: TWO_DAYS_AGO }],
    points: new Map([[USER, [HOME]]]),
    homesSetAt: new Map([[USER, TWO_DAYS_AGO]]),
    unsubscribeTokens: new Map([[USER, TOKEN]]),
    ...over,
  };
}

test("one event within the radius: one plan with the token, radius, and point label", () => {
  const r = selectAlerts(input());
  assert.equal(r.candidates, 1);
  assert.equal(r.plans.length, 1);
  const plan = r.plans[0];
  assert.equal(plan.userId, USER);
  assert.equal(plan.unsubscribeToken, TOKEN);
  assert.equal(plan.radiusMiles, 30);
  assert.deepEqual(plan.pointLabels, ["home in Marietta, GA"]);
  assert.equal(plan.colleges.length, 1);
  assert.equal(plan.colleges[0].unitId, UF);
  assert.equal(plan.colleges[0].events[0].change, "new");
  assert.ok(Math.abs(plan.colleges[0].events[0].miles! - 5) < 0.01);
  assert.deepEqual(r.skipped, { unsubscribed: 0, noPoint: 0, firstNight: 0, nothingNear: 0 });
});

test("radius edge: 30.0 miles is in, 30.1 is out and counted as farther", () => {
  // 30.0 to one decimal (a hair under, since the trig rounds the other way at exactly 30).
  const at30 = northOf(29.9999);
  const at301 = northOf(30.1);
  assert.equal(milesBetween(HOME, at30).toFixed(1), "30.0");
  assert.ok(milesBetween(HOME, at30) <= 30);
  assert.ok(milesBetween(HOME, at301) > 30);
  const inside = ev({ ...at30, id: "in" });
  const outside = ev({ ...at301, id: "out" });
  const r = selectAlerts(input({ events: [inside, outside] }));
  assert.equal(r.plans.length, 1);
  assert.deepEqual(r.plans[0].colleges[0].events.map((e) => e.event.id), ["in"]);
  assert.equal(r.plans[0].colleges[0].farther, 1);

  const onlyOutside = selectAlerts(input({ events: [ev({ ...at301 })] }));
  assert.equal(onlyOutside.plans.length, 0);
  assert.equal(onlyOutside.skipped.nothingNear, 1);
});

test("online events are left out by default and in with include_online, never counted as farther", () => {
  const online = ev({ online: true, kind: "online", lat: null, lng: null, venue: null, city: null, state: null, title: "Virtual Info Session" });
  const off = selectAlerts(input({ events: [online] }));
  assert.equal(off.plans.length, 0);
  assert.equal(off.skipped.nothingNear, 1);

  const on = selectAlerts(input({ events: [online], prefs: [{ user_id: USER, email_visit_alerts: true, radius_miles: 30, include_online: true, updated: TWO_DAYS_AGO }] }));
  assert.equal(on.plans.length, 1);
  assert.equal(on.plans[0].colleges[0].events[0].miles, null);
  assert.equal(on.plans[0].colleges[0].farther, 0);
});

test("a muted college sends nothing; another followed college still does", () => {
  const muted = selectAlerts(input({ mutes: [{ user_id: USER, unit_id: UF }] }));
  assert.equal(muted.plans.length, 0);
  assert.equal(muted.skipped.nothingNear, 1);

  const r = selectAlerts(
    input({
      events: [ev(), ev({ unit_id: DUKE, id: "duke" })],
      follows: [{ user_id: USER, unit_id: UF }, { user_id: USER, unit_id: DUKE }],
      mutes: [{ user_id: USER, unit_id: UF }],
    }),
  );
  assert.deepEqual(r.plans[0].colleges.map((c) => c.unitId), [DUKE]);
});

test("unsubscribed (email_visit_alerts off) or no token: skipped as unsubscribed", () => {
  const off = selectAlerts(input({ prefs: [{ user_id: USER, email_visit_alerts: false, radius_miles: 30, include_online: false, updated: TWO_DAYS_AGO }] }));
  assert.equal(off.plans.length, 0);
  assert.equal(off.skipped.unsubscribed, 1);
  const noToken = selectAlerts(input({ unsubscribeTokens: new Map() }));
  assert.equal(noToken.plans.length, 0);
  assert.equal(noToken.skipped.unsubscribed, 1);
});

test("no measuring point: skipped as noPoint", () => {
  const r = selectAlerts(input({ points: new Map() }));
  assert.equal(r.plans.length, 0);
  assert.equal(r.skipped.noPoint, 1);
  const empty = selectAlerts(input({ points: new Map([[USER, []]]) }));
  assert.equal(empty.skipped.noPoint, 1);
});

test("first night: a prefs row written in the last 24 hours sends nothing", () => {
  const r = selectAlerts(input({ prefs: [{ user_id: USER, email_visit_alerts: true, radius_miles: 30, include_online: false, updated: AN_HOUR_AGO }] }));
  assert.equal(r.plans.length, 0);
  assert.equal(r.skipped.firstNight, 1);
  // prefsCreatedAt overrides `updated` when the caller has it.
  const created = selectAlerts(input({ prefsCreatedAt: new Map([[USER, AN_HOUR_AGO]]) }));
  assert.equal(created.skipped.firstNight, 1);
});

test("first night: a home set in the last 24 hours sends nothing, but only when the point is the home", () => {
  const r = selectAlerts(input({ homesSetAt: new Map([[USER, AN_HOUR_AGO]]) }));
  assert.equal(r.plans.length, 0);
  assert.equal(r.skipped.firstNight, 1);

  const school: MeasuringPoint = { ...HOME, source: "high_school", label: "Marietta High School" };
  const fromSchool = selectAlerts(input({ homesSetAt: new Map([[USER, AN_HOUR_AGO]]), points: new Map([[USER, [school]]]) }));
  assert.equal(fromSchool.plans.length, 1);
});

test("no prefs row behaves as the defaults (30 miles, email on, online off) with no first-night hold", () => {
  const r = selectAlerts(input({ prefs: [] }));
  assert.equal(r.plans.length, 1);
  assert.equal(r.plans[0].radiusMiles, 30);
});

test("two events at one college: one plan, nearest first", () => {
  const far = ev({ ...northOf(20), id: "far" });
  const near = ev({ ...northOf(3), id: "near" });
  const r = selectAlerts(input({ events: [far, near] }));
  assert.equal(r.plans.length, 1);
  assert.deepEqual(r.plans[0].colleges[0].events.map((e) => e.event.id), ["near", "far"]);
  assert.deepEqual(r.plans[0].eventIds.sort(), ["far", "near"]);
  assert.equal(r.plans[0].eventCount, 2);
});

test("two colleges: one plan, colleges ordered by their nearest event", () => {
  const r = selectAlerts(
    input({
      events: [ev({ ...northOf(12), id: "uf" }), ev({ ...northOf(2), id: "duke", unit_id: DUKE })],
      follows: [{ user_id: USER, unit_id: UF }, { user_id: USER, unit_id: DUKE }],
    }),
  );
  assert.equal(r.plans.length, 1);
  assert.deepEqual(r.plans[0].colleges.map((c) => c.unitId), [DUKE, UF]);
});

test("moved: moved_at in the window; an availability flip (changed_at only) and an old row are not candidates", () => {
  const moved = ev({ id: "moved", first_seen: LAST_WEEK, changed_at: AN_HOUR_AGO, moved_at: AN_HOUR_AGO });
  const flipped = ev({ id: "flipped", first_seen: LAST_WEEK, changed_at: AN_HOUR_AGO, moved_at: null, availability: "full" });
  const old = ev({ id: "old", first_seen: LAST_WEEK, changed_at: LAST_WEEK, moved_at: LAST_WEEK });
  const r = selectAlerts(input({ events: [moved, flipped, old] }));
  assert.deepEqual(r.plans[0].colleges[0].events.map((e) => [e.event.id, e.change]), [["moved", "moved"]]);
  assert.equal(changeOf(old, SINCE), null);
  assert.equal(changeOf(flipped, SINCE), null);
  assert.equal(changeOf({ first_seen: AN_HOUR_AGO, moved_at: null }, SINCE), "new");
  // A new row moved again the same night is still "new".
  assert.equal(changeOf({ first_seen: AN_HOUR_AGO, moved_at: "2026-10-14T12:30:00Z" }, SINCE), "new");
});

test("staff, removed, and past rows never alert", () => {
  const r = selectAlerts(
    input({
      events: [ev({ kind: "staff", title: "Requested Group / Filled" }), ev({ removed_at: AN_HOUR_AGO }), ev({ starts_at: "2026-10-14T12:00:00Z" })],
    }),
  );
  assert.equal(r.plans.length, 0);
  // Not candidates at all, so the user isn't even considered.
  assert.equal(r.candidates, 0);
});

test("a host first read inside the window: its backlog sends nothing; a host read before does", () => {
  const fresh = selectAlerts(input({ hostsFirstSeen: new Map([[UF, AN_HOUR_AGO]]) }));
  assert.equal(fresh.plans.length, 0);
  assert.equal(fresh.candidates, 0);
  const known = selectAlerts(input({ hostsFirstSeen: new Map([[UF, LAST_WEEK]]) }));
  assert.equal(known.plans.length, 1);
});

test("at most 10 events per college, `more` counts the rest, eventIds holds all", () => {
  const events = Array.from({ length: VISIT_ALERT_PER_COLLEGE + 3 }, (_, i) => ev({ ...northOf(i + 1), id: `e${i}` }));
  const r = selectAlerts(input({ events }));
  const c = r.plans[0].colleges[0];
  assert.equal(c.events.length, VISIT_ALERT_PER_COLLEGE);
  assert.equal(c.more, 3);
  assert.equal(c.events[0].event.id, "e0");
  assert.equal(r.plans[0].eventCount, VISIT_ALERT_PER_COLLEGE + 3);
});

test("a user who doesn't follow the college isn't considered", () => {
  const r = selectAlerts(input({ follows: [{ user_id: USER, unit_id: DUKE }] }));
  assert.equal(r.candidates, 0);
  assert.equal(r.plans.length, 0);
});

test("a guardian with two students' high schools: events near either school, distance from the nearer", () => {
  const schoolA: MeasuringPoint = { lat: 33.95, lng: -84.55, source: "high_school", label: "Marietta High School" };
  const schoolB: MeasuringPoint = { lat: 29.65, lng: -82.32, source: "high_school", label: "Gainesville High School" };
  const nearA = ev({ id: "a", lat: 33.96, lng: -84.55 });
  const nearB = ev({ id: "b", lat: 29.66, lng: -82.32, city: "Gainesville", state: "FL" });
  const neither = ev({ id: "x", lat: 31.5, lng: -83.5 });
  const r = selectAlerts(input({ events: [nearA, nearB, neither], points: new Map([[USER, [schoolA, schoolB]]]) }));
  assert.equal(r.plans.length, 1);
  const ids = r.plans[0].colleges[0].events.map((e) => e.event.id).sort();
  assert.deepEqual(ids, ["a", "b"]);
  assert.equal(r.plans[0].colleges[0].farther, 1);
  for (const e of r.plans[0].colleges[0].events) assert.ok(e.miles! < 1);
  assert.deepEqual(r.plans[0].pointLabels, ["Marietta High School", "Gainesville High School"]);
});

test("the account export reads the person's visit-alert prefs, mutes, and sent alerts, own rows only", async () => {
  const exporter = ACCOUNT_EXPORTERS.find((e) => e.key === "visit_alerts");
  assert.ok(exporter, "ACCOUNT_EXPORTERS must register a `visit_alerts` exporter");
  const reads: { table: string; eq: [string, unknown][] }[] = [];
  const data: Record<string, unknown[]> = {
    visit_alert_prefs: [{ email_visit_alerts: true, radius_miles: 30 }],
    visit_alert_mutes: [{ unit_id: UF, created: LAST_WEEK }],
    visit_alerts: [{ sent_at: AN_HOUR_AGO, event_ids: ["h:1"], college_count: 1 }],
  };
  const supabase = {
    from(table: string) {
      const read = { table, eq: [] as [string, unknown][] };
      reads.push(read);
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => {
          read.eq.push([col, v]);
          return chain;
        },
        order: () => chain,
        then: (resolve: (v: unknown) => void) => resolve({ data: data[table], error: null }),
      };
      return chain;
    },
  };
  const out = (await exporter!.run({ supabase: supabase as never, userId: USER, email: null, ownStudentId: null, studentIds: [] })) as Record<string, unknown>;
  assert.deepEqual(reads.map((r) => r.table).sort(), ["visit_alert_mutes", "visit_alert_prefs", "visit_alerts"]);
  for (const r of reads) assert.deepEqual(r.eq, [["user_id", USER]]);
  assert.deepEqual(out.prefs, data.visit_alert_prefs[0]);
  assert.deepEqual(out.muted, data.visit_alert_mutes);
  assert.deepEqual(out.sent, data.visit_alerts);
});

test("vercel.json runs the visit alert at 13:00 UTC", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(
    vercel.crons.find((c) => c.path === "/api/cron/visit-alerts"),
    { path: "/api/cron/visit-alerts", schedule: "0 13 * * *" },
  );
});
