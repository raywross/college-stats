/**
 * The secret check on POST /api/revalidate (lib/revalidate-auth.ts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRevalidateAuth, MIN_SECRET_LENGTH } from "../lib/revalidate-auth.ts";

const SECRET = "a".repeat(64);

test("accepts the exact bearer token", () => {
  assert.equal(checkRevalidateAuth(`Bearer ${SECRET}`, SECRET), "ok");
});

test("rejects a missing, malformed, or wrong token", () => {
  assert.equal(checkRevalidateAuth(null, SECRET), "denied");
  assert.equal(checkRevalidateAuth("", SECRET), "denied");
  assert.equal(checkRevalidateAuth(SECRET, SECRET), "denied");
  assert.equal(checkRevalidateAuth(`Basic ${SECRET}`, SECRET), "denied");
  assert.equal(checkRevalidateAuth(`Bearer ${SECRET}x`, SECRET), "denied");
  assert.equal(checkRevalidateAuth(`Bearer ${SECRET.slice(1)}`, SECRET), "denied");
  assert.equal(checkRevalidateAuth("Bearer ", SECRET), "denied");
});

test("refuses everything when the server's secret is unset or too short", () => {
  assert.equal(checkRevalidateAuth("Bearer ", undefined), "unconfigured");
  assert.equal(checkRevalidateAuth("Bearer ", ""), "unconfigured");
  const short = "b".repeat(MIN_SECRET_LENGTH - 1);
  assert.equal(checkRevalidateAuth(`Bearer ${short}`, short), "unconfigured");
});
