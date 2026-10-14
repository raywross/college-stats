/**
 * U4 (planner tie-in, specs/product/visit-events.md "Planner"; specs/planner/actions.md "Visits"): the pure pieces
 * behind `components/visits/NextEvents.tsx` — `components/visits/next-events-logic.ts`. The prefill mapping (every
 * `VisitEventKind` to a valid `VisitKind`, the date/time split in the event's own zone, a travel event becoming
 * `fair` with `registration_url` set) and the "next two" ordering rule. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { VisitEventRow } from "../lib/visit-events/types.ts";
import { VISIT_EVENT_KINDS } from "../lib/visit-events/types.ts";
import type { MeasuringPoint } from "../lib/visit-events/measure.ts";
import { nextTwoEvents, venueLine, visitFormPrefill } from "../components/visits/next-events-logic.ts";

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
    moved_at: null,
    removed_at: null,
    ...partial,
  };
}

const MARIETTA: MeasuringPoint = { lat: 33.9526, lng: -84.5499, source: "home", label: "home in Marietta, GA" };

/* ------------------------------------------------------------------ */
/* Prefill mapping                                                                                                    */
/* ------------------------------------------------------------------ */

test("visitFormPrefill: every VisitEventKind maps to a valid VisitKind", () => {
  const VALID = new Set(["campus_tour", "info_session", "open_house", "virtual", "interview", "fair", "overnight", "other"]);
  for (const kind of VISIT_EVENT_KINDS) {
    const e = row({ id: kind, kind, starts_at: "2026-10-19T13:00:00Z" });
    assert.ok(VALID.has(visitFormPrefill(e).kind), `${kind} should map to a valid VisitKind`);
  }
});

test("visitFormPrefill: the date and time split in the event's own zone, not UTC", () => {
  const e = row({ id: "a", kind: "tour", starts_at: "2026-10-19T13:00:00Z", timezone: "America/New_York" }); // 9am Eastern
  const p = visitFormPrefill(e);
  assert.equal(p.onDate, "2026-10-19");
  assert.equal(p.atTime, "09:00");
});

test("visitFormPrefill: an all-day event gets a date and a null time", () => {
  const e = row({ id: "a", kind: "open_house", starts_at: "2026-10-19T04:00:00Z", all_day: true });
  const p = visitFormPrefill(e);
  assert.equal(p.onDate, "2026-10-19");
  assert.equal(p.atTime, null);
});

test("visitFormPrefill: a travel event becomes kind fair, with registered and registration_url set", () => {
  const e = row({
    id: "a",
    kind: "travel",
    starts_at: "2026-10-19T13:00:00Z",
    title: "Marietta High School Visit",
    book_url: "https://undergrad.admissions.ufl.edu/register/?id=travel-1",
  });
  const p = visitFormPrefill(e);
  assert.equal(p.kind, "fair");
  assert.equal(p.registered, true);
  assert.equal(p.registrationUrl, "https://undergrad.admissions.ufl.edu/register/?id=travel-1");
});

test("visitFormPrefill: the notes' free field names the title, time, and venue", () => {
  const e = row({ id: "a", kind: "tour", title: "Campus Tour", starts_at: "2026-10-19T13:00:00Z", venue: "Welcome Center" });
  assert.equal(visitFormPrefill(e).notesFree, "Campus Tour, 9:00 am, Welcome Center");
});

test("visitFormPrefill: no venue falls back to city, state; online events say so", () => {
  const withTown = row({ id: "a", kind: "info_session", title: "Info Session", starts_at: "2026-10-19T13:00:00Z", venue: null, city: "Decatur", state: "GA" });
  assert.equal(visitFormPrefill(withTown).notesFree, "Info Session, 9:00 am, Decatur, GA");
  const online = row({ id: "b", kind: "online", title: "Virtual Session", starts_at: "2026-10-19T13:00:00Z", online: true });
  assert.equal(venueLine(online), "Online");
});

/* ------------------------------------------------------------------ */
/* "Next two" ordering                                                                                                */
/* ------------------------------------------------------------------ */

test("nextTwoEvents: on campus first, then the nearest travel event when a point exists", () => {
  const events = [
    row({ id: "campus", kind: "tour", starts_at: "2026-10-19T13:00:00Z" }),
    row({ id: "far-travel", kind: "travel", starts_at: "2026-10-20T13:00:00Z", lat: 25.7617, lng: -80.1918 }), // Miami, far
    row({ id: "near-travel", kind: "travel", starts_at: "2026-10-21T13:00:00Z", lat: 33.95, lng: -84.55 }), // Marietta, near
  ];
  const picked = nextTwoEvents(events, MARIETTA);
  assert.deepEqual(
    picked.map((e) => e.id),
    ["campus", "near-travel"],
  );
});

test("nextTwoEvents: without a measuring point, travel events are never chosen", () => {
  const events = [
    row({ id: "campus-1", kind: "tour", starts_at: "2026-10-19T13:00:00Z" }),
    row({ id: "campus-2", kind: "info_session", starts_at: "2026-10-20T13:00:00Z" }),
    row({ id: "travel", kind: "travel", starts_at: "2026-10-21T13:00:00Z", lat: 33.95, lng: -84.55 }),
  ];
  const picked = nextTwoEvents(events, null);
  assert.deepEqual(
    picked.map((e) => e.id),
    ["campus-1", "campus-2"],
  );
});

test("nextTwoEvents: a point but no travel events falls back to the second on-campus event", () => {
  const events = [
    row({ id: "campus-1", kind: "tour", starts_at: "2026-10-19T13:00:00Z" }),
    row({ id: "campus-2", kind: "open_house", starts_at: "2026-10-20T13:00:00Z" }),
  ];
  const picked = nextTwoEvents(events, MARIETTA);
  assert.deepEqual(
    picked.map((e) => e.id),
    ["campus-1", "campus-2"],
  );
});

test("nextTwoEvents: online events are never chosen (no on-campus, no travel, no distance)", () => {
  const events = [row({ id: "online", kind: "online", online: true, starts_at: "2026-10-19T13:00:00Z" })];
  assert.deepEqual(nextTwoEvents(events, MARIETTA), []);
});

test("nextTwoEvents: no events for the college returns an empty list", () => {
  assert.deepEqual(nextTwoEvents([], MARIETTA), []);
});

test("nextTwoEvents: staff rows are never shown even if a caller passes one through", () => {
  const events = [
    row({ id: "staff", kind: "staff", starts_at: "2026-10-18T13:00:00Z" }),
    row({ id: "campus", kind: "tour", starts_at: "2026-10-19T13:00:00Z" }),
  ];
  const picked = nextTwoEvents(events, null);
  assert.deepEqual(
    picked.map((e) => e.id),
    ["campus"],
  );
});
