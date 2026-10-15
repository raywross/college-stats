/**
 * Host bookkeeping (scripts/lib/visit-events/hosts.mts; specs/product/visit-events.md, "Keeping it running", point 4):
 * last_attempt on every try, last_read / search_total / zero_since on an answer, the status transitions, which hosts a
 * night reads, and which colleges a weekly discovery tries.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  afterFailure,
  afterRead,
  discoveryTargets,
  dueHosts,
  isDue,
  FAILURES_TO_UNREACHABLE,
  NO_EVENTS_AFTER_DAYS,
} from "../scripts/lib/visit-events/hosts.mts";
import { runSync, type EventStore } from "../scripts/lib/visit-events/sync.mts";
import type { SlateHostRow } from "../lib/visit-events/types.ts";

const NOW = new Date("2026-10-15T07:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

test("afterRead: sets last_attempt, last_read, search_total; clears failures and the error", () => {
  const p = afterRead({ status: "active", zero_since: null }, { rows: 86, searchTotal: 86 }, NOW);
  assert.deepEqual(p, {
    last_attempt: NOW.toISOString(),
    last_read: NOW.toISOString(),
    failures: 0,
    last_error: null,
    search_total: 86,
    zero_since: null,
    status: "active",
  });
});

test("afterRead: zero_since is set by the first empty read, kept by later ones, cleared when rows come back", () => {
  const first = afterRead({ status: "active", zero_since: null }, { rows: 0, searchTotal: 0 }, NOW);
  assert.equal(first.zero_since, NOW.toISOString());
  assert.equal(first.status, "active");
  const later = afterRead({ status: "active", zero_since: daysAgo(10) }, { rows: 0, searchTotal: 0 }, NOW);
  assert.equal(later.zero_since, daysAgo(10));
  const back = afterRead({ status: "no_events", zero_since: daysAgo(40) }, { rows: 3, searchTotal: 3 }, NOW);
  assert.equal(back.zero_since, null);
  assert.equal(back.status, "active");
});

test("afterRead: no_events once zero_since is 30 days old, not a day before; widget rows count as rows", () => {
  assert.equal(afterRead({ status: "active", zero_since: daysAgo(NO_EVENTS_AFTER_DAYS - 1) }, { rows: 0, searchTotal: 0 }, NOW).status, "active");
  assert.equal(afterRead({ status: "active", zero_since: daysAgo(NO_EVENTS_AFTER_DAYS) }, { rows: 0, searchTotal: 0 }, NOW).status, "no_events");
  // The search said 0 but a portal widget listed online events: not empty.
  assert.equal(afterRead({ status: "active", zero_since: daysAgo(45) }, { rows: 4, searchTotal: 0 }, NOW).status, "active");
  // An off host stays off whatever a manual read finds.
  assert.equal(afterRead({ status: "off", zero_since: null }, { rows: 4, searchTotal: 4 }, NOW).status, "off");
});

test("afterFailure: failures + 1, last_attempt set, last_read untouched; unreachable at the third failure", () => {
  const one = afterFailure({ status: "active", failures: 0 }, "HTTP 500", NOW);
  assert.deepEqual(one, { last_attempt: NOW.toISOString(), failures: 1, last_error: "HTTP 500", status: "active" });
  assert.ok(!("last_read" in one));
  assert.equal(afterFailure({ status: "active", failures: FAILURES_TO_UNREACHABLE - 2 }, "x", NOW).status, "active");
  assert.equal(afterFailure({ status: "active", failures: FAILURES_TO_UNREACHABLE - 1 }, "x", NOW).status, "unreachable");
  assert.equal(afterFailure({ status: "no_events", failures: 0 }, "x", NOW).status, "no_events");
  assert.equal(afterFailure({ status: "off", failures: 5 }, "x", NOW).status, "off");
  assert.equal(afterFailure({ status: "active", failures: 0 }, "e".repeat(900), NOW).last_error?.length, 500);
});

test("isDue: active always; unreachable 7 days after the last attempt (or by hand); no_events after 30; off never", () => {
  assert.equal(isDue({ status: "active", last_attempt: daysAgo(0) }, NOW), true);
  assert.equal(isDue({ status: "unreachable", last_attempt: daysAgo(6.9) }, NOW), false);
  assert.equal(isDue({ status: "unreachable", last_attempt: daysAgo(7) }, NOW), true);
  assert.equal(isDue({ status: "unreachable", last_attempt: daysAgo(1) }, NOW, { retryUnreachable: true }), true);
  assert.equal(isDue({ status: "unreachable", last_attempt: null }, NOW), true);
  assert.equal(isDue({ status: "no_events", last_attempt: daysAgo(29) }, NOW), false);
  assert.equal(isDue({ status: "no_events", last_attempt: daysAgo(30) }, NOW), true);
  assert.equal(isDue({ status: "no_events", last_attempt: daysAgo(1) }, NOW, { retryUnreachable: true }), false);
  assert.equal(isDue({ status: "off", last_attempt: null }, NOW, { retryUnreachable: true }), false);
  const hosts = [
    { id: "a", status: "active" as const, last_attempt: daysAgo(1) },
    { id: "b", status: "unreachable" as const, last_attempt: daysAgo(2) },
    { id: "c", status: "no_events" as const, last_attempt: daysAgo(31) },
    { id: "d", status: "off" as const, last_attempt: null },
  ];
  assert.deepEqual(dueHosts(hosts, NOW).map((h) => h.id), ["a", "c"]);
});

test("discoveryTargets: colleges with a link and no row; an unreachable row untried for 7 days; --units always (never off)", () => {
  const colleges = [
    { unit_id: "1", links: { visit: "https://a.edu/visit" } },
    { unit_id: "2", links: { apply: "https://b.edu/apply" } },
    { unit_id: "3", links: {} },
    { unit_id: "4", links: { visit: "https://d.edu/visit" } },
    { unit_id: "5", links: { visit: "https://e.edu/visit" } },
    { unit_id: "6", links: { visit: "https://f.edu/visit" } },
    { unit_id: "7", links: { visit: "https://g.edu/visit" } },
  ];
  const known = new Map<string, Pick<SlateHostRow, "status" | "last_attempt">>([
    ["4", { status: "active", last_attempt: daysAgo(30) }],
    ["5", { status: "unreachable", last_attempt: daysAgo(3) }],
    ["6", { status: "unreachable", last_attempt: daysAgo(8) }],
    ["7", { status: "off", last_attempt: null }],
  ]);
  assert.deepEqual(discoveryTargets(colleges, known, { now: NOW }), ["1", "2", "6"]);
  assert.deepEqual(discoveryTargets(colleges, known, { now: NOW, units: ["4", "5", "7"] }), ["4", "5"]);
});

test("syncHost through runSync: a failed try sets last_attempt and never last_read; an answer sets both", async () => {
  const patches: Partial<SlateHostRow>[] = [];
  const store: EventStore = {
    storedFor: async () => [],
    upsertEvents: async () => {},
    updateHost: async (_u, p) => void patches.push(p),
    recordSync: async () => {},
  };
  const host: SlateHostRow = {
    unit_id: "1",
    host: "apply.example.edu",
    found_on: null,
    portal_parts: [],
    status: "active",
    failures: 0,
    first_seen: daysAgo(10),
    last_read: daysAgo(1),
    last_error: null,
    last_attempt: daysAgo(1),
    search_total: 4,
    zero_since: null,
  };
  const deps = { store, zips: new Map(), campus: () => ({ city: null, state: null, lat: null, lng: null }), now: NOW };
  await runSync([host], { ...deps, http: { get: async () => null } });
  assert.equal(patches.at(-1)?.last_attempt, NOW.toISOString());
  assert.ok(!("last_read" in patches.at(-1)!));
  assert.equal(patches.at(-1)?.failures, 1);
});
