/** The password rule (lib/password.ts): what the sign-up form shows and the server enforces. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordProblems, passwordStrength } from "../lib/password.ts";

test("too short, too plain, or too guessable is refused, with a reason", () => {
  assert.match(passwordProblems("Ab1!").join(" "), /at least 10/);
  assert.match(passwordProblems("abcdefghijk").join(" "), /three of/, "one kind of character, under 16");
  assert.match(passwordProblems("Password123").join(" "), /too easy|three/i, "common passwords are refused even when mixed");
  assert.match(passwordProblems("password123").join(" "), /too easy/);
  assert.match(passwordProblems("aaaaaaaaaaaa").join(" "), /too easy|three/);
  assert.match(passwordProblems("Raymond2026!", "raymond@example.com").join(" "), /email name/);
  assert.ok(passwordProblems("x".repeat(73) + "A1").length > 0, "over 72 (bcrypt's limit)");
});

test("a mixed password of 10+ or a passphrase of 16+ passes", () => {
  assert.deepEqual(passwordProblems("Tiger-lily7"), []);
  assert.deepEqual(passwordProblems("correct horse battery"), [], "a long passphrase needs no mix");
  assert.deepEqual(passwordProblems("Blue2Moon!x", "ray@example.com"), []);
});

test("strength: empty 0, refused 1, okay 2, strong 3", () => {
  assert.equal(passwordStrength(""), 0);
  assert.equal(passwordStrength("short"), 1);
  assert.equal(passwordStrength("Tiger-lily7"), 2);
  assert.equal(passwordStrength("Tiger-lily7-Moon"), 3);
  assert.equal(passwordStrength("correct horse battery"), 3);
});
