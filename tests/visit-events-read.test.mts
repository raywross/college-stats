/**
 * The pure pieces of visit events' pages (specs/product/visit-events.md "Display"): grouping by day, the kind
 * chips, nearest-first ordering composed with measure.ts, the signed-out line's wording, and visit-alert prefs
 * validation rejecting an unlisted radius (lib/visit-events/store.ts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import type { VisitEventRow } from "../lib/visit-events/types.ts";
import { measuringPoint, type MeasuringPoint } from "../lib/visit-events/measure.ts";
import { dayKey, dayLabel, groupEventsByDay, localDateParts, matchesChip, nearYouEvents, onCampusEvents, readTimeLine, signedOutLine, timeLabel, VISIT_CHIPS } from "../lib/visit-events/view.ts";

const ROOT = join(import.meta.dirname, "..");

function row(partial: Partial<VisitEventRow> & Pick<VisitEventRow, "id" | "kind" | "starts_at">): VisitEventRow {
  return {
    unit_id: "134130",
    host: "undergrad.admissions.ufl.edu",
    slate_id: "00000000-0000-0000-0000-000000000000",
    title: "Campus Tour",
    ends_at: null,
    timezone: "America/New_York",
    all_day: false,
    online: false,
    venue: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    lat: null,
    lng: null,
    availability: null,
    book_url: "https://undergrad.admissions.ufl.edu/register/?id=x",
    source_url: "https://undergrad.admissions.ufl.edu/register/?cmd=search&country=US",
    description: null,
    date_confirmed: true,
    first_seen: "2026-10-13T07:00:00Z",
    last_seen: "2026-10-13T07:10:00Z",
    changed_at: "2026-10-13T07:00:00Z",
    removed_at: null,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Day grouping and formatting                                                                                      */
/* ------------------------------------------------------------------ */

test("dayKey and dayLabel use the event's own zone, not UTC: 11 pm Eastern is still the same evening", () => {
  const e = row({ id: "a", kind: "tour", starts_at: "2026-10-20T03:30:00Z", timezone: "America/New_York" }); // 11:30 pm Oct 19 Eastern
  assert.equal(dayKey(e), "2026-10-19");
  assert.equal(dayLabel(e), "Mon, Oct 19");
  assert.equal(timeLabel(e), "11:30 pm");
});

test("an all-day event's time label says so", () => {
  const e = row({ id: "a", kind: "tour", starts_at: "2026-10-19T04:00:00Z", all_day: true });
  assert.equal(timeLabel(e), "All day");
});

test("groupEventsByDay: one group per calendar day, oldest day first, events kept in arrival order within a day", () => {
  const events = [
    row({ id: "a", kind: "tour", starts_at: "2026-10-20T15:00:00Z" }), // Oct 20, 11am Eastern
    row({ id: "b", kind: "tour", starts_at: "2026-10-19T15:00:00Z" }), // Oct 19
    row({ id: "c", kind: "tour", starts_at: "2026-10-19T19:00:00Z" }), // Oct 19, later
  ];
  const groups = groupEventsByDay(events);
  assert.deepEqual(
    groups.map((g) => g.day),
    ["2026-10-19", "2026-10-20"],
  );
  assert.deepEqual(
    groups[0].events.map((e) => e.id),
    ["b", "c"],
  );
});

test("groupEventsByDay never needs a staff row filtered by the caller to already be gone (grouping itself doesn't drop kinds)", () => {
  // The filtering is the caller's job (VisitEventList, read.ts's callers); grouping alone just buckets by day.
  const events = [row({ id: "s", kind: "staff", starts_at: "2026-10-19T15:00:00Z" })];
  assert.equal(groupEventsByDay(events).length, 1);
});

test("localDateParts: the floating local date and 24-hour time an .ics file needs, in the event's own zone", () => {
  const e = row({ id: "a", kind: "tour", starts_at: "2026-10-19T15:40:00Z", timezone: "America/New_York" });
  assert.deepEqual(localDateParts(e), { date: "2026-10-19", time: "11:40" });
});

/* ------------------------------------------------------------------ */
/* Kind chips                                                                                                        */
/* ------------------------------------------------------------------ */

test("VISIT_CHIPS: the five chips in the spec's order", () => {
  assert.deepEqual(
    VISIT_CHIPS.map((c) => c.label),
    ["Campus tours", "Sessions", "Near you", "Online", "Everything"],
  );
});

test("matchesChip: Sessions covers info sessions, open houses, and other on-campus kinds; Everything matches everything", () => {
  assert.equal(matchesChip("tour", "tour"), true);
  assert.equal(matchesChip("travel", "tour"), false);
  assert.equal(matchesChip("info_session", "info_session"), true);
  assert.equal(matchesChip("open_house", "info_session"), true);
  assert.equal(matchesChip("other", "info_session"), true);
  assert.equal(matchesChip("tour", "info_session"), false);
  assert.equal(matchesChip("travel", "travel"), true);
  assert.equal(matchesChip("online", "online"), true);
  assert.equal(matchesChip("staff", "all"), true, "Everything matches every kind (callers drop staff rows separately)");
});

test("onCampusEvents: never travel or online, soonest first, and honors a limit", () => {
  const events = [
    row({ id: "travel-1", kind: "travel", starts_at: "2026-10-18T12:00:00Z" }),
    row({ id: "tour-2", kind: "tour", starts_at: "2026-10-20T12:00:00Z" }),
    row({ id: "tour-1", kind: "tour", starts_at: "2026-10-19T12:00:00Z" }),
    row({ id: "online-1", kind: "online", starts_at: "2026-10-17T12:00:00Z", online: true }),
  ];
  assert.deepEqual(
    onCampusEvents(events).map((e) => e.id),
    ["tour-1", "tour-2"],
  );
  assert.equal(onCampusEvents(events, 1).length, 1);
});

/* ------------------------------------------------------------------ */
/* Nearest-first, composed with measure.ts                                                                           */
/* ------------------------------------------------------------------ */

const MARIETTA: MeasuringPoint = { lat: 33.95, lng: -84.55, source: "home", label: "home in Marietta, GA" };

test("nearYouEvents: placed, non-online events only, nearest first; null point gives nothing", () => {
  const events = [
    row({ id: "far", kind: "travel", starts_at: "2026-10-19T12:00:00Z", lat: 40.0, lng: -74.0 }), // far (NJ-ish)
    row({ id: "near", kind: "travel", starts_at: "2026-10-20T12:00:00Z", lat: 33.95, lng: -84.56 }), // Marietta itself
    row({ id: "unplaced", kind: "tour", starts_at: "2026-10-18T12:00:00Z", lat: null, lng: null }),
    row({ id: "online", kind: "online", starts_at: "2026-10-18T12:00:00Z", online: true, lat: 33.95, lng: -84.56 }),
  ];
  const near = nearYouEvents(events, MARIETTA);
  assert.deepEqual(
    near.map((e) => e.id),
    ["near", "far"],
  );
  assert.equal(nearYouEvents(events, null).length, 0);
});

test("nearYouEvents honors a limit", () => {
  const events = [
    row({ id: "a", kind: "travel", starts_at: "2026-10-19T12:00:00Z", lat: 33.95, lng: -84.56 }),
    row({ id: "b", kind: "travel", starts_at: "2026-10-19T12:00:00Z", lat: 33.9, lng: -84.5 }),
  ];
  assert.equal(nearYouEvents(events, MARIETTA, 1).length, 1);
});

test("measuringPoint + nearYouEvents: home wins over the high school under auto, as the spec's radius rule says", () => {
  const home = { lat: 33.95, lng: -84.55, place: "Marietta, GA" };
  const highSchool = { lat: 25.76, lng: -80.19, name: "Miami Senior High", city: "Miami", state: "FL" };
  const point = measuringPoint("auto", home, highSchool);
  assert.equal(point?.label, "home in Marietta, GA");
  const point2 = measuringPoint("high_school", home, highSchool);
  assert.equal(point2?.label, "Miami Senior High");
  assert.equal(measuringPoint("auto", null, null), null);
});

/* ------------------------------------------------------------------ */
/* Read-time and signed-out lines                                                                                    */
/* ------------------------------------------------------------------ */

test("signedOutLine: singular and plural, names the college and invites sign-in", () => {
  assert.equal(signedOutLine("University of Florida", 528), "University of Florida lists 528 upcoming events. Sign in to see them.");
  assert.equal(signedOutLine("Duke University", 1), "Duke University lists 1 upcoming event. Sign in to see them.");
});

test("readTimeLine: null before any sync, else names the college and the local time", () => {
  assert.equal(readTimeLine("UF", null), null);
  assert.match(readTimeLine("UF", "2026-10-13T07:10:00Z") ?? "", /^Read from UF's calendar at \d{1,2}:\d{2} (a|p)m$/);
});

/* ------------------------------------------------------------------ */
/* Prefs validation (lib/visit-events/store.ts): rejects an unlisted radius                                          */
/* ------------------------------------------------------------------ */

// store.ts is a "use server" module that needs a request (createServerSupabase, getUser); stand-ins answer instead,
// the same technique tests/lists-save-owner.test.mts uses so the real validation and upsert logic still runs.
const upserts: unknown[] = [];
const AUTH = `
export const authConfigured = () => true;
export const getUser = async () => ({ id: "user-1", email: "a@example.com" });
`;
const SUPABASE = `
export async function createServerSupabase() {
  return {
    from(table) {
      return {
        upsert(row) {
          globalThis.__visitPrefsUpserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}
export function supabaseAuthEnv() { return null; }
`;
(globalThis as unknown as { __visitPrefsUpserts: unknown[] }).__visitPrefsUpserts = upserts;

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "@/lib/auth") return { url: `data:text/javascript,${encodeURIComponent(AUTH)}`, shortCircuit: true };
    if (specifier === "@/lib/supabase-server") return { url: `data:text/javascript,${encodeURIComponent(SUPABASE)}`, shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const { saveVisitPrefs } = await import("../lib/visit-events/store.ts");

test("saveVisitPrefs rejects a radius of 31 (not one of the listed options) and writes nothing", async () => {
  upserts.length = 0;
  const result = await saveVisitPrefs({ radius_miles: 31 });
  assert.deepEqual(result, { ok: false, message: "Pick one of the listed radii." });
  assert.equal(upserts.length, 0);
});

test("saveVisitPrefs rejects an unknown measure_from", async () => {
  upserts.length = 0;
  const result = await saveVisitPrefs({ measure_from: "work" });
  assert.deepEqual(result, { ok: false, message: "Pick a valid measuring point." });
  assert.equal(upserts.length, 0);
});

test("saveVisitPrefs accepts a listed radius and upserts it", async () => {
  upserts.length = 0;
  const result = await saveVisitPrefs({ radius_miles: 50 });
  assert.deepEqual(result, { ok: true });
  assert.equal(upserts.length, 1);
  assert.equal((upserts[0] as { row: { radius_miles: number } }).row.radius_miles, 50);
});
