import assert from "node:assert/strict";
import { test } from "node:test";
import { isStatementTimeout, retryOnStatementTimeout, TIMEOUT_RETRY_WAITS_MS } from "../lib/supabase-retry.ts";

const timeout = { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
const ok = { data: [{ id: "1" }], error: null };

test("retryOnStatementTimeout: a timed-out call is retried after each wait and the next answer returned", async () => {
  const waits: number[] = [];
  let calls = 0;
  const data = await retryOnStatementTimeout(async () => (++calls < 3 ? timeout : ok), "rows", async (ms) => void waits.push(ms));
  assert.deepEqual(data, ok.data);
  assert.equal(calls, 3);
  assert.deepEqual(waits, TIMEOUT_RETRY_WAITS_MS.slice(0, 2));
});

test("retryOnStatementTimeout: gives up after the last wait, naming the call; any other error is thrown at once", async () => {
  const waits: number[] = [];
  let calls = 0;
  await assert.rejects(
    retryOnStatementTimeout(async () => (calls++, timeout), "High schools: writing 7500–7700", async (ms) => void waits.push(ms)),
    /High schools: writing 7500–7700: canceling statement due to statement timeout/,
  );
  assert.equal(calls, TIMEOUT_RETRY_WAITS_MS.length + 1);
  assert.deepEqual(waits, [...TIMEOUT_RETRY_WAITS_MS]);

  let other = 0;
  await assert.rejects(
    retryOnStatementTimeout(async () => (other++, { data: null, error: { message: "permission denied for table high_schools", code: "42501" } }), "rows", async () => assert.fail("no wait")),
    /rows: permission denied/,
  );
  assert.equal(other, 1);
});

test("isStatementTimeout: Postgres's message or SQLSTATE, nothing else", () => {
  assert.ok(isStatementTimeout("canceling statement due to statement timeout"));
  assert.ok(isStatementTimeout("57014"));
  assert.ok(!isStatementTimeout("canceling statement due to user request"));
  assert.ok(!isStatementTimeout(null));
});
