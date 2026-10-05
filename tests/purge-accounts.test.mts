/**
 * The purge script's selection (scripts/lib/purge-accounts-plan.mts): only what was soft-deleted 30+ days ago, and
 * never a student record whose own account still exists. The script itself is never run in tests. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePurgeArgs, planPurge } from "../scripts/lib/purge-accounts-plan.mts";

const now = new Date("2026-11-10T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

test("planPurge: 30 days or older goes; younger, never-deleted, and restored rows stay", () => {
  const plan = planPurge(
    {
      profiles: [
        { id: "old", deleted_at: daysAgo(31) },
        { id: "edge", deleted_at: daysAgo(30) },
        { id: "young", deleted_at: daysAgo(29) },
        { id: "live", deleted_at: null },
        { id: "junk", deleted_at: "not a date" },
      ],
      students: [
        { id: "s-old", user_id: "old", deleted_at: daysAgo(31) },
        { id: "s-managed", user_id: null, deleted_at: daysAgo(40) },
        { id: "s-young-managed", user_id: null, deleted_at: daysAgo(3) },
        { id: "s-live-user", user_id: "live", deleted_at: daysAgo(60) },
        { id: "s-young-user", user_id: "young", deleted_at: daysAgo(29) },
      ],
      households: [
        { id: "h-old", deleted_at: daysAgo(45) },
        { id: "h-young", deleted_at: daysAgo(1) },
        { id: "h-live", deleted_at: null },
      ],
    },
    now,
  );
  assert.deepEqual(plan.users, ["old", "edge"]);
  assert.deepEqual(plan.students, ["s-old", "s-managed"]);
  assert.deepEqual(plan.households, ["h-old"]);
  // A student whose own account is alive keeps their record, whatever its deleted_at says.
  assert.deepEqual(plan.skippedStudents, ["s-live-user"]);
  assert.equal(plan.cutoff, daysAgo(30));
});

test("planPurge refuses a grace period under 30 days", () => {
  assert.throws(() => planPurge({ profiles: [], students: [], households: [] }, now, 7), /30 days/);
  assert.equal(planPurge({ profiles: [{ id: "a", deleted_at: daysAgo(40) }], students: [], households: [] }, now, 45).users.length, 0);
});

test("parsePurgeArgs: dry run unless --apply", () => {
  assert.deepEqual(parsePurgeArgs([]), { apply: false, days: 30 });
  assert.deepEqual(parsePurgeArgs(["--dry-run"]), { apply: false, days: 30 });
  assert.deepEqual(parsePurgeArgs(["--apply", "--days", "45"]), { apply: true, days: 45 });
  assert.throws(() => parsePurgeArgs(["--apply", "--dry-run"]), /not both/);
  assert.throws(() => parsePurgeArgs(["--force"]), /unknown argument/);
});
