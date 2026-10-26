/**
 * Data API keys (lib/api/keys.ts; specs/product/data-api.md "Who may call, and how"): the key format ("quad_" + 40
 * lowercase base-32 characters, 200 bits), hashing (SHA-256 hex, the same digest Postgres computes), the display
 * prefix, the bearer header, and the key-name rule. Each shape check is shown refusing what it should. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  API_KEY_BODY_LENGTH,
  API_KEY_LIMITS,
  API_KEY_PREFIX,
  apiKeyPrefix,
  base32,
  bearerToken,
  generateApiKey,
  hashApiKey,
  isApiKey,
  normalizeKeyName,
} from "../lib/api/keys.ts";

test("a new key is quad_ + 40 lowercase base-32 characters, and every key is different", () => {
  const keys = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const key = generateApiKey();
    assert.match(key, /^quad_[a-z2-7]{40}$/);
    assert.ok(isApiKey(key));
    keys.add(key);
  }
  assert.equal(keys.size, 500);
  assert.equal(API_KEY_PREFIX, "quad_");
  assert.equal(API_KEY_BODY_LENGTH * 5, 200, "40 base-32 characters carry 200 bits");
});

test("the characters are spread over the whole alphabet (the encoder uses every bit)", () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 400; i++) for (const c of generateApiKey().slice(5)) counts.set(c, (counts.get(c) ?? 0) + 1);
  assert.equal(counts.size, 32);
  // 16,000 characters over 32 symbols: 500 each on average; a broken shift would starve some.
  for (const [c, n] of counts) assert.ok(n > 350 && n < 650, `${c}: ${n}`);
});

test("base32 matches RFC 4648 (lowercased, unpadded)", () => {
  const enc = (s: string) => base32(new TextEncoder().encode(s));
  assert.equal(enc(""), "");
  assert.equal(enc("f"), "my");
  assert.equal(enc("fo"), "mzxq");
  assert.equal(enc("foo"), "mzxw6");
  assert.equal(enc("foob"), "mzxw6yq");
  assert.equal(enc("fooba"), "mzxw6ytb");
  assert.equal(enc("foobar"), "mzxw6ytboi");
});

test("isApiKey checks shape only and refuses near misses", () => {
  const key = generateApiKey();
  assert.ok(isApiKey(key));
  for (const bad of [key.toUpperCase(), key.slice(0, -1), `${key}a`, key.replace("quad_", "quad-"), `quad_${"1".repeat(40)}`, `quad_${"8".repeat(40)}`, ` ${key}`, ""]) {
    assert.equal(isApiKey(bad), false, bad);
  }
});

test("hashApiKey is SHA-256 hex of the whole key, the digest api_key_use() looks up", () => {
  const key = "quad_" + "a".repeat(40);
  assert.equal(hashApiKey(key), createHash("sha256").update(key).digest("hex"));
  assert.match(hashApiKey(key), /^[0-9a-f]{64}$/);
  assert.notEqual(hashApiKey(key), hashApiKey(key.slice(0, -1) + "b"));
});

test("apiKeyPrefix shows quad_ and the first 8 characters, which the migration's check accepts", () => {
  const key = generateApiKey();
  const prefix = apiKeyPrefix(key);
  assert.equal(prefix, key.slice(0, 13));
  assert.match(prefix, /^quad_[a-z2-7]{8}$/);
  assert.equal(apiKeyPrefix("quad_ab3k9x2mzzzzzz"), "quad_ab3k9x2m");
});

test("bearerToken reads 'Bearer <token>' in any case and nothing else", () => {
  assert.equal(bearerToken("Bearer quad_x"), "quad_x");
  assert.equal(bearerToken("bearer   quad_x  "), "quad_x");
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken(""), null);
  assert.equal(bearerToken("Basic dXNlcjpwYXNz"), null);
  assert.equal(bearerToken("Bearer"), null);
  assert.equal(bearerToken("Bearer a b"), null);
  assert.equal(bearerToken("quad_x"), null);
});

test("key names: trimmed, inner spaces collapsed, 1–60 characters", () => {
  assert.deepEqual(normalizeKeyName("  My   notebook "), { ok: true, name: "My notebook" });
  assert.equal(normalizeKeyName("   ").ok, false);
  assert.equal(normalizeKeyName("x".repeat(60)).ok, true);
  assert.equal(normalizeKeyName("x".repeat(61)).ok, false);
});

test("the limits are one typed object: 5,000 a day, 60 a minute, 5 keys", () => {
  assert.deepEqual({ ...API_KEY_LIMITS }, { perDay: 5000, perMinute: 60, keysPerUser: 5 });
});
