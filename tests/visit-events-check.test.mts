/**
 * `check:visit-events --record` (specs/product/visit-events.md, "Keeping it running"): the pure payload written onto the
 * newest visit_event_sync row: check_failures and check_warnings count hosts, check_summary lists the flagged hosts
 * (failing first), at most 50, with the rest counted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { checkRecord, SUMMARY_MAX_HOSTS, type HostCheck } from "../scripts/lib/visit-events/check.mts";

const NOW = new Date("2026-10-15T09:00:00Z");

function host(name: string, over: Partial<HostCheck> = {}): HostCheck {
  return {
    host: name,
    unitId: "100",
    events: 10,
    kinds: { travel: 10 },
    staffShare: 0,
    hiddenShare: 0,
    zipShare: 1,
    locatedShare: 1,
    duplicates: [],
    farOut: [],
    startsBeforeSeen: [],
    failures: [],
    warnings: [],
    ...over,
  };
}

test("checkRecord: counts hosts failing and warned; lists only flagged hosts, failing first, with the payload's exact shape", () => {
  const rec = checkRecord(
    [
      host("a.edu"),
      host("z.edu", { warnings: ["located share 70% is below 80%"] }),
      host("m.edu", { failures: ["staff share 50% is above 40%"], warnings: ["located share 60% is below 80%"], events: 4, unitId: "7" }),
      host("b.edu", { warnings: ["w"] }),
    ],
    NOW,
  );
  assert.deepEqual(Object.keys(rec).sort(), ["check_failures", "check_summary", "check_warnings"]);
  assert.equal(rec.check_failures, 1);
  assert.equal(rec.check_warnings, 3, "a failing host with a warning counts as warned too");
  assert.deepEqual(rec.check_summary, {
    checked_at: "2026-10-15T09:00:00.000Z",
    hosts: 4,
    events: 34,
    failing: 1,
    warned: 3,
    listed: [
      { host: "m.edu", unit_id: "7", events: 4, failures: ["staff share 50% is above 40%"], warnings: ["located share 60% is below 80%"] },
      { host: "b.edu", unit_id: "100", events: 10, failures: [], warnings: ["w"] },
      { host: "z.edu", unit_id: "100", events: 10, failures: [], warnings: ["located share 70% is below 80%"] },
    ],
    omitted: 0,
  });
  // JSON-safe for the jsonb column.
  assert.deepEqual(JSON.parse(JSON.stringify(rec)), rec);
});

test("checkRecord: truncated to 50 hosts (failing ones kept first), the rest counted; long messages cut", () => {
  const checks = [
    ...Array.from({ length: 45 }, (_, i) => host(`w${String(i).padStart(2, "0")}.edu`, { warnings: ["w"] })),
    ...Array.from({ length: 10 }, (_, i) => host(`f${i}.edu`, { failures: ["x".repeat(2000)] })),
    host("clean.edu"),
  ];
  const { check_failures, check_warnings, check_summary } = checkRecord(checks, NOW);
  assert.equal(check_failures, 10);
  assert.equal(check_warnings, 45);
  assert.equal(check_summary.listed.length, SUMMARY_MAX_HOSTS);
  assert.equal(SUMMARY_MAX_HOSTS, 50);
  assert.equal(check_summary.omitted, 5);
  assert.ok(check_summary.listed.slice(0, 10).every((h) => h.failures.length), "every failing host is listed before any warned one");
  assert.ok(check_summary.listed.every((h) => h.host !== "clean.edu"));
  assert.ok(check_summary.listed[0].failures[0].length <= 500);
});

test("checkRecord: nothing stored is a clean record", () => {
  assert.deepEqual(checkRecord([], NOW), {
    check_failures: 0,
    check_warnings: 0,
    check_summary: { checked_at: "2026-10-15T09:00:00.000Z", hosts: 0, events: 0, failing: 0, warned: 0, listed: [], omitted: 0 },
  });
});
